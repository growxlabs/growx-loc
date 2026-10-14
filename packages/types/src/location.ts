export type LocationResponse = {
  id: string;
  name: string;
  slug: string;
  type: string;
  address: {
    line1: string | null;
    line2: string | null;
    locality: string | null;
    city: string | null;
    district: string | null;
    state: string;
    pincode: string | null;
    countryCode: string;
  };
  coordinates: {
    lat: number;
    lng: number;
  };
  contact: {
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    website: string | null;
  };
  metadata: Record<string, unknown>;
  distanceKm?: number;
};
