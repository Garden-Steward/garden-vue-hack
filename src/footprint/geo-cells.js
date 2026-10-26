// Fixed geographic cell lattice (equirectangular around a centre) used by the
// click-to-estimate tool. Row 0 is the north edge; index = cy * cols + cx.
import { metersPerDegree } from './mercator.js';

export function makeCellGrid({ center, cellMetres = 1.4, halfSizeMetres = 150 }) {
  const mpd = metersPerDegree(center.latitude);
  const cols = Math.ceil((2 * halfSizeMetres) / cellMetres);
  const rows = cols;
  const origin = {
    latitude: center.latitude + halfSizeMetres / mpd.lat,
    longitude: center.longitude - halfSizeMetres / mpd.lng,
  };
  const bounds = {
    north: origin.latitude,
    west: origin.longitude,
    south: origin.latitude - (rows * cellMetres) / mpd.lat,
    east: origin.longitude + (cols * cellMetres) / mpd.lng,
  };
  return { cols, rows, cellMetres, origin, bounds, size: cols * rows, center: { ...center }, mpd };
}

export function cellIndexAt(grid, latitude, longitude) {
  const cx = Math.floor(((longitude - grid.origin.longitude) * grid.mpd.lng) / grid.cellMetres);
  const cy = Math.floor(((grid.origin.latitude - latitude) * grid.mpd.lat) / grid.cellMetres);
  if (!(cx >= 0 && cx < grid.cols && cy >= 0 && cy < grid.rows)) return -1;
  return cy * grid.cols + cx;
}

export function cellCorner(grid, cx, cy) {
  return [
    grid.origin.longitude + (cx * grid.cellMetres) / grid.mpd.lng,
    grid.origin.latitude - (cy * grid.cellMetres) / grid.mpd.lat,
  ];
}

export function cellCentre(grid, index) {
  const cx = index % grid.cols;
  const cy = Math.floor(index / grid.cols);
  const [lng, lat] = cellCorner(grid, cx + 0.5, cy + 0.5);
  return { latitude: lat, longitude: lng };
}

// Even-odd ray cast. Works whether or not the ring repeats its first point.
export function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function allowedFromPolygons(grid, rings) {
  const mask = new Uint8Array(grid.size);
  const prepared = rings.map((ring) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { ring, minX, minY, maxX, maxY };
  });
  for (let cy = 0; cy < grid.rows; cy++) {
    for (let cx = 0; cx < grid.cols; cx++) {
      const [lng, lat] = cellCorner(grid, cx + 0.5, cy + 0.5);
      for (const p of prepared) {
        if (lng < p.minX || lng > p.maxX || lat < p.minY || lat > p.maxY) continue;
        if (pointInRing(lng, lat, p.ring)) {
          mask[cy * grid.cols + cx] = 1;
          break;
        }
      }
    }
  }
  return mask;
}

export function allowedWithinRadius(grid, metres) {
  const mask = new Uint8Array(grid.size);
  const r2 = metres * metres;
  for (let cy = 0; cy < grid.rows; cy++) {
    for (let cx = 0; cx < grid.cols; cx++) {
      const [lng, lat] = cellCorner(grid, cx + 0.5, cy + 0.5);
      const dx = (lng - grid.center.longitude) * grid.mpd.lng;
      const dy = (lat - grid.center.latitude) * grid.mpd.lat;
      if (dx * dx + dy * dy <= r2) mask[cy * grid.cols + cx] = 1;
    }
  }
  return mask;
}
