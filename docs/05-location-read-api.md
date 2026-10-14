# Growx Location — V1 Read API

**File:** `05-location-read-api.md`

## Goal

Implement the first production-facing Growx Location read endpoints:

```text
GET /v1/locations
GET /v1/locations/:id
GET /v1/search?q=
GET /v1/nearby?lat=&lng=&radius=&type=
```

All four endpoints:
- require the API-key middleware from file 4,
- derive tenant identity from `c.get("tenant")`,
- never trust a client-supplied tenant ID,
- return only active records by default,
- validate all query parameters with Zod,
- return stable JSON response shapes.

---

## Response Contract

```json
{
  "id": "uuid",
  "name": "GrowxLabs Vijayawada Test",
  "slug": "growxlabs-vijayawada-test",
  "type": "office",
  "address": {
    "line1": "Vijayawada Test Location",
    "line2": null,
    "locality": null,
    "city": "Vijayawada",
    "district": "NTR",
    "state": "Andhra Pradesh",
    "pincode": "520001",
    "countryCode": "IN"
  },
  "coordinates": {
    "lat": 16.5062,
    "lng": 80.648
  },
  "contact": {
    "phone": null,
    "whatsapp": null,
    "email": null,
    "website": null
  },
  "metadata": {}
}
```

Nearby response adds:
```json
{
  "distanceKm": 1.5
}
```

---

## Error Contract

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Location not found."
  }
}
```

Codes:
- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `VALIDATION_ERROR`
- `INTERNAL_ERROR`
