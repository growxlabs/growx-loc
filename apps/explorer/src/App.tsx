import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { nearbyPlaces, searchDivisions, searchPlaces } from './lib/api';
import type { Division, Place } from './lib/api';

type Mode = 'nearby' | 'places' | 'areas';
type LatLng = { lat: number; lng: number };
type Result = { id: string; name: string; meta: string; lat: number; lng: number; place?: Place };

// Not a city centre: many places share the exact centre coordinate and would stack on one point.
const START: LatLng = { lat: 17.38048, lng: 78.54126 };
const ACCENT = '#0f766e';

// Values are real basic_category values in the dataset.
const CATEGORIES = [
  { label: 'All', value: '' },
  { label: 'Hospitals', value: 'hospital' },
  { label: 'Banks', value: 'bank_or_credit_union' },
  { label: 'Food', value: 'restaurant' },
  { label: 'Shopping', value: 'shopping' },
  { label: 'Fuel', value: 'gas_station' },
  { label: 'Hotels', value: 'hotel' },
];

const CITIES = [
  { name: 'Hyderabad', lat: 17.385, lng: 78.4867 },
  { name: 'Vijayawada', lat: 16.5062, lng: 80.648 },
  { name: 'Visakhapatnam', lat: 17.6868, lng: 83.2185 },
  { name: 'Guntur', lat: 16.3067, lng: 80.4365 },
  { name: 'Tirupati', lat: 13.6288, lng: 79.4192 },
];

const MODES: { id: Mode; label: string; icon: ReactNode }[] = [
  { id: 'nearby', label: 'Nearby', icon: <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" /> },
  { id: 'places', label: 'Places', icon: <path d="m20 20-4.2-4.2M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /> },
  { id: 'areas', label: 'Areas', icon: <path d="m9 4-6 2.5v13.5l6-2.5 6 2.5 6-2.5v-13.5l-6 2.5-6-2.5Zm0 0v13.5m6-11v13.5" /> },
];

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const pretty = (value: string | null | undefined) => (value ? value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');

function MapEvents({ onClick }: { onClick: (point: LatLng) => void }) {
  useMapEvents({ click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function MapView({ focus, results, fit }: { focus: (LatLng & { zoom: number }) | null; results: Result[]; fit: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (focus) map.setView([focus.lat, focus.lng], focus.zoom, { animate: true, duration: 0.35 });
  }, [focus, map]);

  useEffect(() => {
    if (fit && results.length > 0) {
      map.fitBounds(L.latLngBounds(results.map((r) => [r.lat, r.lng])), { paddingTopLeft: [400, 40], paddingBottomRight: [40, 40], maxZoom: 15 });
    }
  }, [results, fit, map]);

  return null;
}

export default function App() {
  const [mode, setMode] = useState<Mode>('nearby');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [origin, setOrigin] = useState<LatLng>(START);
  const [radius, setRadius] = useState(5);
  const [places, setPlaces] = useState<Place[]>([]);
  const [areas, setAreas] = useState<Division[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<(LatLng & { zoom: number }) | null>(null);
  const [retry, setRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // One request at a time: a newer change cancels the older one, so slow responses can't overwrite fresh results.
  useEffect(() => {
    const q = query.trim();
    if (mode !== 'nearby' && q.length < 2) {
      setPlaces([]);
      setAreas([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        if (mode === 'areas') {
          setAreas((await searchDivisions(q, signal)).data);
          setPlaces([]);
        } else {
          const res = mode === 'nearby'
            ? await nearbyPlaces(origin.lat, origin.lng, radius, category || undefined, signal)
            : await searchPlaces(q, category || undefined, signal);
          setPlaces(res.data);
          setAreas([]);
        }
        setLoading(false);
      } catch (err) {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Something went wrong');
        setPlaces([]);
        setAreas([]);
        setLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mode, query, category, origin, radius, retry]);

  const results = useMemo<Result[]>(() => {
    if (mode === 'areas') {
      return areas
        .filter((d) => d.latitude !== null && d.longitude !== null)
        .map((d) => ({ id: d.id, name: d.name, meta: pretty(d.subtype), lat: d.latitude as number, lng: d.longitude as number }));
    }
    return places.map((p) => ({
      id: p.id,
      name: p.name,
      meta: pretty(p.basicCategory ?? p.category) || p.locality || '',
      lat: p.latitude,
      lng: p.longitude,
      place: p,
    }));
  }, [mode, areas, places]);

  const selected = results.find((r) => r.id === selectedId) ?? null;

  const changeMode = (next: Mode) => {
    setMode(next);
    setSelectedId(null);
    setQuery('');
    if (next !== 'nearby') setTimeout(() => inputRef.current?.focus(), 0);
  };

  const jumpTo = (city: (typeof CITIES)[number]) => {
    setSelectedId(null);
    setOrigin({ lat: city.lat, lng: city.lng });
    setFocus({ lat: city.lat, lng: city.lng, zoom: 12 });
  };

  const select = (result: Result) => {
    setSelectedId(result.id);
    setFocus({ lat: result.lat, lng: result.lng, zoom: 15 });
  };

  const needsQuery = mode !== 'nearby' && query.trim().length < 2;

  return (
    <div className="app">
      <MapContainer className="map" center={[START.lat, START.lng]} zoom={12} zoomControl={false} preferCanvas>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapEvents onClick={(point) => { if (mode === 'nearby') { setSelectedId(null); setOrigin(point); } }} />
        <MapView focus={focus} results={results} fit={mode !== 'nearby'} />

        {mode === 'nearby' && (
          <>
            <Circle center={[origin.lat, origin.lng]} radius={radius * 1000} interactive={false} pathOptions={{ color: ACCENT, weight: 1.5, fillColor: ACCENT, fillOpacity: 0.06 }} />
            <CircleMarker center={[origin.lat, origin.lng]} radius={5} interactive={false} pathOptions={{ color: '#fff', weight: 2, fillColor: '#111827', fillOpacity: 1 }} />
          </>
        )}

        {results.map((r) => (
          <CircleMarker
            key={r.id}
            center={[r.lat, r.lng]}
            radius={r.id === selectedId ? 9 : 5}
            pathOptions={{ color: '#fff', weight: r.id === selectedId ? 3 : 1.5, fillColor: r.id === selectedId ? '#111827' : ACCENT, fillOpacity: 1 }}
            eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); select(r); } }}
          />
        ))}
      </MapContainer>

      <aside className="panel" aria-label="Location explorer">
        <div className="panel-head">
          <div className="modes" role="tablist" aria-label="Mode">
            {MODES.map((m) => (
              <button key={m.id} role="tab" aria-selected={mode === m.id} className="mode" onClick={() => changeMode(m.id)}>
                <Icon>{m.icon}</Icon>
                {m.label}
              </button>
            ))}
          </div>

          {mode === 'nearby' ? (
            <>
              <select className="field" aria-label="City" value={CITIES.find((c) => c.lat === origin.lat && c.lng === origin.lng)?.name ?? ''} onChange={(e) => { const city = CITIES.find((c) => c.name === e.target.value); if (city) jumpTo(city); }}>
                <option value="" disabled>Point on map</option>
                {CITIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
              <label className="radius">
                <span>Radius</span>
                <input type="range" min="1" max="30" value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
                <output>{radius} km</output>
              </label>
            </>
          ) : (
            <input
              ref={inputRef}
              className="field"
              type="search"
              aria-label={mode === 'places' ? 'Search places' : 'Search areas'}
              placeholder={mode === 'places' ? 'Search places' : 'Search cities and districts'}
              value={query}
              onChange={(e) => { setSelectedId(null); setQuery(e.target.value); }}
            />
          )}

          {mode !== 'areas' && (
            <div className="chips">
              {CATEGORIES.map((c) => (
                <button key={c.label} className="chip" aria-pressed={category === c.value} onClick={() => { setSelectedId(null); setCategory(c.value); }}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="status" aria-live="polite">
          {loading ? 'Searching…' : needsQuery ? '' : error ? '' : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}
        </div>

        {selected ? (
          <Detail result={selected} onBack={() => setSelectedId(null)} />
        ) : (
          <ul className={`results${loading ? ' is-loading' : ''}`}>
            {error && (
              <li className="message">
                <p>{error}</p>
                <button className="link" onClick={() => setRetry((n) => n + 1)}>Try again</button>
              </li>
            )}
            {!error && !loading && !needsQuery && results.length === 0 && <li className="message"><p>Nothing found</p></li>}
            {results.map((r) => (
              <li key={r.id}>
                <button className="row" onClick={() => select(r)}>
                  <span className="row-main">
                    <span className="row-name">{r.name}</span>
                    <span className="row-meta">{r.meta}</span>
                  </span>
                  {r.place?.distanceKm !== undefined && <span className="row-distance">{r.place.distanceKm.toFixed(1)} km</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function Detail({ result, onBack }: { result: Result; onBack: () => void }) {
  const p = result.place;
  const area = p ? [p.locality, p.district, p.state, p.pincode].filter(Boolean).join(', ') : '';
  const website = p?.website ? (p.website.startsWith('http') ? p.website : `https://${p.website}`) : null;

  return (
    <div className="detail">
      <button className="link back" onClick={onBack}>
        <Icon><path d="m15 18-6-6 6-6" /></Icon>
        Results
      </button>
      <h1>{result.name}</h1>
      <p className="row-meta">{result.meta}</p>
      <dl>
        {p?.address && <div><dt>Address</dt><dd>{p.address}</dd></div>}
        {area && <div><dt>Area</dt><dd>{area}</dd></div>}
        {p?.phone && <div><dt>Phone</dt><dd><a href={`tel:${p.phone}`}>{p.phone}</a></dd></div>}
        {website && <div><dt>Website</dt><dd><a href={website} target="_blank" rel="noreferrer">{website.replace(/^https?:\/\/(www\.)?/, '')}</a></dd></div>}
        {p?.distanceKm !== undefined && <div><dt>Distance</dt><dd>{p.distanceKm.toFixed(2)} km</dd></div>}
        <div><dt>Coordinates</dt><dd className="mono">{result.lat.toFixed(5)}, {result.lng.toFixed(5)}</dd></div>
      </dl>
    </div>
  );
}
