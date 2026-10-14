export type ServiceAreaResponse = {
  id: string;
  name: string;
  type: "radius" | "pincode_list";
  locationId: string | null;
  radiusKm: number | null;
  pincodes: string[] | null;
  metadata: Record<string, unknown>;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type ServiceAreaCoverageResult = {
  serviceAreaId: string;
  serviceAreaName: string;
  type: "radius" | "pincode_list";
  locationId: string | null;
  locationName: string | null;
  distanceKm: number | null;
};
