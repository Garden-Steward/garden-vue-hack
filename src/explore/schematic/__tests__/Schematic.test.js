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
});
