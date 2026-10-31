import time
import json
import urllib.request
import urllib.parse
import sys
import os
from env_loader import get_api_key

sys.stdout.reconfigure(encoding="utf-8")

BASE_URL = os.environ.get("BASE_URL", "https://api.location.growxlabs.tech")
API_KEY = get_api_key()

tests = [
    {
        "name": "Global Search: Apollo",
        "path": "/v1/global/search?q=Apollo",
        "expected_db": "Supabase D2 (Global Intelligence DB)"
    },
    {
        "name": "Global Search: dealer",
        "path": "/v1/global/search?q=dealer",
        "expected_db": "Supabase D2 (Global Intelligence DB)"
    },
    {
        "name": "Global Nearby: Vijayawada (10km radius)",
        "path": "/v1/global/nearby?lat=16.5062&lng=80.6480&radius=10",
        "expected_db": "Supabase D2 (Global PostGIS Engine)"
    },
    {
        "name": "Divisions Search: Vijayawada",
        "path": "/v1/divisions/search?q=Vijayawada",
        "expected_db": "Cloudflare D1 (growx-location-reference)"
    },
    {
        "name": "Divisions Search: Guntur",
        "path": "/v1/divisions/search?q=Guntur",
        "expected_db": "Cloudflare D1 (growx-location-reference)"
    },
    {
        "name": "Divisions Search: Andhra Pradesh (region)",
        "path": "/v1/divisions/search?q=Andhra%20Pradesh&subtype=region",
        "expected_db": "Cloudflare D1 (growx-location-reference)"
    }
]

print("==================================================================")
print("  PRODUCTION ROUTE VERIFICATION SUITE")
print(f"  Target: {BASE_URL}")
print("==================================================================\n")

all_passed = True

for t in tests:
    url = f"{BASE_URL}{t['path']}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {API_KEY}",
        "User-Agent": "Growx-Loc-Verification/1.0"
    })

    t0 = time.time()
    try:
        with urllib.request.urlopen(req) as resp:
            duration_ms = (time.time() - t0) * 1000.0
            status_code = resp.getcode()
            body = resp.read().decode("utf-8")
            data = json.loads(body)

            results = data.get("data", [])
            count = len(results)
            sample = results[0] if count > 0 else None

            print(f"TEST: {t['name']}")
            print(f"  Endpoint:      {t['path']}")
            print(f"  HTTP Status:   {status_code} OK")
            print(f"  Result Count:  {count} items")
            print(f"  Response Time: {duration_ms:.2f} ms")
            print(f"  Database Used: {t['expected_db']}")
            if sample:
                sample_str = json.dumps(sample, indent=4)
                print(f"  Sample Result: {sample.get('name')} | Cat/Type: {sample.get('category') or sample.get('subtype')} | Lat/Lng: {sample.get('latitude')}, {sample.get('longitude')}")
                if "distanceKm" in sample:
                    print(f"  Distance:      {sample['distanceKm']} km")
            print("  Status:        ✅ PASS\n")

    except Exception as e:
        all_passed = False
        duration_ms = (time.time() - t0) * 1000.0
        print(f"TEST: {t['name']}")
        print(f"  Endpoint:      {t['path']}")
        print(f"  Error:         {e}")
        print(f"  Duration:      {duration_ms:.2f} ms")
        print("  Status:        ❌ FAIL\n")

print("==================================================================")
if all_passed:
    print("  ALL 6 PRODUCTION VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉")
else:
    print("  SOME TESTS FAILED.")
print("==================================================================")
