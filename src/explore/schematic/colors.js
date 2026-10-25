import { archetypeOf } from './archetype.js';

/** Bed colours by plant family. `chip` is the label background. */
export const BED_COLORS = {
  annual: { fill: '#e3a088', stroke: '#b56a52', chip: '#fbf7f4' },
  perennial: { fill: '#9fbf8a', stroke: '#5e8a52', chip: '#f6faf3' },
  herb: { fill: '#cfe0bf', stroke: '#87a877', chip: '#f9fbf6' },
  wildflower: { fill: '#e1b9d9', stroke: '#a874a0', chip: '#fbf5fa' },
  shrub: { fill: '#b7c9a0', stroke: '#6f8a5a', chip: '#f7faf2' },
  tree: { fill: '#a9bf9b', stroke: '#5d7a4e', chip: '#f5f8f1' },
  fungi: { fill: '#d9c7b0', stroke: '#9a7f5e', chip: '#faf7f2' },
  empty: { fill: '#dedcd3', stroke: '#a6a39a', chip: '#f7f6f1' },
};

export function colorFor(plant) {
  if (!plant) return BED_COLORS.empty;
  return BED_COLORS[archetypeOf(plant.type)];
}

/** 'A', 'B', ... only when the garden has more than one piece. */
export function pieceLetter(index, count) {
  if (count <= 1) return null;
  return String.fromCharCode(65 + index);
}
