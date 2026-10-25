import { describe, expect, test } from 'vitest';
import { layoutSchematic } from '../layout.js';
import { BED_COLORS } from '../colors.js';

const SQ = { ring: [[-10, -10], [10, -10], [10, 10], [-10, 10]], area_m2: 400 };
const stage = { width: 800, height: 600 };
const bed = (i, piece = 0, type = 'annual') => ({ key: `b${i}`, label: `Bed ${i}`, plant: { type, title: 'T' }, piece });

function inside([x, y], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

describe('layoutSchematic', () => {
  test('one piece, four beds: all beds inside the piece, path present, two trees', () => {
    const L = layoutSchematic({ pieces: [SQ], beds: [0, 1, 2, 3].map(i => bed(i)), options: {}, stage, seed: 'x' });
    expect(L.pieces).toHaveLength(1);
    expect(L.pieces[0].letter).toBeNull();
    expect(L.beds).toHaveLength(4);
    expect(L.paths).toHaveLength(1);
    expect(L.trees).toHaveLength(2);
    const [minX, maxX] = [Math.min(...L.pieces[0].points.map(p => p[0])), Math.max(...L.pieces[0].points.map(p => p[0]))];
    for (const b of L.beds) { expect(b.x).toBeGreaterThan(minX); expect(b.x).toBeLessThan(maxX); }
    expect(L.notToScale).toBe(false);
  });
  test('a piece too small for inset corners gets no trees', () => {
    const tiny = { ring: [[-3, -3], [3, -3], [3, 3], [-3, 3]], area_m2: 36 };
    const L = layoutSchematic({ pieces: [tiny], beds: [], options: {}, stage, seed: 'x' });
    expect(L.trees).toHaveLength(0);
  });
  test('default rectangle for 0 beds is as wide as for 4 beds', () => {
    const width = (beds) => {
      const xs = layoutSchematic({ pieces: [], beds, options: {}, stage, seed: 'x' }).pieces[0].points.map(p => p[0]);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width([])).toBeCloseTo(width([0, 1, 2, 3].map(i => bed(i))), 6);
  });
  test('no pieces: a default rectangle sized to the beds', () => {
    const L = layoutSchematic({ pieces: [], beds: [bed(0), bed(1)], options: {}, stage, seed: 'x' });
    expect(L.pieces).toHaveLength(1);
    expect(L.beds).toHaveLength(2);
  });
  test('bad rings and null shape fall back', () => {
    expect(() => layoutSchematic({ pieces: null, beds: [], options: {}, stage, seed: 'x' })).not.toThrow();
    expect(layoutSchematic({ pieces: [{ ring: [[0, 0], [1, 1]] }], beds: [], options: {}, stage, seed: 'x' }).pieces).toHaveLength(1);
  });
  test('piece index out of range goes to piece 0', () => {
    const L = layoutSchematic({ pieces: [SQ], beds: [bed(0, 3)], options: {}, stage, seed: 'x' });
    expect(L.beds[0].piece).toBe(0);
  });
  test('two far-apart pieces go side by side and are lettered', () => {
    const far = { ring: SQ.ring.map(([x, y]) => [x + 900, y]), area_m2: 400 };
    const L = layoutSchematic({ pieces: [SQ, far], beds: [bed(0, 0), bed(1, 1)], options: {}, stage, seed: 'x' });
    expect(L.notToScale).toBe(true);
    expect(L.pieces.map(p => p.letter)).toEqual(['A', 'B']);
    expect(L.scale * 2.4).toBeGreaterThanOrEqual(60);
  });
  test('64 beds in a tiny piece still render every bed at least 60 px wide', () => {
    const tiny = { ring: [[-5, -5], [5, -5], [5, 5], [-5, 5]], area_m2: 100 };
    const L = layoutSchematic({ pieces: [tiny], beds: Array.from({ length: 64 }, (_, i) => bed(i)), options: {}, stage, seed: 'x' });
    expect(L.beds).toHaveLength(64);
    expect(Math.min(...L.beds.map(b => b.w))).toBeGreaterThanOrEqual(60);
    expect(L.notToScale).toBe(true);
    expect(L.size.width).toBeLessThan(5000);
    expect(L.size.height).toBeLessThan(5000);
  });
  test('thin piece stays bounded and keeps beds readable', () => {
    const thin = { ring: [[-15, -2.5], [15, -2.5], [15, 2.5], [-15, 2.5]], area_m2: 150 };
    const L = layoutSchematic({ pieces: [thin], beds: [bed(0), bed(1)], options: {}, stage, seed: 'x' });
    expect(L.size.width).toBeLessThan(5000);
    expect(L.size.height).toBeLessThan(5000);
    for (const b of L.beds) expect(b.w).toBeGreaterThanOrEqual(60);
  });
  test('rotated ring: every rotated bed corner lies inside the piece polygon', () => {
    const t = Math.PI / 6;
    const ring = [[-10, -6], [10, -6], [10, 6], [-10, 6]].map(([x, y]) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)]);
    const L = layoutSchematic({ pieces: [{ ring, area_m2: 240 }], beds: Array.from({ length: 6 }, (_, i) => bed(i)), options: {}, stage, seed: 'x' });
    const poly = L.pieces[0].points;
    for (const b of L.beds) {
      const r = b.angle * Math.PI / 180;
      for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = i * b.w / 2, ly = j * b.h / 2;
        const pt = [b.x + lx * Math.cos(r) - ly * Math.sin(r), b.y + lx * Math.sin(r) + ly * Math.cos(r)];
        expect(inside(pt, poly)).toBe(true);
      }
    }
  });
  test('default rectangle grows with bed count', () => {
    const width = (n) => {
      const L = layoutSchematic({ pieces: [], beds: Array.from({ length: n }, (_, i) => bed(i)), options: {}, stage, seed: 'x' });
      const xs = L.pieces[0].points.map(p => p[0]);
      return (Math.max(...xs) - Math.min(...xs)) / L.scale;
    };
    expect(width(40)).toBeGreaterThan(width(2));
  });
  test('undefined option fields take defaults', () => {
    const L = layoutSchematic({ pieces: [SQ], beds: [], options: { trees: undefined, path: null, rows: undefined }, stage, seed: 'x' });
    expect(L.trees).toHaveLength(2);
    expect(L.paths).toHaveLength(1);
  });
  test('many trees over pieces sharing a factor with 4 use distinct spots', () => {
    const ps = [0, 1, 2, 3].map(k => ({ ring: SQ.ring.map(([x, y]) => [x + k * 40, y]), area_m2: 400 }));
    const L = layoutSchematic({ pieces: ps, beds: [], options: { trees: 8 }, stage, seed: 'x' });
    const spots = new Set(L.trees.map(t => `${t.x.toFixed(2)},${t.y.toFixed(2)}`));
    expect(spots.size).toBe(8);
  });
  test('options: path none, rows 1, trees 0', () => {
    const L = layoutSchematic({ pieces: [SQ], beds: [bed(0)], options: { path: 'none', rows: 1, trees: 0 }, stage, seed: 'x' });
    expect(L.paths).toHaveLength(0);
    expect(L.trees).toHaveLength(0);
  });
  test('labels and numbering', () => {
    const L = layoutSchematic({ pieces: [SQ], beds: [{ key: 'a', label: null, plant: { type: 'herb', title: 'Basil' }, piece: 0 }, { key: 'b', label: 'Kale', plant: null, piece: 0 }], options: {}, stage, seed: 'x' });
    expect(L.beds[0].label).toBe('Basil'); expect(L.beds[0].sub).toBe('Bed 1'); expect(L.beds[0].color).toEqual(BED_COLORS.herb);
    expect(L.beds[1].label).toBe('Kale'); expect(L.beds[1].color).toEqual(BED_COLORS.empty);
  });
  test('rearranged pieces too shallow for trees do not throw', () => {
    const shallow = (dx) => ({ ring: [[-10 + dx, -4], [10 + dx, -4], [10 + dx, 4], [-10 + dx, 4]], area_m2: 160 });
    let L;
    expect(() => {
      L = layoutSchematic({ pieces: [shallow(0), shallow(300)], beds: [bed(0, 0), bed(1, 1)], options: {}, stage, seed: 'x' });
    }).not.toThrow();
    expect(L.beds).toHaveLength(2);
    expect(L.trees).toHaveLength(0);
    const mixed = [SQ, shallow(300), { ring: SQ.ring.map(([x, y]) => [x - 300, y]), area_m2: 400 }];
    expect(() => {
      L = layoutSchematic({ pieces: mixed, beds: [bed(0, 0), bed(1, 1), bed(2, 2)], options: {}, stage, seed: 'x' });
    }).not.toThrow();
    expect(L.beds).toHaveLength(3);
    expect(L.trees).toHaveLength(2);
  });
  test('trees are deterministic for a seed', () => {
    const a = layoutSchematic({ pieces: [SQ], beds: [], options: {}, stage, seed: 'riverside' });
    const b = layoutSchematic({ pieces: [SQ], beds: [], options: {}, stage, seed: 'riverside' });
    expect(a.trees).toEqual(b.trees);
  });
});
