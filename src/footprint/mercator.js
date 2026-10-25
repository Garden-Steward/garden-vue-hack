// Spherical Web Mercator (EPSG:3857) helpers.
export const EARTH_R = 6378137;
const MAX_LAT = 85.05112878;
const DEG = Math.PI / 180;

export function lngLatToMeters(lng, lat) {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const x = EARTH_R * lng * DEG;
  const y = EARTH_R * Math.log(Math.tan(Math.PI / 4 + (clamped * DEG) / 2));
  return [x, y];
}

export function metersToLngLat(x, y) {
  const lng = (x / EARTH_R) / DEG;
  const lat = (2 * Math.atan(Math.exp(y / EARTH_R)) - Math.PI / 2) / DEG;
  return [lng, lat];
}

// XYZ tile (origin top-left, y increasing southward) -> [minX, minY, maxX, maxY] in metres.
export function tileToBbox3857(z, x, y) {
  const size = (2 * Math.PI * EARTH_R) / 2 ** z;
  const origin = Math.PI * EARTH_R;
  const minX = -origin + x * size;
  const maxY = origin - y * size;
  return [minX, maxY - size, minX + size, maxY];
}

export function metersPerDegree(lat) {
  return { lng: 111320 * Math.cos(lat * DEG), lat: 110574 };
}
