# Add a Garden, Plan 2 of 3: Explore Schematic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explore shows every garden as a flat SVG schematic drawn from its footprint shape and bed list, replacing the three.js floating island, and the bed editor learns pieces and layout knobs.

**Architecture:** A pure layout module turns `{ pieces, beds, options, stage }` into pixel geometry; a `Schematic.vue` component renders that geometry as SVG with pan, zoom, selection and keyboard access; `ExploreView.vue` swaps the viewer mount for the component. The three.js viewer directory and dependency are deleted. Vitest is added to the repo for the pure modules and one component test.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, Vite 8, Leaflet (unchanged), Vitest + @vue/test-utils + happy-dom (new dev deps), yarn.

**Spec:** `docs/superpowers/specs/2026-10-25-add-garden-design.md`, sections "Explore: the schematic replaces the island", "Step 2: beds", "Editing after creation", "Sequencing".

## Global Constraints

- Frontend repo root: `/Users/harrisonnguyen/Desktop/gardens/garden-vue-hack`. Package manager is yarn (`yarn.lock` is tracked; the stray untracked `package-lock.json` is left alone).
- Needs the backend from Plan 1 for `footprint_shape` on gardens and `schematic`/`piece` on `/plots`; until it is deployed the frontend treats both as absent (default rectangle, piece 0, default knobs).
- Bed size 2.4 m × 1.2 m. Minimum rendered bed width 60 px. Path strip 1.5 m. Trees radius 2.5 m. Pieces lettered "A", "B", … only when there is more than one.
- Colours by plant family from `archetypeOf` (seven names: annual, perennial, herb, tree, shrub, wildflower, fungi) plus `empty` grey; paper background `#f6f6f0`, dashed outline `#8a8a80`, path `#e7e5de`, tree `#c9d8bf` with dot `#6c8a5e`, selection outline `#2b2b2b`.
- Every bed is focusable with an `aria-label` of the form `"<label>, bed <n>, <plant title>"` (`"empty bed"` when no plant).
- `three` is removed from `package.json`; `src/explore/viewer/` is deleted; no WebGL code remains.
- Commits with the stdin heredoc form, one per task.

## Review Focus

1. A garden whose saved beds all reference piece 3 while the footprint has one piece must still draw every bed (in piece 0), not drop them. (Task 3)
2. A footprint piece ring with fewer than 3 points, or `footprint_shape: null`, must fall back to the default rectangle, not throw. (Task 3)
3. 64 beds (the backend maximum) in a 100 m² piece must render with readable labels, scaled, with `notToScale` set, not overlap off-canvas. (Task 3)
4. Keyboard: Tab reaches each bed in order, Enter selects, Escape deselects, and focus returns to the opener on close. (Task 4)
5. The bed editor with no garden slug (wizard use) must not call the network on save. (Task 6)

---

### Task 1: Baseline commit and Vitest

**Files:**
- Commit as-is: all currently uncommitted Explore work (`src/explore/`, `src/views/ExploreView.vue`, `package.json`, `yarn.lock`, `src/App.vue`, `src/components/Nav.vue`, `src/helpers/router.js`, `.gitignore`, `docs/superpowers/`). Exclude `videos/explore-trailer/` and `package-lock.json` (leave untracked).
- Modify: `package.json` (devDependencies, `test` script)
- Create: `vitest.config.js`
- Create: `src/explore/schematic/__tests__/smoke.test.js`

**Interfaces:**
- Produces: `yarn test` runs Vitest once; `@` alias resolves to `src`; environment `happy-dom`.

- [ ] **Step 1: Baseline commit**

```bash
cd /Users/harrisonnguyen/Desktop/gardens/garden-vue-hack
git add .gitignore package.json yarn.lock src/App.vue src/components/Nav.vue src/helpers/router.js src/explore src/views/ExploreView.vue docs/superpowers
git commit -F - <<'EOF'
chore: baseline for add-garden work (Explore page with three.js island, design and plans)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

- [ ] **Step 2: Add Vitest**

Run: `yarn add -D vitest @vue/test-utils happy-dom`
If yarn reports a peer conflict between Vitest and Vite 8, add the newest Vitest major whose peer range includes Vite 8 (check with `yarn info vitest peerDependencies`).

`vitest.config.js`:
```js
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'happy-dom', include: ['src/**/*.test.js'] },
});
```
Add `"test": "vitest run"` to scripts.

- [ ] **Step 3: Write a smoke test and run it**

`src/explore/schematic/__tests__/smoke.test.js`: `test('vitest runs', () => expect(1 + 1).toBe(2))`.
Run: `yarn test`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add package.json yarn.lock vitest.config.js src/explore/schematic/__tests__/smoke.test.js
git commit -F - <<'EOF'
chore: add vitest with happy-dom and @vue/test-utils

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: Colours and piece letters

**Files:**
- Create: `src/explore/schematic/colors.js`
- Create: `src/explore/schematic/__tests__/colors.test.js`

**Interfaces:**
- Produces: `export const BED_COLORS` mapping each of the 7 archetypes and `empty` to `{ fill, stroke, chip }` (chip is the label background). Values: annual `#e3a088/#b56a52/#fbf7f4`, perennial `#9fbf8a/#5e8a52/#f6faf3`, herb `#cfe0bf/#87a877/#f9fbf6`, wildflower `#e1b9d9/#a874a0/#fbf5fa`, shrub `#b7c9a0/#6f8a5a/#f7faf2`, tree `#a9bf9b/#5d7a4e/#f5f8f1`, fungi `#d9c7b0/#9a7f5e/#faf7f2`, empty `#dedcd3/#a6a39a/#f7f6f1`.
- Produces: `export function colorFor(plant) -> { fill, stroke, chip }` using `archetypeOf(plant?.type)` from `@/explore/viewer/plants` until Task 7 moves `archetypeOf` to `src/explore/schematic/archetype.js` (do the move here: create `archetype.js` exporting `PLANT_TYPES` and `archetypeOf`, and make `viewer/plants.js` import from it).
- Produces: `export function pieceLetter(index, count) -> string | null` (`null` when `count <= 1`, else `'A'`, `'B'`, …).

- [ ] **Step 1: Failing tests**

```js
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
```

- [ ] **Step 2: Run, expect FAIL** (`yarn test`)
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** — `feat(schematic): bed colours by plant family, piece letters`

---

### Task 3: Layout module

**Files:**
- Create: `src/explore/schematic/layout.js`
- Create: `src/explore/schematic/__tests__/layout.test.js`

**Interfaces:**
- Consumes: `colorFor`, `pieceLetter` (Task 2).
- Produces: `export function layoutSchematic({ pieces, beds, options, stage, seed }) -> Layout`.
  - `pieces`: `[{ ring: [[x, y], …], area_m2 }]` in metres, y north; may be `[]`, `null`, or contain rings with fewer than 3 points (those pieces are dropped; if none remain, the default rectangle is used).
  - `beds`: `[{ key, label, plant: { type, title } | null, piece }]`; `piece` out of range or missing → 0.
  - `options`: `{ rows: number | null, path: 'centre' | 'left' | 'right' | 'none', trees: number }`, any missing field takes the default `{ rows: null, path: 'centre', trees: 2 }`.
  - `stage`: `{ width, height }` in px (both ≥ 1).
  - `seed`: string; decides which corner trees start in (`hash(seed) % 4`).
  - Returns `{ scale, notToScale, pieces: [{ index, points: [[px, py]…], letter, centre: [px, py] }], beds: [{ index, key, piece, x, y, w, h, angle, label, sub, color }], paths: [{ points }], trees: [{ x, y, r }], size: { width, height } }` where `x, y` is the bed centre in px, `angle` degrees, `sub` is `"Bed <n>"` numbered across all beds in input order, `label` is the bed label or `plant.title` or `"Bed <n>"`.
- Constants exported: `BED_W = 2.4`, `BED_D = 1.2`, `BED_GAP = 1.0`, `PATH_W = 1.5`, `MARGIN = 2.0`, `TREE_R = 2.5`, `MIN_BED_PX = 60`, `DEFAULT_OPTIONS`.
- Algorithm (the parts the signature does not determine):
  1. Default rectangle when no usable pieces: rows `r = options.rows ?? max(1, round(sqrt(n / 2)))`, columns per side `c = ceil(n / (2r))` (min 1), width `= 2·MARGIN + 2·c·BED_W + 2·(c−1)·BED_GAP + PATH_W`, depth `= 2·MARGIN + r·BED_D + (r−1)·BED_GAP`; ring centred at origin.
  2. Per piece: oriented bounding box from the longest edge's direction; the long axis carries the path; beds fill a grid in the box's local frame on both sides of the path (`'none'` → one block centred), `rows` across the short axis (`null` → as many as fit), columns along the long axis in input order; if capacity < bed count, reduce `BED_GAP` to 0.4 m, then scale bed dimensions by `sqrt(capacity / n)`.
  3. Placement of several pieces: bounding box of all rings; `scale = 0.9 · min(stage.width / bboxW, stage.height / bboxD)`; if `scale · bedW < MIN_BED_PX` (where `bedW` is the possibly shrunk bed width from step 2), lay pieces left to right with a 4 m gap, recompute scale, set `notToScale = true`; if still below the minimum, use `MIN_BED_PX / bedW` as the scale so every rendered bed is at least `MIN_BED_PX` wide (the component pans).
  4. Trees: `options.trees` circles at the OBB corners inset `MARGIN + TREE_R`, cycling corners starting at `hash(seed) % 4` and cycling pieces.

- [ ] **Step 1: Failing tests**

```js
const SQ = { ring: [[-10, -10], [10, -10], [10, 10], [-10, 10]], area_m2: 400 };
const stage = { width: 800, height: 600 };
const bed = (i, piece = 0, type = 'annual') => ({ key: `b${i}`, label: `Bed ${i}`, plant: { type, title: 'T' }, piece });

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
```

- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement `layoutSchematic` per the algorithm above**
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** — `feat(schematic): pure layout from footprint pieces and beds`

---

### Task 4: `Schematic.vue`

**Files:**
- Create: `src/explore/schematic/Schematic.vue`
- Create: `src/explore/schematic/__tests__/Schematic.test.js`

**Interfaces:**
- Consumes: `layoutSchematic` (Task 3).
- Produces: component props `pieces` (Array|null), `beds` (Array, default `[]`), `options` (Object, default `{}`), `selected` (Number|null), `seed` (String, required), `emptyText` (String, default `'No beds laid out yet'`); emits `select(index: number)` and `deselect()`.
- Behaviour: measures its own box with `ResizeObserver` (falls back to 800×600 under test), re-runs layout on size or prop change; renders `<svg role="group" :aria-label="'Garden plan'">` with a `<g class="sc-view">` carrying `translate/scale` for pan and zoom (wheel zooms about the pointer between 0.5× and 6×, one-pointer drag pans, two-pointer pinch zooms; a drag under 4 px counts as a click); each bed is `<g class="sc-bed" role="button" tabindex="0" :aria-pressed="i === selected" :aria-label>` and selecting one emits `select(i)`; click or Enter/Space on a bed selects, click on empty stage emits `deselect`; the selected bed gets `stroke="#2b2b2b" stroke-width="2"`; when `beds.length === 0` the `emptyText` is centred in the first piece; when `layout.notToScale` a small caption "not to scale" sits bottom-left; piece letters are drawn at each piece's centre top.

- [ ] **Step 1: Failing component test**

```js
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
```

- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement the component** (scoped styles use the Global Constraints colours; fonts inherit from the page)
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** — `feat(schematic): SVG Schematic component with pan, zoom, selection and keyboard access`

---

### Task 5: Explore uses the schematic

**Files:**
- Modify: `src/views/ExploreView.vue` (imports 12-13, 18; `loadGardens` 79-92; `exploreGardens` 167-202; Island section 538-545; Plots section 547-592; `createViewer`/`destroyViewer` 594-627; `openPanel`/`closePanel` 633-647; template stage 874; plot editor 1065-1072; CSS `.explore-island` 1212-1215, 1517-1530)

**Interfaces:**
- Consumes: `Schematic.vue` (Task 4); backend `footprint_shape` on list items and `schematic` on `/plots` (Plan 1).
- Produces: in `exploreGardens`, each garden object gains `footprintShape: g.footprint_shape ?? null`. `savedPlots[slug]` becomes `{ plots: [...], schematic: {...} }`. `schematicBeds` (replaces `islandPlots`) returns `[{ key, label, plant, piece, count }]` with `piece: p.piece ?? 0` for saved beds and `piece: 0` for logged-plant fallbacks. `onPlotsSaved({ plots, schematic })` stores both. `selected` keeps its meaning (index into `schematicBeds`); `openPanel(i)` / `closePanel(clearViewer)` keep their signatures with `clearViewer` now meaning "clear `selected`".
- Template: `<div ref="stageEl" class="explore-stage"><Schematic :pieces="current.footprintShape?.pieces" :beds="schematicBeds" :options="savedPlots[current.slug]?.schematic" :selected="selected" :seed="current.slug" @select="openPanel" @deselect="closePanel(false)" /></div>`.

- [ ] **Step 1: Make the edits**

Remove the `mount` and `archetypeOf` imports, `viewer`, `sheetObserver`, `createViewer`, `destroyViewer`, `plotSignature` and its watch, and the `viewer?.selectPlot/clearSelection` calls in `closePanel`/`pickPlant` (replace with setting `selected`). `loadPlots` stores `{ plots, schematic: res?.data?.schematic ?? null }`. The `[mode, slug, user]` watch no longer calls viewer functions. Rename `.explore-island` to `.explore-stage` with background `#f6f6f0`, drop the `ex-arrive` sky gradient and `:deep(canvas)`/`:deep(.webgl-error)` rules; keep the `ResizeObserver` that insets the sheet only if `Schematic` needs a `padding` prop (it does not: the component is given the whole stage and the sheet overlays it; pass nothing).

- [ ] **Step 2: Run the existing tests and lint**

Run: `yarn test && yarn lint`
Expected: tests pass; lint reports no errors in `ExploreView.vue`.

- [ ] **Step 3: Manual check in the dev server**

Run `yarn dev`, open `/explore/<a garden slug>`: the schematic renders in the stage, tapping a bed opens the side sheet with the plant, Escape closes it, the "Edit beds" button still shows for a manager, a garden with no beds shows logged plants as unlabelled beds.
Expected: all four behaviours observed; note any garden that renders empty.

- [ ] **Step 4: Commit** — `feat(explore): schematic replaces the floating island`

---

### Task 6: Bed editor: pieces, knobs, controlled mode

**Files:**
- Modify: `src/explore/ExplorePlotEditor.vue` (props 13-19, emits 20, rows/`row()` 23-27, save 153-172, template rows and footer)
- Modify: `src/views/ExploreView.vue` (editor usage 1065-1072, `onPlotsSaved`)
- Create: `src/explore/__tests__/ExplorePlotEditor.test.js`

**Interfaces:**
- Produces: props `gardenSlug: { type: String, default: null }` (null → controlled mode), `plots: Array` (items may carry `piece`), `suggestions: Array`, `pieces: { type: Array, default: () => [] }` (piece names, strings), `schematic: { type: Object, default: null }`. Emits `saved({ plots, schematic })` where `plots` is `[{ label, plant, piece }]` with `plant` the full plant object (not an id), and `cancel`.
- Behaviour: a "Piece" `<select>` per row, shown only when `pieces.length > 1`, options are the piece names, value is the index; a "Layout" row with `rows` (`Auto`, 1…8), `path` (Centre, Left, Right, None), `trees` (0…6). With a `gardenSlug`, save PUTs `{ data: { plots: rows.map(r => ({ label, plant: documentId|null, piece })), schematic } }` to `/api/gardens/:slug/plots` and emits `saved` with the server's `plots` and `schematic`; without one, save emits `saved({ plots, schematic })` from local state and performs no request.

- [ ] **Step 1: Failing tests**

```js
import { mount, flushPromises } from '@vue/test-utils';
import ExplorePlotEditor from '../ExplorePlotEditor.vue';
vi.mock('@/helpers', () => ({ fetchWrapper: { put: vi.fn(async () => ({ data: { plots: [], schematic: { rows: null, path: 'centre', trees: 2 } } })) } }));
vi.mock('@/stores', () => ({ useAlertStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
import { fetchWrapper } from '@/helpers';

test('controlled mode emits saved with plots and schematic and makes no request', async () => {
  const w = mount(ExplorePlotEditor, { props: { gardenSlug: null, plots: [{ label: 'A', plant: null, piece: 0 }], pieces: ['Lot 1', 'Lot 2'], schematic: { rows: 2, path: 'left', trees: 1 } } });
  await w.find('[data-test="save"]').trigger('click');
  await flushPromises();
  expect(fetchWrapper.put).not.toHaveBeenCalled();
  expect(w.emitted('saved')[0][0]).toEqual({ plots: [{ label: 'A', plant: null, piece: 0 }], schematic: { rows: 2, path: 'left', trees: 1 } });
});
test('piece select appears only with more than one piece', () => {
  expect(mount(ExplorePlotEditor, { props: { gardenSlug: null, plots: [{ label: 'A', plant: null }], pieces: ['Only'] } }).find('[data-test="piece"]').exists()).toBe(false);
  expect(mount(ExplorePlotEditor, { props: { gardenSlug: null, plots: [{ label: 'A', plant: null }], pieces: ['One', 'Two'] } }).find('[data-test="piece"]').exists()).toBe(true);
});
test('with a slug, save PUTs plots with piece and schematic', async () => {
  const w = mount(ExplorePlotEditor, { props: { gardenSlug: 'g', plots: [{ label: 'A', plant: { documentId: 'p1', title: 'P' }, piece: 1 }], pieces: ['One', 'Two'] } });
  await w.find('[data-test="save"]').trigger('click');
  await flushPromises();
  expect(fetchWrapper.put).toHaveBeenCalledWith(expect.stringMatching(/\/api\/gardens\/g\/plots$/), { data: { plots: [{ label: 'A', plant: 'p1', piece: 1 }], schematic: { rows: null, path: 'centre', trees: 2 } } });
});
```

- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement** (add `data-test="save"` to the save button and `data-test="piece"` to the piece select; `row()` gains `piece`)
- [ ] **Step 4: Update `ExploreView.vue`**: pass `:pieces="(current.footprintShape?.pieces || []).map((_, i) => pieceLetter(i, n) || 'Garden')"` and `:schematic="savedPlots[current.slug]?.schematic"`; `onPlotsSaved({ plots, schematic })`.
- [ ] **Step 5: Run, expect PASS; `yarn lint`**
- [ ] **Step 6: Commit** — `feat(explore): bed editor sets piece and layout knobs; controlled mode for the wizard`

---

### Task 7: Remove three.js

**Files:**
- Delete: `src/explore/viewer/` (all files; `archetype.js` from Task 2 stays under `src/explore/schematic/`)
- Modify: `package.json` (remove `three`), `yarn.lock` via yarn

- [ ] **Step 1: Delete and uninstall**

Run: `git rm -r src/explore/viewer && yarn remove three`

- [ ] **Step 2: Verify nothing imports the viewer**

Run: `grep -rn "explore/viewer\|from 'three'" src; yarn test; yarn build 2>&1 | tail -5`
Expected: grep finds nothing; tests pass; build succeeds.

- [ ] **Step 3: Commit** — `chore(explore): remove three.js and the island viewer`
