// Coordinate parsing and US check for the Add-a-garden wizard. Pure, no dependencies.

const NUM = '(\\d+(?:\\.\\d+)?)';
// One coordinate: [-]degrees [°] [minutes ' or ′] [seconds " or ″ or ''] [N|S|E|W]
const COMPONENT =
  '(-?)' + NUM + '\\s*°?\\s*(?:' + NUM + "\\s*['′]\\s*)?(?:" + NUM + '\\s*(?:["″]|\'\')\\s*)?([NSEWnsew])?';
const PAIR = new RegExp('^' + COMPONENT + '\\s*[,\\s]\\s*' + COMPONENT + '$');
const MAPS_FRAGMENT = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;

function valid(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

// m = match array, i = index of the first group of a component (sign, deg, min, sec, letter)
function component(m, i) {
  const [sign, deg, min, sec, letter] = m.slice(i, i + 5);
  const minutes = min === undefined ? 0 : Number(min);
  const seconds = sec === undefined ? 0 : Number(sec);
  if (minutes >= 60 || seconds >= 60) return null;
  let value = Number(deg) + minutes / 60 + seconds / 3600;
  const hemi = letter ? letter.toUpperCase() : null;
  if (hemi && sign) return null; // "-37 S" is contradictory
  if (sign || hemi === 'S' || hemi === 'W') value = -value;
  return { value, hemi };
}

export function parseCoordinates(text) {
  if (typeof text !== 'string') return null;
  const t = text
    .replace(/[\u2212\u2013]/g, '-')
    .trim()
    .replace(/[.,]$/, '')
    .trim();
  if (!t) return null;

  const link = t.match(MAPS_FRAGMENT);
  if (link) return valid(Number(link[1]), Number(link[2]));

  const m = t.match(PAIR);
  if (!m) return null;
  const a = component(m, 1);
  const b = component(m, 6);
  if (!a || !b) return null;

  if (a.hemi || b.hemi) {
    if (!a.hemi || !b.hemi) return null;
    const aIsLat = a.hemi === 'N' || a.hemi === 'S';
    const bIsLat = b.hemi === 'N' || b.hemi === 'S';
    if (aIsLat === bIsLat) return null;
    return aIsLat ? valid(a.value, b.value) : valid(b.value, a.value);
  }

  // Bare pair: never swap silently. A first number outside +-90 with a plausible second is lng, lat.
  if (Math.abs(a.value) > 90 && Math.abs(b.value) <= 90) return null;
  return valid(a.value, b.value);
}

export function formatDecimal({ latitude, longitude }) {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

// [south, west, north, east]
const US_BOXES = [
  [24.4, -125.0, 49.4, -66.9], // CONUS
  [51.0, -180.0, 71.5, -129.9], // Alaska
  [18.9, -160.3, 22.3, -154.8], // Hawaii
];

export function isInUS(latitude, longitude) {
  return US_BOXES.some(([s, w, n, e]) => latitude >= s && latitude <= n && longitude >= w && longitude <= e);
}
