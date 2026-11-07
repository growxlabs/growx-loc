// GrowX Location API client. Calls go through /api, where the server side adds the API key.

const cache = new Map<string, unknown>();
const MAX_CACHE = 100;

async function apiFetch<T>(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== '') query.set(key, String(val));
  }
  const url = `/api${path}?${query}`;

  const hit = cache.get(url);
  if (hit) return hit as T;

  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: { message?: string } })?.error?.message || `API error ${res.status}`);
  }

  const data = (await res.json()) as T;
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(url, data);
  return data;
}

// --- Types ---

export interface Place {
  id: string;
  name: string;
  category: string | null;
  basicCategory: string | null;
  brandName: string | null;
  confidence: number | null;
  locality: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  countryCode: string;
  latitude: number;
  longitude: number;
  address: string | null;
  phone: string | null;
  website: string | null;
  source: string;
  source_id: string;
  distanceKm?: number;
}

export interface Division {
  id: string;
  name: string;
  subtype: string;
  country: string;
  parentId: string | null;
  latitude: number | null;
  longitude: number | null;
  names: Record<string, unknown> | null;
  source: string;
  sourceId: string;
}

// --- API calls (the API allows at most 50 results per request) ---

export function searchPlaces(q: string, category?: string, signal?: AbortSignal) {
  return apiFetch<{ data: Place[] }>('/v1/global/search', { q, category, limit: 50 }, signal);
}

export function nearbyPlaces(lat: number, lng: number, radius: number, category?: string, signal?: AbortSignal) {
  return apiFetch<{ data: Place[] }>('/v1/global/nearby', { lat, lng, radius, category, limit: 50 }, signal);
}

export function searchDivisions(q: string, signal?: AbortSignal) {
  return apiFetch<{ data: Division[] }>('/v1/divisions/search', { q, limit: 50 }, signal);
}
