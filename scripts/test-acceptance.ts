const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const API_KEY = process.env.API_KEY;

console.log(`\n======================================================`);
console.log(`  Growx Location V1 — End-to-End Acceptance Suite`);
console.log(`  Target Base URL: ${BASE_URL}`);
console.log(
  `  API Key: ${API_KEY ? "Configured" : "Not configured (unauthenticated tests only)"}`,
);
console.log(`======================================================\n`);

type TestResult = {
  id: string;
  name: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  details?: string;
};

const results: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTest(id: string, name: string, fn: () => Promise<void>) {
  process.stdout.write(`[Test ${id}] ${name}... `);
  try {
    await fn();
    console.log(`✅ PASS`);
    results.push({ id, name, status: "PASS" });
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    console.log(`❌ FAIL\n  Error: ${err}`);
    results.push({ id, name, status: "FAIL", details: err });
  }
}

// ---------------------------------------------------------------------------
// TEST 1: HEALTH
// ---------------------------------------------------------------------------
await runTest("01", "Health Endpoint", async () => {
  const res = await fetch(`${BASE_URL}/health`);
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  const data = (await res.json()) as { status: string; service: string };
  assert(data.status === "ok", `Expected status: "ok", got "${data.status}"`);
  assert(
    data.service === "growx-location",
    `Expected service: "growx-location", got "${data.service}"`,
  );
  assert(res.headers.has("x-request-id"), "Missing X-Request-Id header");
});

// ---------------------------------------------------------------------------
// TEST 2: ROOT
// ---------------------------------------------------------------------------
await runTest("02", "Root Operational Status", async () => {
  const res = await fetch(`${BASE_URL}/`);
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  const data = (await res.json()) as {
    name: string;
    status: string;
    version: string;
  };
  assert(data.status === "operational", `Expected operational status`);
  assert(data.version === "v1", `Expected version: v1`);
});

// ---------------------------------------------------------------------------
// TEST 3: MISSING API KEY
// ---------------------------------------------------------------------------
await runTest("03", "Missing API Key Rejection (401)", async () => {
  const res = await fetch(`${BASE_URL}/v1/me`);
  assert(res.status === 401, `Expected 401, got ${res.status}`);
  const json = (await res.json()) as {
    error?: { code?: string; requestId?: string };
  };
  assert(
    json.error?.code === "UNAUTHORIZED",
    `Expected UNAUTHORIZED, got ${json.error?.code}`,
  );
  assert(Boolean(json.error?.requestId), "Error response missing requestId");
});

// ---------------------------------------------------------------------------
// TEST 4: INVALID API KEY
// ---------------------------------------------------------------------------
await runTest("04", "Invalid API Key Rejection (401)", async () => {
  const res = await fetch(`${BASE_URL}/v1/me`, {
    headers: { Authorization: "Bearer gx_loc_invalid" },
  });
  assert(res.status === 401, `Expected 401, got ${res.status}`);
  const json = (await res.json()) as {
    error?: { code?: string; requestId?: string };
  };
  assert(
    json.error?.code === "UNAUTHORIZED",
    `Expected UNAUTHORIZED, got ${json.error?.code}`,
  );
  assert(Boolean(json.error?.requestId), "Error response missing requestId");
});

// ---------------------------------------------------------------------------
// TEST 5: GLOBAL 404 NOT FOUND
// ---------------------------------------------------------------------------
await runTest("05", "Global 404 Fallback", async () => {
  const res = await fetch(`${BASE_URL}/nonexistent-route-for-testing-404`);
  assert(res.status === 404, `Expected 404, got ${res.status}`);
  const json = (await res.json()) as {
    error?: { code?: string; requestId?: string };
  };
  assert(
    json.error?.code === "NOT_FOUND",
    `Expected NOT_FOUND, got ${json.error?.code}`,
  );
  assert(Boolean(json.error?.requestId), "Error response missing requestId");
});

// ---------------------------------------------------------------------------
// TEST 6: SECURITY HEADERS
// ---------------------------------------------------------------------------
await runTest("06", "Defensive Security Headers", async () => {
  const res = await fetch(`${BASE_URL}/health`);
  assert(
    res.headers.get("x-content-type-options") === "nosniff",
    "Missing X-Content-Type-Options: nosniff",
  );
  assert(
    res.headers.get("x-frame-options") === "SAMEORIGIN",
    "Missing X-Frame-Options: SAMEORIGIN",
  );
  assert(
    res.headers.has("strict-transport-security"),
    "Missing Strict-Transport-Security",
  );
});

// ---------------------------------------------------------------------------
// TEST 7: CORS POLICY (BACKEND ONLY)
// ---------------------------------------------------------------------------
await runTest("07", "Backend-Only CORS (No Wildcard on /v1/*)", async () => {
  const res = await fetch(`${BASE_URL}/v1/me`, {
    headers: { Origin: "https://random-unauthorized-website.com" },
  });
  const allowOrigin = res.headers.get("access-control-allow-origin");
  assert(
    allowOrigin !== "*",
    `Permissive CORS wildcard detected on protected route: ${allowOrigin}`,
  );
});

// ---------------------------------------------------------------------------
// TEST 8: REQUEST ID CORRELATION
// ---------------------------------------------------------------------------
await runTest(
  "08",
  "Request ID Correlation Across Header & Error Body",
  async () => {
    const res = await fetch(`${BASE_URL}/v1/locations`);
    const headerId = res.headers.get("x-request-id");
    const json = (await res.json()) as { error?: { requestId?: string } };
    assert(Boolean(headerId), "Missing X-Request-Id header");
    assert(
      headerId === json.error?.requestId,
      `Header ID (${headerId}) does not match body requestId (${json.error?.requestId})`,
    );
  },
);

// ---------------------------------------------------------------------------
// AUTHENTICATED TESTS (IF API_KEY PROVIDED)
// ---------------------------------------------------------------------------
if (!API_KEY) {
  console.log(
    `\nℹ️  Skipping authenticated tests 09–25 (Set $env:API_KEY to run live authenticated tests against Supabase)`,
  );
} else {
  let locationId = "";

  await runTest(
    "09",
    "Resolve Authenticated Tenant Identity (/v1/me)",
    async () => {
      const res = await fetch(`${BASE_URL}/v1/me`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const json = (await res.json()) as {
        data?: {
          tenant?: { id: string; name: string };
          apiKey?: { permissions: string[] };
        };
      };
      assert(Boolean(json.data?.tenant?.id), "Missing tenant ID");
      assert(
        Boolean(json.data?.apiKey?.permissions),
        "Missing API key permissions",
      );
    },
  );

  const testSlug = `acceptance-test-${Date.now()}`;

  await runTest("10", "Create Location (POST /v1/locations)", async () => {
    const res = await fetch(`${BASE_URL}/v1/locations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Acceptance Test Location",
        slug: testSlug,
        locationType: "office",
        address: {
          line1: "123 Business Way",
          city: "Vijayawada",
          district: "NTR",
          state: "Andhra Pradesh",
          pincode: "520010",
          countryCode: "IN",
        },
        coordinates: {
          lat: 16.5062,
          lng: 80.648,
        },
        contact: {
          phone: "+919999999999",
        },
        metadata: {
          acceptanceSuite: true,
        },
      }),
    });

    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const json = (await res.json()) as { data?: { id: string; slug: string } };
    assert(Boolean(json.data?.id), "Missing created location id");
    locationId = json.data?.id ?? "";
  });

  await runTest(
    "11",
    "Prevent Duplicate Slug Conflict (409 CONFLICT)",
    async () => {
      const res = await fetch(`${BASE_URL}/v1/locations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Duplicate Location",
          slug: testSlug,
          locationType: "office",
          address: {
            state: "Andhra Pradesh",
            countryCode: "IN",
          },
          coordinates: {
            lat: 16.5,
            lng: 80.6,
          },
        }),
      });

      assert(res.status === 409, `Expected 409, got ${res.status}`);
      const json = (await res.json()) as { error?: { code?: string } };
      assert(
        json.error?.code === "CONFLICT",
        `Expected CONFLICT, got ${json.error?.code}`,
      );
    },
  );

  await runTest("12", "List Locations (GET /v1/locations)", async () => {
    const res = await fetch(`${BASE_URL}/v1/locations`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    assert(Array.isArray(json.data), "Expected array of locations");
  });

  await runTest(
    "13",
    "Get Single Location (GET /v1/locations/:id)",
    async () => {
      assert(Boolean(locationId), "No location ID from previous test");
      const res = await fetch(`${BASE_URL}/v1/locations/${locationId}`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
    },
  );

  await runTest("14", "Search Locations (GET /v1/search)", async () => {
    const res = await fetch(`${BASE_URL}/v1/search?q=Acceptance`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await runTest("15", "Nearby Geo Search (GET /v1/nearby)", async () => {
    const res = await fetch(
      `${BASE_URL}/v1/nearby?lat=16.515&lng=80.660&radius=10`,
      {
        headers: { Authorization: `Bearer ${API_KEY}` },
      },
    );
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const json = (await res.json()) as {
      data?: Array<{ distanceKm?: number }>;
    };
    assert(Array.isArray(json.data), "Expected data array");
  });

  await runTest(
    "16",
    "Check Service Area (POST /v1/service-area/check)",
    async () => {
      const res = await fetch(`${BASE_URL}/v1/service-area/check`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: {
            lat: 16.5062,
            lng: 80.648,
          },
          pincode: "520010",
        }),
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
    },
  );

  await runTest("17", "Update Location (PATCH /v1/locations/:id)", async () => {
    assert(Boolean(locationId), "No location ID from previous test");
    const res = await fetch(`${BASE_URL}/v1/locations/${locationId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Acceptance Updated Name",
      }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await runTest(
    "18",
    "Soft Delete Location (DELETE /v1/locations/:id)",
    async () => {
      assert(Boolean(locationId), "No location ID from previous test");
      const res = await fetch(`${BASE_URL}/v1/locations/${locationId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      assert(res.status === 204, `Expected 204, got ${res.status}`);

      const verifyRes = await fetch(`${BASE_URL}/v1/locations/${locationId}`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      assert(
        verifyRes.status === 404,
        `Expected 404 after soft delete, got ${verifyRes.status}`,
      );
    },
  );
}

console.log(`\n======================================================`);
console.log(
  `  Summary: ${results.filter((r) => r.status === "PASS").length} Passed, ${results.filter((r) => r.status === "FAIL").length} Failed`,
);
console.log(`======================================================\n`);

if (results.some((r) => r.status === "FAIL")) {
  process.exit(1);
}
