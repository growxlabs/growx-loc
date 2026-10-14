export function csvRowToLocationInput(row: Record<string, string>) {
  return {
    name: row.name,
    slug: row.slug || undefined,
    locationType: row.location_type,

    address: {
      line1: row.address_line_1 || null,
      line2: row.address_line_2 || null,
      locality: row.locality || null,
      city: row.city || null,
      district: row.district || null,
      state: row.state,
      pincode: row.pincode || null,
      countryCode: row.country_code || "IN",
    },

    coordinates: {
      lat: Number(row.latitude),
      lng: Number(row.longitude),
    },

    contact: {
      phone: row.phone || null,
      whatsapp: row.whatsapp || null,
      email: row.email || null,
      website: row.website || null,
    },

    metadata: {},

    status: row.status || "active",
  };
}
