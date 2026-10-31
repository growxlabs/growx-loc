import sys
import json
import urllib.request
import urllib.parse
from env_loader import get_api_key

sys.stdout.reconfigure(encoding="utf-8")

BASE_URL = "https://api.location.growxlabs.tech"
API_KEY = get_api_key()

tests = [
    {
        "query": "%",
        "description": "Wildcard percent sign (q=%) — must not return all rows",
        "expected_count": 0,
        "expect_zero": True
    },
    {
        "query": "_",
        "description": "Wildcard underscore (q=_) — must not return single-char wildcard matches",
        "expected_count": 0,
        "expect_zero": True
    },
    {
        "query": "Vijayawada",
        "description": "Standard query (q=Vijayawada) — must return Vijayawada",
        "expect_contains": "Vijayawada",
        "expect_zero": False
    },
    {
        "query": "Andhra Pradesh",
        "description": "Multi-word query (q=Andhra Pradesh) — must return Andhra Pradesh",
        "expect_contains": "Andhra Pradesh",
        "expect_zero": False
    }
]

print("==================================================================")
print("  D1 DIVISIONS SEARCH WILDCARD ESCAPING SUITE")
print(f"  Target: {BASE_URL}")
print("==================================================================\n")

all_passed = True

for t in tests:
    encoded_q = urllib.parse.quote(t["query"])
    url = f"{BASE_URL}/v1/divisions/search?q={encoded_q}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {API_KEY}",
        "User-Agent": "Growx-Loc-Verification/1.0"
    })

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            count = data.get("count", 0)
            items = data.get("data", [])
            names = [item["name"] for item in items]

            passed = True
            details = []

            if t.get("expect_zero") and count != 0:
                passed = False
                details.append(f"Expected 0 results, got {count} (wildcard was not escaped)")
            elif not t.get("expect_zero") and count == 0:
                passed = False
                details.append("Expected results, got 0")

            if t.get("expect_contains") and not any(t["expect_contains"].lower() in n.lower() for n in names):
                passed = False
                details.append(f"Expected to find '{t['expect_contains']}' in {names[:3]}")

            if passed:
                print(f"TEST: {t['description']}")
                print(f"  Query:         q={t['query']}")
                print(f"  Status Code:   200 OK")
                print(f"  Result Count:  {count}")
                if names:
                    print(f"  Sample Names:  {names[:2]}")
                print(f"  Result:        ✅ PASS\n")
            else:
                all_passed = False
                print(f"TEST: {t['description']}")
                print(f"  Query:         q={t['query']}")
                print(f"  Failure:       {'; '.join(details)}")
                print(f"  Result:        ❌ FAIL\n")

    except Exception as e:
        all_passed = False
        print(f"TEST: {t['description']}")
        print(f"  Error:         {e}")
        print(f"  Result:        ❌ FAIL\n")

print("==================================================================")
if all_passed:
    print("  ALL WILDCARD TESTS PASSED! 🎉")
else:
    print("  WILDCARD TESTS FAILED (need deploy).")
print("==================================================================")
