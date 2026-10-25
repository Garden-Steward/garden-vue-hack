import { test, expect } from 'vitest';
import {
  makeCellGrid,
  cellIndexAt,
  cellCentre,
  cellCorner,
  pointInRing,
  allowedFromPolygons,
  allowedWithinRadius,
} from '../geo-cells.js';
import { metersPerDegree } from '../mercator.js';

const grid = makeCellGrid({ center: { latitude: 37.802306, longitude: -122.241417 } });

test('grid dimensions', () => {
  expect(grid.cols).toBe(215);
  expect(grid.rows).toBe(215);
  expect(grid.size).toBe(215 * 215);
});

test('centre cell maps back near the centre', () => {
  const i = cellIndexAt(grid, 37.802306, -122.241417);
  const c = cellCentre(grid, i);
  expect(c.latitude).toBeCloseTo(37.802306, 4);
  expect(c.longitude).toBeCloseTo(-122.241417, 4);
});

test('outside is -1', () => {
  expect(cellIndexAt(grid, 37.9, -122.24)).toBe(-1);
  expect(cellIndexAt(grid, 37.802306, -122.3)).toBe(-1);
});

test('corners go west to east and north to south', () => {
  const [w, n] = cellCorner(grid, 0, 0);
  const [e, s] = cellCorner(grid, grid.cols, grid.rows);
  expect(e).toBeGreaterThan(w);
  expect(n).toBeGreaterThan(s);
  expect((e - w) * metersPerDegree(37.8).lng).toBeCloseTo(301, 0);
});

test('row 0 is the north edge', () => {
  const i = cellIndexAt(grid, grid.bounds.north - 1e-7, grid.bounds.west + 1e-7);
  expect(i).toBe(0);
  const last = cellIndexAt(grid, grid.bounds.south + 1e-7, grid.bounds.east - 1e-7);
  expect(last).toBe(grid.size - 1);
});

test('allowedWithinRadius(100) marks about pi*100^2/1.96 cells', () => {
  const n = allowedWithinRadius(grid, 100).reduce((a, b) => a + b, 0);
  expect(n).toBeGreaterThan(15500);
  expect(n).toBeLessThan(16500);
});

test('allowedFromPolygons marks cells inside a ring only', () => {
  const [w, n] = cellCorner(grid, 100, 100);
  const [e, s] = cellCorner(grid, 110, 110);
  const ring = [[w, n], [e, n], [e, s], [w, s], [w, n]];
  expect(allowedFromPolygons(grid, [ring]).reduce((a, b) => a + b, 0)).toBe(100);
});

test('pointInRing works with an unclosed ring', () => {
  const ring = [[0, 0], [4, 0], [4, 4], [0, 4]];
  expect(pointInRing(2, 2, ring)).toBe(true);
  expect(pointInRing(5, 2, ring)).toBe(false);
});
