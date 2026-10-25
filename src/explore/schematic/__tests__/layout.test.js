import { describe, expect, test } from 'vitest';
import { layoutSchematic } from '../layout.js';
import { BED_COLORS } from '../colors.js';

const SQ = { ring: [[-10, -10], [10, -10], [10, 10], [-10, 10]], area_m2: 400 };
const stage = { width: 800, height: 600 };
const bed = (i, piece = 0, type = 'annual') => ({ key: `b${i}`, label: `Bed ${i}`, plant: { type, title: 'T' }, piece });

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
  test('trees are deterministic for a seed', () => {
    const a = layoutSchematic({ pieces: [SQ], beds: [], options: {}, stage, seed: 'riverside' });
    const b = layoutSchematic({ pieces: [SQ], beds: [], options: {}, stage, seed: 'riverside' });
    expect(a.trees).toEqual(b.trees);
  });
});
