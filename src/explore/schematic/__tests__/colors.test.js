import { describe, expect, test } from 'vitest';
import { BED_COLORS, colorFor, pieceLetter } from '../colors.js';

describe('colors', () => {
  test('colorFor maps by archetype and falls back to annual, empty for no plant', () => {
    expect(colorFor({ type: 'herb' })).toEqual(BED_COLORS.herb);
    expect(colorFor({ type: 'cactus' })).toEqual(BED_COLORS.annual);
    expect(colorFor(null)).toEqual(BED_COLORS.empty);
  });
  test('pieceLetter', () => {
    expect(pieceLetter(0, 1)).toBeNull();
    expect(pieceLetter(0, 2)).toBe('A');
    expect(pieceLetter(2, 3)).toBe('C');
  });
});
