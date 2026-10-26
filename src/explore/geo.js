// Address / ZIP lookup and nearest-garden ranking for the Explore page.

// OpenStreetMap's free geocoder, matching the map tiles. Its usage policy allows
// light use (at most one request a second, no search-as-you-type), so we only
// query when the visitor submits.
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const US_ZIP = /^\d{5}(?:-\d{4})?$/;

const EARTH_RADIUS_KM = 6371;
const KM_PER_MILE = 1.609344;
const rad = (deg) => (deg * Math.PI) / 180;

/** Bounding box around `points` ({ lat, lng }), padded so nearby towns still rank well. */
export function searchArea(points, padDeg = 0.5) {
  if (!points.length) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    south: Math.max(-90, Math.min(...lats) - padDeg),
    west: Math.max(-180, Math.min(...lngs) - padDeg),
    north: Math.min(90, Math.max(...lats) + padDeg),
    east: Math.min(180, Math.max(...lngs) + padDeg),
  };
}

export function geocodeUrl(query, near) {
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1' });
  const q = query.trim();
  if (US_ZIP.test(q)) {
    // A bare 5-digit number is a postcode in many countries; read it as a US ZIP.
    params.set('postalcode', q.slice(0, 5));
    params.set('countrycodes', 'us');
  } else {
    params.set('q', q);
  }
  // Prefer matches near the gardens without excluding places elsewhere.
  if (near) params.set('viewbox', [near.west, near.north, near.east, near.south].join(','));
  return `${ENDPOINT}?${params}`;
}

/** Resolves to `{ lat, lng, label }`, or null when nothing matched. */
export async function geocode(query, near, signal) {
  const res = await fetch(geocodeUrl(query, near), { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geocoder responded ${res.status}`);
  const [hit] = await res.json();
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, label: String(hit.display_name ?? query) };
}

/** Great-circle (haversine) distance in kilometres. */
export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** `items` each need `lat` and `lng`; returns `{ item, km }` nearest first. */
export function nearest(items, from, limit = 5) {
  return items
    .map((item) => ({ item, km: distanceKm(from, item) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

export function formatDistance(km) {
  const miles = km / KM_PER_MILE;
  if (miles < 0.1) return 'under 0.1 mi';
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles).toLocaleString('en-US')} mi`;
}
