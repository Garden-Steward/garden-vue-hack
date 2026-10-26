import { test, expect } from 'vitest';
import { lngLatToMeters, metersToLngLat, tileToBbox3857, metersPerDegree } from '../mercator.js';

test('tile 19/84117/202597 covers the Oakland pin', () => {
  const [minX, minY, maxX, maxY] = tileToBbox3857(19, 84117, 202597);
  const [px, py] = lngLatToMeters(-122.241417, 37.802306);
  expect(px).toBeGreaterThan(minX); expect(px).toBeLessThan(maxX);
  expect(py).toBeGreaterThan(minY); expect(py).toBeLessThan(maxY);
  expect(maxX - minX).toBeCloseTo(76.437, 2);
});

test('round trip', () => {
  const [x, y] = lngLatToMeters(-122.24, 37.8);
  const [lng, lat] = metersToLngLat(x, y);
  expect(lng).toBeCloseTo(-122.24, 9);
  expect(lat).toBeCloseTo(37.8, 9);
});

test('metersPerDegree', () => {
  expect(metersPerDegree(0)).toEqual({ lng: 111320, lat: 110574 });
  expect(metersPerDegree(60).lng).toBeCloseTo(55660, 3);
});
