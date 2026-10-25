import { expect, test } from 'vitest';
import { mount } from '@vue/test-utils';
import Schematic from '../Schematic.vue';
const SQ = { ring: [[-10, -10], [10, -10], [10, 10], [-10, 10]], area_m2: 400 };
const beds = [{ key: 'a', label: 'Tomatoes', plant: { type: 'annual', title: 'Tomato' }, piece: 0 }, { key: 'b', label: null, plant: null, piece: 0 }];

test('renders one focusable bed per bed with an aria-label, and emits select on click and Enter', async () => {
  const w = mount(Schematic, { props: { pieces: [SQ], beds, selected: null, seed: 's' } });
  const items = w.findAll('.sc-bed');
  expect(items).toHaveLength(2);
  expect(items[0].attributes('tabindex')).toBe('0');
  expect(items[0].attributes('aria-label')).toBe('Tomatoes, bed 1, Tomato');
  expect(items[1].attributes('aria-label')).toBe('Bed 2, bed 2, empty bed');
  await items[0].trigger('click');
  await items[1].trigger('keydown', { key: 'Enter' });
  expect(w.emitted('select').map(e => e[0])).toEqual([0, 1]);
});
test('clicking empty stage emits deselect; empty beds show the empty text', async () => {
  const w = mount(Schematic, { props: { pieces: [SQ], beds: [], selected: null, seed: 's' } });
  expect(w.text()).toContain('No beds laid out yet');
  await w.find('svg').trigger('click');
  expect(w.emitted('deselect')).toHaveLength(1);
});
test('selected bed is outlined and marked pressed', () => {
  const w = mount(Schematic, { props: { pieces: [SQ], beds, selected: 1, seed: 's' } });
  expect(w.findAll('.sc-bed')[1].attributes('aria-pressed')).toBe('true');
  expect(w.findAll('.sc-bed')[1].find('rect').attributes('stroke')).toBe('#2b2b2b');
  expect(w.findAll('.sc-bed')[0].attributes('aria-pressed')).toBe('false');
});
test('Escape on the svg emits deselect', async () => {
  const w = mount(Schematic, { props: { pieces: [SQ], beds, selected: 0, seed: 's' } });
  await w.find('svg').trigger('keydown', { key: 'Escape' });
  expect(w.emitted('deselect')).toHaveLength(1);
});
test('clicking a bed selects without deselecting', async () => {
  const w = mount(Schematic, { props: { pieces: [SQ], beds, selected: null, seed: 's' } });
  await w.findAll('.sc-bed')[0].trigger('click');
  expect(w.emitted('select')).toHaveLength(1);
  expect(w.emitted('deselect')).toBeUndefined();
});
test('a drag suppresses the following click, a plain click then deselects', async () => {
  const w = mount(Schematic, { props: { pieces: [SQ], beds, selected: null, seed: 's' } });
  const svg = w.find('svg');
  await svg.trigger('pointerdown', { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
  await svg.trigger('pointermove', { clientX: 20, clientY: 20, pointerId: 1 });
  await svg.trigger('pointerup', { clientX: 20, clientY: 20, pointerId: 1 });
  await svg.trigger('click');
  expect(w.emitted('deselect')).toBeUndefined();
  expect(w.emitted('select')).toBeUndefined();
  await svg.trigger('click');
  expect(w.emitted('deselect')).toHaveLength(1);
});
test('far-apart pieces show lettered pieces and the not-to-scale caption', () => {
  const far = { ring: SQ.ring.map(([x, y]) => [x + 900, y]), area_m2: 400 };
  const w = mount(Schematic, { props: { pieces: [SQ, far], beds, selected: null, seed: 's' } });
  expect(w.text()).toContain('not to scale');
  const letters = w.findAll('.sc-letter').map((l) => l.text());
  expect(letters).toEqual(['A', 'B']);
});
