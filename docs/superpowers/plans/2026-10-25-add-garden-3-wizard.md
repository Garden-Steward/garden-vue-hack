# Add a Garden, Plan 3 of 3: Wizard and Footprint Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manager adds a garden from the dashboard: name, coordinates, footprint marked on public-domain aerial imagery by tapping lots and clicking the garden, beds, then "Make public" and footprint editing on the manage page.

**Architecture:** Pure modules under `src/footprint/` (coordinate parsing, Web Mercator maths, the USGS imagery layer and sampler, the cell-grid estimator, mask-to-GeoJSON tracing, the parcels client) are unit tested; one `FootprintMap.vue` component composes them over Leaflet; a `GardenNew.vue` wizard view and small additions to the dashboard, manage page and gardens store wire it up.

**Tech Stack:** Vue 3, Pinia, Leaflet 1.9 (plain `L.TileLayer.extend`, no plugins), Vitest (from Plan 2), USGS NAIP Plus ImageServer, backend routes from Plan 1.

**Spec:** `docs/superpowers/specs/2026-10-25-add-garden-design.md`, sections "The flow", "Editing after creation", "Aerial imagery", "Estimating the garden from a click", "Parcel sources", "Privacy".

## Global Constraints

- Requires Plan 1 (backend) and Plan 2 (Vitest, controlled bed editor) merged.
- Imagery: `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer`, attribution `"USGS, USDA, The National Map: Orthoimagery"`, requests with `crossOrigin: 'anonymous'`. No API keys anywhere.
- Cells are about 1.4 m on the ground and fixed in geographic terms; default tolerance 38, slider 15 to 80; allowed area is the selected lots, or 100 m around the pin when there is no parcel source.
- Saved `boundary` is a GeoJSON `MultiPolygon` in `[lng, lat]`, one polygon per connected piece, simplified at 0.5 m. `footprint_pieces[i]` matches `boundary.coordinates[i]`.
- The browser never calls a parcel service directly; it calls `GET /api/parcels`.
- Outside the US (not inside the CONUS, Alaska or Hawaii boxes) the map shows OpenStreetMap tiles, the Garden step is disabled, and the footprint comes from lots or the 100 m area.
- Route `/manage/gardens/new` is declared before `/manage/gardens/:slug`.
- Commits with the stdin heredoc form, one per task.

## Review Focus

1. Pasted coordinates with a trailing period, Unicode primes (′ ″), or lat/lng in the opposite order ("-122.24, 37.80") must parse or be rejected clearly, never silently swapped. (Task 1)
2. A click on a cell that is not allowed must not change the mask and must tell the user. (Task 4)
3. A mask with a diagonal-only touching pair of cells is two pieces, not one. (Task 4)
4. Leaving the wizard at step 2 and coming back must not lose the footprint (state lives in the view, not the map component). (Task 7)
5. Pressing "Make public" twice, or on a garden already public, must not error. (Task 8)

---

### Task 1: Coordinate parsing and US check

**Files:**
- Create: `src/footprint/coords.js`
- Create: `src/footprint/__tests__/coords.test.js`

**Interfaces:**
- Produces: `export function parseCoordinates(text) -> { latitude, longitude } | null`. Accepts decimal pairs (`"37.802306, -122.241417"`, `"37.802306 -122.241417"`), DMS with `°`, `'`/`′`, `"`/`″` and N/S/E/W letters (`37°48'08.3"N 122°14'29.1"W`), decimal with hemisphere letters (`37.8023 N, 122.2414 W`), and a Google Maps URL fragment `@37.80,-122.24,19z`. Returns `null` for anything else, for `|lat| > 90` or `|lng| > 180`, and for a decimal pair whose first number is outside ±90 while the second is inside (the swapped case).
- Produces: `export function formatDecimal({ latitude, longitude }) -> string` with 6 decimals, `", "` separator.
- Produces: `export function isInUS(latitude, longitude) -> boolean` using boxes CONUS `[24.4, -125.0, 49.4, -66.9]`, Alaska `[51.0, -180.0, 71.5, -129.9]`, Hawaii `[18.9, -160.3, 22.3, -154.8]` (`[south, west, north, east]`).

- [ ] **Step 1: Failing tests**

```js
test.each([
  ['37.802306, -122.241417', 37.802306, -122.241417],
  ['37.802306 -122.241417', 37.802306, -122.241417],
  [`37°48'08.3"N 122°14'29.1"W`, 37.802306, -122.241417],
  ['37°48′08.3″N 122°14′29.1″W', 37.802306, -122.241417],
  ['37.8023 N, 122.2414 W', 37.8023, -122.2414],
  ['https://maps/@37.80231,-122.24142,19z', 37.80231, -122.24142],
  ['37.802306, -122.241417.', 37.802306, -122.241417],
])('parses %s', (text, lat, lng) => {
  const r = parseCoordinates(text);
  expect(r.latitude).toBeCloseTo(lat, 5); expect(r.longitude).toBeCloseTo(lng, 5);
});
test.each(['hello', '', '95, 10', '-122.24, 37.80', '37.8'])('rejects %s', (t) => expect(parseCoordinates(t)).toBeNull());
test('formatDecimal', () => expect(formatDecimal({ latitude: 37.8023061, longitude: -122.2414171 })).toBe('37.802306, -122.241417'));
test('isInUS', () => { expect(isInUS(37.8, -122.24)).toBe(true); expect(isInUS(51.5, -0.1)).toBe(false); expect(isInUS(21.3, -157.8)).toBe(true); });
```

- [ ] **Step 2: Run, expect FAIL** — `yarn test src/footprint`
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** — `feat(footprint): parse decimal, DMS and map-link coordinates`

---

### Task 2: Web Mercator maths and the USGS imagery layer

**Files:**
- Create: `src/footprint/mercator.js`
- Create: `src/footprint/naip-layer.js`
- Create: `src/footprint/__tests__/mercator.test.js`
- Create: `src/footprint/__tests__/naip-layer.test.js`

**Interfaces:**
- Produces (`mercator.js`): `export const EARTH_R = 6378137`; `export function lngLatToMeters(lng, lat) -> [x, y]`; `export function metersToLngLat(x, y) -> [lng, lat]`; `export function tileToBbox3857(z, x, y) -> [minX, minY, maxX, maxY]`; `export function metersPerDegree(lat) -> { lng, lat }` (`111320·cos(lat)`, `110574`).
- Produces (`naip-layer.js`): `export const NAIP_URL = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer'`; `export const NAIP_ATTRIBUTION = 'USGS, USDA, The National Map: Orthoimagery'`; `export function exportImageUrl(bbox3857, widthPx, heightPx) -> string` (`${NAIP_URL}/exportImage?bbox=…&bboxSR=3857&imageSR=3857&size=W,H&format=jpg&f=image`); `export function createNaipLayer(L, options = {}) -> L.TileLayer` built with `L.TileLayer.extend({ getTileUrl(coords) })` and options `{ attribution: NAIP_ATTRIBUTION, crossOrigin: 'anonymous', maxZoom: 21, maxNativeZoom: 20, tileSize: 256, ...options }`. Takes `L` as a parameter so the test needs no Leaflet DOM.

- [ ] **Step 1: Failing tests**

```js
test('tile 19/84117/202597 covers the Oakland pin', () => {
  const [minX, minY, maxX, maxY] = tileToBbox3857(19, 84117, 202597);
  const [px, py] = lngLatToMeters(-122.241417, 37.802306);
  expect(px).toBeGreaterThan(minX); expect(px).toBeLessThan(maxX);
  expect(py).toBeGreaterThan(minY); expect(py).toBeLessThan(maxY);
  expect(maxX - minX).toBeCloseTo(76.437, 2);
});
test('round trip', () => { const [x, y] = lngLatToMeters(-122.24, 37.8); const [lng, lat] = metersToLngLat(x, y); expect(lng).toBeCloseTo(-122.24, 9); expect(lat).toBeCloseTo(37.8, 9); });
test('exportImageUrl', () => {
  const u = new URL(exportImageUrl([1, 2, 3, 4], 256, 256));
  expect(u.origin + u.pathname).toBe(`${NAIP_URL}/exportImage`);
  expect(u.searchParams.get('bbox')).toBe('1,2,3,4'); expect(u.searchParams.get('bboxSR')).toBe('3857'); expect(u.searchParams.get('imageSR')).toBe('3857');
  expect(u.searchParams.get('size')).toBe('256,256'); expect(u.searchParams.get('f')).toBe('image');
});
test('createNaipLayer tile URLs are exportImage requests for the tile bbox', () => {
  const fakeL = { TileLayer: { extend: (proto) => function (opts) { Object.assign(this, proto); this.options = opts; } } };
  const layer = createNaipLayer(fakeL);
  const url = new URL(layer.getTileUrl({ z: 19, x: 84117, y: 202597 }));
  expect(url.searchParams.get('bbox')).toBe(tileToBbox3857(19, 84117, 202597).join(','));
  expect(layer.options.crossOrigin).toBe('anonymous');
  expect(layer.options.attribution).toBe(NAIP_ATTRIBUTION);
});
```

- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** — `feat(footprint): Web Mercator helpers and a keyless USGS imagery tile layer`

---

### Task 3: Geographic cell grid

**Files:**
- Create: `src/footprint/geo-cells.js`
- Create: `src/footprint/__tests__/geo-cells.test.js`

**Interfaces:**
- Consumes: `metersPerDegree` (Task 2).
- Produces: `export function makeCellGrid({ center: { latitude, longitude }, cellMetres = 1.4, halfSizeMetres = 150 }) -> Grid` where `Grid = { cols, rows, cellMetres, origin: { latitude, longitude } (north-west corner), bounds: { south, west, north, east }, size: cols*rows }`; `cols = rows = ceil(2·halfSizeMetres / cellMetres)`.
- Produces: `export function cellIndexAt(grid, latitude, longitude) -> number` (−1 outside); `export function cellCorner(grid, cx, cy) -> [lng, lat]` (corner at column `cx` 0..cols, row `cy` 0..rows, row 0 north); `export function cellCentre(grid, index) -> { latitude, longitude }`.
- Produces: `export function pointInRing(lng, lat, ring) -> boolean` (ray cast, ring `[[lng, lat]…]`).
- Produces: `export function allowedFromPolygons(grid, rings) -> Uint8Array` (cell centre inside any ring); `export function allowedWithinRadius(grid, metres) -> Uint8Array` (centre within `metres` of the grid centre, equirectangular).

- [ ] **Step 1: Failing tests**

```js
const grid = makeCellGrid({ center: { latitude: 37.802306, longitude: -122.241417 } });
test('grid dimensions', () => { expect(grid.cols).toBe(215); expect(grid.rows).toBe(215); });
test('centre cell maps back near the centre', () => {
  const i = cellIndexAt(grid, 37.802306, -122.241417);
  const c = cellCentre(grid, i);
  expect(c.latitude).toBeCloseTo(37.802306, 4); expect(c.longitude).toBeCloseTo(-122.241417, 4);
});
test('outside is -1', () => expect(cellIndexAt(grid, 37.9, -122.24)).toBe(-1));
test('corners go west→east and north→south', () => {
  const [w, n] = cellCorner(grid, 0, 0); const [e, s] = cellCorner(grid, grid.cols, grid.rows);
  expect(e).toBeGreaterThan(w); expect(n).toBeGreaterThan(s);
  expect((e - w) * metersPerDegree(37.8).lng).toBeCloseTo(301, 0);
});
test('allowedWithinRadius(100) marks about pi*100^2/1.96 cells', () => {
  const n = allowedWithinRadius(grid, 100).reduce((a, b) => a + b, 0);
  expect(n).toBeGreaterThan(15500); expect(n).toBeLessThan(16500);
});
test('allowedFromPolygons marks cells inside a ring only', () => {
  const [w, n] = cellCorner(grid, 100, 100); const [e, s] = cellCorner(grid, 110, 110);
  const ring = [[w, n], [e, n], [e, s], [w, s], [w, n]];
  expect(allowedFromPolygons(grid, [ring]).reduce((a, b) => a + b, 0)).toBe(100);
});
```

- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** — `feat(footprint): geographic cell grid with allowed-area masks`

---

### Task 4: Estimator: grow, remove, close holes, components, trace, simplify, to GeoJSON

**Files:**
- Create: `src/footprint/estimate.js`
- Create: `src/footprint/__tests__/estimate.test.js`

**Interfaces:**
- Consumes: `Grid`, `cellCorner` (Task 3).
- Produces: `export function growRegion({ cols, rows, colors }, allowed, seed, tolerance) -> Set<number>`: 4-connected flood fill from `seed` over allowed cells whose RGB Euclidean distance from the region's running mean is `<= tolerance`; `colors` is a `Float32Array(cols*rows*3)`; returns an empty set when `!allowed[seed]`.
- Produces: `export function applyClick(state, seed) -> { mask, added: boolean }` where `state = { grid: { cols, rows, colors }, allowed, mask: Uint8Array, tolerance }`: if `mask[seed]` is set, the grown region is cleared (`added: false`); otherwise it is set and `closeHoles` is applied (`added: true`); returns a new mask, never mutating the input.
- Produces: `export function closeHoles(mask, allowed, cols, rows) -> Uint8Array` (unmarked allowed cell with ≥3 marked 4-neighbours becomes marked; one pass).
- Produces: `export function components(mask, cols, rows) -> number[][]` (4-connected, each an array of indices, in first-cell order).
- Produces: `export function traceOuterRing(cells: Set<number>, cols, rows) -> Array<[cx, cy]>` outer boundary in cell-corner coordinates, counter-clockwise when y points down is ignored (any consistent winding), closing point not repeated.
- Produces: `export function simplifyRing(ring, tolerance) -> ring` (Douglas–Peucker; closed ring handled by splitting at the farthest pair; result keeps ≥ 3 points).
- Produces: `export function maskToBoundary(mask, grid, simplifyMetres = 0.5) -> { type: 'MultiPolygon', coordinates } | null` (`null` when the mask is empty): per component, trace, simplify with tolerance `simplifyMetres / grid.cellMetres` in cell units, map corners with `cellCorner`, close the ring.
- Produces: `export function maskArea(mask, grid) -> number` m² (`count · cellMetres²`); `export const DEFAULT_TOLERANCE = 38`.

- [ ] **Step 1: Failing tests**

Build a 6×6 `colors` array by hand: a 3×3 block of `[100,120,80]` at the top-left, `[200,200,200]` elsewhere, with `allowed` all ones.

```js
test('growRegion fills the similar block and stops at the colour edge', () => {
  const r = growRegion(G, allowed, 0, 38);
  expect(r.size).toBe(9);
});
test('growRegion from a disallowed seed is empty', () => { const a = allowed.slice(); a[0] = 0; expect(growRegion(G, a, 0, 38).size).toBe(0); });
test('growRegion respects allowed', () => { const a = allowed.slice(); a[1] = 0; a[6] = 0; expect(growRegion(G, a, 0, 38).size).toBe(1); });
test('applyClick adds then removes, without mutating', () => {
  const s = { grid: G, allowed, mask: new Uint8Array(36), tolerance: 38 };
  const one = applyClick(s, 0); expect(one.added).toBe(true); expect(one.mask.reduce((a, b) => a + b)).toBe(9); expect(s.mask.reduce((a, b) => a + b)).toBe(0);
  const two = applyClick({ ...s, mask: one.mask }, 7); expect(two.added).toBe(false); expect(two.mask.reduce((a, b) => a + b)).toBe(0);
});
test('closeHoles fills a one-cell hole', () => {
  const m = new Uint8Array(36); for (const i of [0, 1, 2, 6, 8, 12, 13, 14]) m[i] = 1; // 3x3 ring, centre 7 unset
  expect(closeHoles(m, allowed, 6, 6)[7]).toBe(1);
});
test('components: diagonal neighbours are separate', () => {
  const m = new Uint8Array(36); m[0] = 1; m[7] = 1;
  expect(components(m, 6, 6)).toHaveLength(2);
});
test('traceOuterRing of a 2x2 block has 4 corners', () => {
  const ring = traceOuterRing(new Set([0, 1, 6, 7]), 6, 6);
  expect(ring).toHaveLength(4);
  expect(ring).toEqual(expect.arrayContaining([[0, 0], [2, 0], [2, 2], [0, 2]]));
});
test('traceOuterRing of an L shape has 6 corners', () => {
  expect(traceOuterRing(new Set([0, 1, 6]), 6, 6)).toHaveLength(6);
});
test('simplifyRing drops collinear points and keeps corners', () => {
  const stair = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
  expect(simplifyRing(stair, 0.1)).toHaveLength(4);
});
test('maskToBoundary makes a closed MultiPolygon in [lng, lat] with one polygon per component', () => {
  const grid = makeCellGrid({ center: { latitude: 37.802306, longitude: -122.241417 }, halfSizeMetres: 7 }); // 10x10
  const m = new Uint8Array(grid.size); for (const i of [0, 1, 10, 11, 55]) m[i] = 1;
  const b = maskToBoundary(m, grid);
  expect(b.type).toBe('MultiPolygon'); expect(b.coordinates).toHaveLength(2);
  const ring = b.coordinates[0][0];
  expect(ring[0]).toEqual(ring[ring.length - 1]);
  expect(ring).toHaveLength(5);
  expect(ring[0][0]).toBeLessThan(0); expect(ring[0][1]).toBeGreaterThan(37);
  expect(maskToBoundary(new Uint8Array(grid.size), grid)).toBeNull();
});
test('maskArea', () => { const grid = { cellMetres: 1.4 }; const m = new Uint8Array([1, 1, 0]); expect(maskArea(m, grid)).toBeCloseTo(3.92, 2); });
```

- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement** (the tracing: collect every cell edge whose neighbour across it is outside the set, then chain edges into a loop; this is the one algorithm the tests do not pin, so write it as edge-chaining, not marching squares)
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** — `feat(footprint): click-to-estimate region growing and mask-to-GeoJSON tracing`

---

### Task 5: Imagery sampler and parcels client

**Files:**
- Create: `src/footprint/sampler.js`
- Create: `src/footprint/parcels-client.js`
- Create: `src/footprint/__tests__/sampler.test.js`
- Create: `src/footprint/__tests__/parcels-client.test.js`

**Interfaces:**
- Consumes: `exportImageUrl`, `lngLatToMeters` (Task 2), `Grid` (Task 3).
- Produces (`sampler.js`): `export const CELL_PX = 4`; `export function gridImageUrl(grid) -> string` (bbox = grid bounds in 3857, size `cols·CELL_PX × rows·CELL_PX`); `export function meanCellColors(imageData, cols, rows, cellPx = CELL_PX) -> Float32Array(cols·rows·3)`; `export async function loadGridColors(grid, loadImage = defaultLoadImage) -> Float32Array` where `defaultLoadImage(url) -> Promise<HTMLImageElement>` sets `crossOrigin = 'anonymous'`, draws into an offscreen canvas and reads `ImageData`; rejects with `Error('imagery unavailable')` when the image fails to load or the canvas is tainted.
- Produces (`parcels-client.js`): `export async function fetchParcelsNear(latitude, longitude, radius = 100) -> { source, attribution, parcels: [{ apn, address, area_m2, polygon }], error? }` via `fetchWrapper.get(`${VITE_API_URL}/api/parcels?lat=…&lng=…&radius=…`)`, returning `{ source: null, attribution: null, parcels: [], error: 'parcel lookup failed' }` on a thrown request.

- [ ] **Step 1: Failing tests**

```js
test('gridImageUrl size matches the grid', () => {
  const grid = makeCellGrid({ center: { latitude: 37.802306, longitude: -122.241417 }, halfSizeMetres: 7 });
  const u = new URL(gridImageUrl(grid));
  expect(u.searchParams.get('size')).toBe('40,40');
});
test('meanCellColors averages each block', () => {
  const data = new Uint8ClampedArray(8 * 8 * 4); // 2x2 cells of 4px
  for (let i = 0; i < 64; i++) { const x = i % 8, y = (i - x) / 8; const v = x < 4 ? 10 : 250; data.set([v, v, v, 255], i * 4); }
  const c = meanCellColors({ data, width: 8, height: 8 }, 2, 2);
  expect(c[0]).toBeCloseTo(10); expect(c[3]).toBeCloseTo(250); expect(c[6]).toBeCloseTo(10);
});
test('loadGridColors rejects clearly when the image fails', async () => {
  await expect(loadGridColors(grid, async () => { throw new Error('x'); })).rejects.toThrow('imagery unavailable');
});
vi.mock('@/helpers', () => ({ fetchWrapper: { get: vi.fn() } }));
test('fetchParcelsNear calls the backend and passes the result through', async () => {
  fetchWrapper.get.mockResolvedValueOnce({ data: { source: 'oakland', attribution: 'City of Oakland', parcels: [] } });
  expect(await fetchParcelsNear(37.8, -122.24)).toEqual({ source: 'oakland', attribution: 'City of Oakland', parcels: [] });
  expect(fetchWrapper.get).toHaveBeenCalledWith(expect.stringMatching(/\/api\/parcels\?lat=37\.8&lng=-122\.24&radius=100$/));
});
test('fetchParcelsNear swallows request errors into an empty result', async () => {
  fetchWrapper.get.mockRejectedValueOnce(new Error('boom'));
  expect((await fetchParcelsNear(37.8, -122.24)).error).toBe('parcel lookup failed');
});
```

- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** — `feat(footprint): imagery colour sampler and parcels client`

---

### Task 6: `FootprintMap.vue`

**Files:**
- Create: `src/components/FootprintMap.vue`
- Create: `src/components/__tests__/FootprintMap.test.js`

**Interfaces:**
- Consumes: everything in `src/footprint/` (Tasks 1-5), Leaflet, `LocationPicker.vue` as the pattern for map lifecycle (`onMounted` create, `ResizeObserver` → `invalidateSize`, `onBeforeUnmount` → `map.remove()`).
- Produces: props `modelValue: { latitude, longitude, boundary, footprint_pieces, mask?: Uint8Array, gridCenter?: { latitude, longitude } }`, `allowPinMove: Boolean (default true)`; emits `update:modelValue` with the same shape plus `cellCount` and `areaM2`, and `status(text)` for the hint line.
- Internal composition (the builder's layout, these names are fixed for the test): a root with `data-test="footprint-map"`; segment buttons `data-test="mode-lots"` / `data-test="mode-garden"`; controls `data-test="tolerance"` (range), `data-test="undo"`, `data-test="whole-lots"`; a lots list `data-test="lot"` rows; hint `data-test="hint"`; area `data-test="area"`.
- Behaviour: on mount, build `grid = makeCellGrid({ center })`; NAIP layer when `isInUS`, else OSM with the Garden segment disabled and hint "Aerial imagery isn't available outside the US"; fetch parcels via `fetchParcelsNear`; draw each as `L.polygon` (white, weight 1.2) toggling selection on click (green fill `rgba(47,111,78,.3)`); `allowed = allowedFromPolygons(grid, selectedRings)` or `allowedWithinRadius(grid, 100)` when `source === null` (then the Lots segment is hidden and hint "Lot lines aren't available for this area"); `loadGridColors(grid)` lazily on first Garden-mode entry (hint "Reading the imagery…" then "Click on the garden"); map click in Garden mode → `cellIndexAt` → if not allowed, hint "That spot is outside the lots you picked" and no change, else `applyClick`; the mask is drawn as an `L.imageOverlay` from an offscreen canvas (`cols×rows` px, green `rgba(72,150,100,.62)`) over `grid.bounds`, regenerated on each change; history stack for undo; "Whole lots" sets `mask = allowed`; every change emits `update:modelValue` with `boundary = maskToBoundary(mask, grid)` and `footprint_pieces` built per component: `name` = address of the selected lot containing the component's first cell centre, else `"Piece N"`; `source: 'parcels' | 'box'`; `lots` = `{ apn, address, area_m2 }` of selected lots overlapping the component.
- Keyboard: each lot row in the list (`data-test="lot"`) is a `<button>` that toggles the lot, so lots are reachable without the map; the map polygons mirror the same state.
- When `modelValue.boundary` is given without a mask (editing an existing garden), initial `mask = allowedFromPolygons(grid, boundary.coordinates.map(p => p[0]))`, so the saved footprint is the starting marking.

- [ ] **Step 1: Failing test (mount-level only; map internals are not unit tested)**

Mock `leaflet` with a minimal stub (`map()` returning `{ setView, on, remove, invalidateSize, addLayer, removeLayer, latLngToContainerPoint }`, `tileLayer`, `polygon`, `imageOverlay`, `marker`, `divIcon`, `TileLayer.extend`), mock `@/footprint/parcels-client` to return one Oakland parcel, mock `@/footprint/sampler` `loadGridColors` to resolve a flat colour array.

```js
test('renders both segments for a US pin with a parcel source and lists the lot', async () => {
  const w = mount(FootprintMap, { props: { modelValue: { latitude: 37.802306, longitude: -122.241417, boundary: null, footprint_pieces: [] } } });
  await flushPromises();
  expect(w.find('[data-test="mode-lots"]').exists()).toBe(true);
  expect(w.findAll('[data-test="lot"]')).toHaveLength(1);
});
test('outside the US the garden segment is disabled', async () => {
  const w = mount(FootprintMap, { props: { modelValue: { latitude: 51.5, longitude: -0.1, boundary: null, footprint_pieces: [] } } });
  await flushPromises();
  expect(w.find('[data-test="mode-garden"]').attributes('disabled')).toBeDefined();
});
test('whole lots emits a MultiPolygon boundary and one piece named after the lot', async () => {
  const w = mount(FootprintMap, { props: { modelValue: { latitude: 37.802306, longitude: -122.241417, boundary: null, footprint_pieces: [] } } });
  await flushPromises();
  await w.find('[data-test="lot"]').trigger('click');
  await w.find('[data-test="whole-lots"]').trigger('click');
  const v = w.emitted('update:modelValue').at(-1)[0];
  expect(v.boundary.type).toBe('MultiPolygon');
  expect(v.footprint_pieces[0]).toMatchObject({ source: 'parcels', name: '2707 PARK BLVD' });
  expect(v.footprint_pieces[0].lots[0]).toEqual({ apn: expect.any(String), address: '2707 PARK BLVD', area_m2: expect.any(Number) });
});
```

- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement the component**
- [ ] **Step 4: Run, expect PASS; manual check** in `yarn dev` on a scratch route or the wizard once Task 7 exists: imagery loads, lots draw, a click grows a region, zoom works, undo works.
- [ ] **Step 5: Commit** — `feat(footprint): FootprintMap component (lots, click-to-estimate, aerial imagery)`

---

### Task 7: Gardens store actions, route, wizard view, dashboard entry

**Files:**
- Modify: `src/stores/gardens.store.js` (add `create`, `publish`)
- Create: `src/stores/__tests__/gardens.store.test.js`
- Create: `src/views/GardenNew.vue`
- Modify: `src/views/index.js` (export `GardenNew`)
- Modify: `src/helpers/router.js` (insert before line 203: `{ path: '/manage/gardens/new', component: GardenNew, name: 'manage-garden-new', meta: { requiresAuth: true } }`)
- Modify: `src/views/GardensView.vue` (276-279 header action, 332-335 grid card)
- Create: `src/views/__tests__/GardensView.add-garden.test.js`

**Interfaces:**
- Consumes: `FootprintMap.vue` (Task 6), `ExplorePlotEditor.vue` controlled mode (Plan 2 Task 6), `Schematic.vue` (Plan 2 Task 4), `parseCoordinates`/`formatDecimal` (Task 1), backend `POST /api/gardens/create` and `POST /api/gardens/:slug/publish` (Plan 1).
- Produces (store): `async create(payload) -> { documentId, slug, sms_slug, title }` posting `{ data: payload }` to `${baseUrl}/create` and then calling `this.getAll()`; `async publish(slug) -> data` posting `{}` to `${baseUrl}/${slug}/publish` and then `this.getSlug(slug)`.
- Produces (view `GardenNew.vue`): state `step` (1|2|3), `title`, `coordsText`, `coords` (parsed or null), `footprint` (the `FootprintMap` model), `beds` (`[{ label, plant, piece }]`), `schematic`, `created` (store result). Step 1 → 2 requires `title.trim()`, `coords`, and `footprint.cellCount > 0`; step 2 uses `<ExplorePlotEditor :garden-slug="null" :plots="beds" :pieces="footprint.footprint_pieces.map(p => p.name)" :schematic="schematic" @saved="onBedsSaved" @cancel="step = 1">` and a "Create garden" button that calls `gardensStore.create({ title, latitude, longitude, boundary, footprint_pieces, plots: beds.map(b => ({ label: b.label, plant: b.plant?.documentId ?? null, piece: b.piece ?? 0 })), schematic })`; step 3 shows the title, `<Schematic>` preview from `footprint` pieces (compute `pieces` for the preview with a small local helper that converts `boundary` rings to centroid-relative metres using `metersPerDegree`), the SMS slug, a "Not public yet" notice, and links "Finish setting up" (`/manage/gardens/${created.slug}`), "Add another garden" (resets state), "Back to dashboard" (`/manage`). Steps are tabs that can be revisited without losing state. Coordinates box shows `formatDecimal(coords)` under it or "Couldn't read those coordinates" when text is non-empty and unparsed.
- Produces (dashboard): when `managedGardens.length > 0`, the two `EmailLink`s at 278 and 332-335 become `<router-link to="/manage/gardens/new" …>Add a garden</router-link>` with the same classes (`dash-btn dash-btn--ghost` and `garden-card garden-card--apply`); otherwise unchanged.

- [ ] **Step 1: Failing store test**

```js
vi.mock('@/helpers', () => ({ fetchWrapper: { get: vi.fn(async () => ({ data: [] })), post: vi.fn(async () => ({ data: { documentId: 'd', slug: 's', sms_slug: 'sg', title: 'T' } })) }, stripReadOnly: (x) => x }));
test('create posts to /create and refreshes the list', async () => {
  setActivePinia(createPinia());
  const store = useGardensStore();
  const out = await store.create({ title: 'T' });
  expect(fetchWrapper.post).toHaveBeenCalledWith(expect.stringMatching(/\/api\/gardens\/create$/), { data: { title: 'T' } });
  expect(out.slug).toBe('s');
  expect(fetchWrapper.get).toHaveBeenCalled();
});
test('publish posts to /:slug/publish', async () => {
  setActivePinia(createPinia());
  await useGardensStore().publish('s');
  expect(fetchWrapper.post).toHaveBeenCalledWith(expect.stringMatching(/\/api\/gardens\/s\/publish$/), {});
});
```

- [ ] **Step 2: Failing dashboard test**

Mount `GardensView` with a Pinia whose gardens store state has one garden managed by the stubbed user (stub `useAuthStore` user `{ id: 1 }`, and the event/task/project stores' actions as no-ops; use `global.stubs` for `router-link` and `EmailLink`).

```js
test('a manager sees "Add a garden" linking to /manage/gardens/new; a non-manager sees the email link', async () => { /* two mounts, assert on text and the router-link `to` */ });
```

- [ ] **Step 3: Run, expect FAIL**
- [ ] **Step 4: Implement store actions, route, `GardenNew.vue`, dashboard change**
- [ ] **Step 5: Run, expect PASS; `yarn lint`**
- [ ] **Step 6: Manual walk-through** in `yarn dev` against a backend with Plan 1: dashboard → Add a garden → name, paste `37°48'08.3"N 122°14'29.1"W`, tap a lot, Garden mode, click the lot, Next → add two beds → Create → step 3 shows the preview and the SMS slug → "Finish setting up" opens the manage page.
  Expected: the new garden appears on `/manage` with the Draft badge, and `/gardens/<slug>` signed out is "Garden not found".
- [ ] **Step 7: Commit** — `feat(manage): Add a garden wizard for existing managers`

---

### Task 8: Manage page: draft banner, Make public, Footprint section, SMS slug

**Files:**
- Modify: `src/views/GardenDetail.vue` (banner after line 573; `validSections` 70-78 add `'footprint'`; new section block near line 947)
- Modify: `src/components/GardenSidebar.vue` (43-50: add `{ id: 'footprint', label: 'Footprint' }` after `general`)
- Modify: `src/components/GardenGeneral.vue` (add an SMS slug field saving `sms_slug` through `gardensStore.update`, same pattern as `blurb` at 291)
- Create: `src/components/GardenFootprintEditor.vue`
- Create: `src/components/__tests__/GardenFootprintEditor.test.js`

**Interfaces:**
- Consumes: `FootprintMap.vue` (Task 6), `gardensStore.update(id, data)` (existing; goes through the backend `update` override so drafts stay drafts), `gardensStore.publish(slug)` (Task 7), `garden.boundary` and `garden.footprint_pieces` from `/full` for managers (Plan 1 Task 3).
- Produces (`GardenFootprintEditor.vue`): props `garden` (required), `editor` (Boolean); renders `<FootprintMap v-model="model" />` seeded from `garden.latitude/longitude/boundary/footprint_pieces`, a "Save footprint" button (`data-test="save-footprint"`) calling `gardensStore.update(garden.id, { latitude, longitude, boundary, footprint_pieces })` then `gardensStore.getSlug(route.params.slug)`, with success/error through `useAlertStore`; read-only text when `!editor`.
- Produces (banner): `<div v-if="garden.id && !garden.publishedAt && isEditor" class="gm-draft-banner" data-test="draft-banner">This garden isn't public yet. Volunteers can't find it. <button data-test="make-public" @click="makePublic">Make public</button></div>`; `makePublic` calls `gardensStore.publish(garden.slug)`, disables the button while pending, alerts on failure; the banner disappears when `publishedAt` is set.

- [ ] **Step 1: Failing tests**

```js
test('GardenFootprintEditor saves latitude, longitude, boundary and footprint_pieces', async () => {
  // mock FootprintMap as a stub that emits update:modelValue once with a fixture, mock the gardens store
  await w.find('[data-test="save-footprint"]').trigger('click'); await flushPromises();
  expect(update).toHaveBeenCalledWith(7, { latitude: 37.8, longitude: -122.24, boundary: FIXTURE_BOUNDARY, footprint_pieces: FIXTURE_PIECES });
});
test('draft banner shows for a draft and calls publish; hidden once published', async () => {
  // mount GardenDetail with store state garden { id: 7, slug: 'g', publishedAt: null, managers: [{ id: 1 }] }
  await w.find('[data-test="make-public"]').trigger('click');
  expect(publish).toHaveBeenCalledWith('g');
  await w.setProps({}); store.garden.publishedAt = '2026-10-25T00:00:00Z'; await nextTick();
  expect(w.find('[data-test="draft-banner"]').exists()).toBe(false);
});
```

- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect PASS; `yarn lint`**
- [ ] **Step 5: Manual check**: on the draft from Task 7, Footprint section loads with the saved marking, Save footprint works, Make public flips the banner off and `/gardens/<slug>` signed out now loads with the schematic on `/explore/<slug>`; pressing Make public again on the published garden (via devtools re-enabling) returns 200.
- [ ] **Step 6: Commit** — `feat(manage): draft banner with Make public, Footprint editor section, SMS slug field`

---

### Task 9: Whole-flow verification and plan wrap-up

- [ ] **Step 1: Full test runs** — frontend `yarn test && yarn lint && yarn build`; backend `npm test`. Expected: all pass.
- [ ] **Step 2: Privacy spot check** — signed out, fetch `/api/gardens` and `/api/gardens/<slug>/full` for the new garden: no `boundary`, no `footprint_pieces`, `footprint_shape` present, no lot addresses anywhere in the JSON (`grep -i "park blvd"` on the responses finds nothing).
- [ ] **Step 3: Record** the five Review Focus outcomes across the three plans in the final report.
