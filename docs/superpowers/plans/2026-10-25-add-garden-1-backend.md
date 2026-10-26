# Add a Garden, Plan 1 of 3: Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Strapi backend keeps draft gardens hidden and draft, accepts a multi-piece footprint, serves a privacy-safe footprint shape, and gains manager-only routes to create a garden, publish it, and look up nearby parcels.

**Architecture:** All work is in the sibling repo `../steward-bank-hack` (Strapi 5.36, Jest + supertest + sqlite). Garden visibility is centralised in one helper the garden controller uses for every slug read; the `update` override pins a draft to stay draft; new footprint geometry lives in `config/helpers/geo.js` next to the existing boundary code; parcels are a new tiny `api::parcel` with a config-file registry.

**Tech Stack:** Node 22, Strapi 5.36 (Document Service, users-permissions), Jest 29, supertest 7, better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-10-25-add-garden-design.md` (in this repo, `garden-vue-hack`). Sections "Data", "Drafts", "Parcel sources", "Privacy", "Sequencing".

## Global Constraints

- Backend repo root for every path below: `/Users/harrisonnguyen/Desktop/gardens/steward-bank-hack`. Run tests there with `npm test` (Jest, `--runInBand`); Strapi integration tests are modules required in order by `tests/app.test.js`, pure unit tests are standalone `*.test.js`.
- Parcel responses carry only `apn`, `address`, `area_m2`, `polygon`. Never owner or mailing fields.
- A draft garden is visible only to its managers and administrators. Signed-out and non-manager reads of a draft-only garden return 404 on slug routes and omit it from lists.
- `boundary` is a GeoJSON `Polygon` or `MultiPolygon`, `[lng, lat]` order. Existing `Polygon` data keeps working.
- Public responses never include `boundary` or `footprint_pieces`; they include `footprint_shape` (centroid-relative metres, north up, 0.5 m rounding, published rows only).
- New routes are gated in their controllers to managers (of this garden for publish; of any garden for create and parcels) or administrators, and granted role-wide through `MEMBER_ACTIONS` in `src/index.js`.
- Error messages never echo submitted text (existing convention in `services/plots.js`).
- Commits in the backend repo use the stdin heredoc form (`git commit -F - <<'EOF'`), one commit per task.

## Review Focus

Spec-implied cases no task's tests cover directly; each gets a test in the owning task:

1. A manager of garden A reading garden B's draft by slug must get 404, not B's data. (Task 2)
2. `boundary` with a `MultiPolygon` whose one piece is unclosed must be rejected with the piece index in the message, not accepted or crash. (Task 3)
3. The create route with a title that slugifies to an existing slug must produce `slug-2`, and with a title whose SMS slug collides with a draft-only garden must still de-duplicate. (Task 5)
4. Publishing a garden that already has a published row (second press of "Make public") must succeed and not duplicate interests or reset the welcome email. (Task 6)
5. A parcel source that times out or returns malformed JSON must yield `{ source, parcels: [] }` with a 502-class error field, not a 500 crash. (Task 7)

---

### Task 1: Baseline commit of the uncommitted island/plots work

**Files:**
- Commit as-is (no edits): `src/components/garden/plot.json`, `src/api/garden/services/plots.js`, `src/api/garden/content-types/garden/schema.json`, `src/api/garden/routes/01-custom-garden.js`, `src/api/garden/controllers/garden.js`, `tests/garden/plots.js`, `tests/app.test.js`, `src/index.js`, and anything else `git status` lists as part of the plots work.

**Interfaces:**
- Produces: a clean working tree so every later task is a reviewable diff.

- [ ] **Step 1: Confirm the current suite passes on the uncommitted tree**

Run: `cd /Users/harrisonnguyen/Desktop/gardens/steward-bank-hack && npm test 2>&1 | tail -20`
Expected: all suites pass (note the count for later comparison).

- [ ] **Step 2: Commit the uncommitted state**

```bash
cd /Users/harrisonnguyen/Desktop/gardens/steward-bank-hack
git add -A
git commit -F - <<'EOF'
chore: baseline for add-garden work (explore plots component, service, routes)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: One visibility rule for garden slug reads, and drafts stay drafts

**Files:**
- Create: `src/api/garden/utils/visibility.js`
- Modify: `src/api/garden/controllers/garden.js` (`fullSlug` 335-372, `getPlots` 229-240, `getStandingTasks` 177-189, `getDaySheet` 127-144, `getDaySheetHtml` 149-174, `find` 393-434; add `update`)
- Create: `tests/garden/visibility.js`
- Modify: `tests/app.test.js` (require `./garden/visibility` after `./garden/plots` at line 60)

**Interfaces:**
- Produces: `async function visibleGardenRows(strapi, ctx, slug) -> { rows, published, draft, isManager, isAdmin } | null` in `visibility.js`. `rows` are all db rows for the slug (`select ['id','documentId','publishedAt','slug','title']`, `populate managers {select ['id']}`); returns `null` when there are no rows, or when there is no published row and the caller is neither a manager on any row nor an administrator. `isAdmin` is `ctx.state.user?.role?.type === 'administrator'`.
- Produces: `function publicRowFilter(user) -> where` returning `{ publishedAt: { $notNull: true } }` for no user or non-admin without manager match; used by `find`.
- Produces: `async update(ctx)` override on the garden controller: resolves `ctx.params.id` to a documentId (accepting a documentId or a numeric row id), and when that document has no published row sets `ctx.query.status = 'draft'` before `super.update(ctx)`.

- [ ] **Step 1: Write the failing tests**

In `tests/garden/visibility.js`, following the setup style of `tests/garden/plots.js` (create users with `tests/user/factory.js`, JWT via `strapi.plugins['users-permissions'].services.jwt.issue({ id })`, gardens via `strapi.documents('api::garden.garden').create(...)`). Fixtures: `draftOnly` (status `'draft'`, managers `[mgr]`), `published` (status `'published'`, managers `[mgr]`), users `mgr`, `otherMgr` (manager of a third garden), `volunteer`, `admin` (role type `administrator`, see `tests/billing/usage-page-http.js:40-46`).

```js
describe('draft garden visibility', () => {
  it('signed-out: /full on a draft-only garden is 404', async () => {
    const res = await get(`/api/gardens/${draftOnly.slug}/full`);
    expect(res.status).toBe(404);
  });
  it('signed-out: /full on a published garden is 200 with no boundary', async () => {
    const res = await get(`/api/gardens/${published.slug}/full`);
    expect(res.status).toBe(200);
    expect(res.body.data.boundary).toBeUndefined();
  });
  it('a manager of a different garden gets 404 on the draft', async () => {
    const res = await get(`/api/gardens/${draftOnly.slug}/full`, otherMgrJwt);
    expect(res.status).toBe(404);
  });
  it('a volunteer gets 404 on the draft', async () => {
    expect((await get(`/api/gardens/${draftOnly.slug}/full`, volunteerJwt)).status).toBe(404);
  });
  it('its manager and an admin get 200 on the draft', async () => {
    expect((await get(`/api/gardens/${draftOnly.slug}/full`, mgrJwt)).status).toBe(200);
    expect((await get(`/api/gardens/${draftOnly.slug}/full`, adminJwt)).status).toBe(200);
  });
  it('/plots, /standing-tasks and /day-sheet follow the same rule', async () => {
    for (const p of ['plots', 'standing-tasks', 'day-sheet']) {
      expect((await get(`/api/gardens/${draftOnly.slug}/${p}`)).status).toBe(404);
      expect((await get(`/api/gardens/${draftOnly.slug}/${p}`, mgrJwt)).status).toBe(200);
    }
  });
  it('the list hides drafts from non-managers and shows them to managers once', async () => {
    const asVolunteer = await get('/api/gardens', volunteerJwt);
    expect(asVolunteer.body.data.map(g => g.slug)).not.toContain(draftOnly.slug);
    const asMgr = await get('/api/gardens', mgrJwt);
    const mine = asMgr.body.data.filter(g => g.slug === draftOnly.slug);
    expect(mine).toHaveLength(1);
    expect(mine[0].publishedAt).toBeNull();
    expect(asMgr.body.data.filter(g => g.slug === published.slug)).toHaveLength(1);
  });
  it('signed-out list has no drafts', async () => {
    const res = await get('/api/gardens');
    expect(res.body.data.map(g => g.slug)).not.toContain(draftOnly.slug);
  });
});

describe('a draft stays a draft through the stock update', () => {
  it('PUT /api/gardens/:documentId on a draft-only garden leaves publishedAt null', async () => {
    const res = await put(`/api/gardens/${draftOnly.documentId}`, mgrJwt, { data: { blurb: 'hello' } });
    expect(res.status).toBe(200);
    const rows = await strapi.db.query('api::garden.garden').findMany({ where: { documentId: draftOnly.documentId } });
    expect(rows.every(r => r.publishedAt === null)).toBe(true);
    expect(rows[0].blurb).toBe('hello');
  });
  it('PUT on a published garden still updates the published row', async () => {
    const res = await put(`/api/gardens/${published.documentId}`, mgrJwt, { data: { blurb: 'pub' } });
    expect(res.status).toBe(200);
    const row = await strapi.db.query('api::garden.garden').findOne({ where: { documentId: published.documentId, publishedAt: { $notNull: true } } });
    expect(row.blurb).toBe('pub');
  });
});
```

The `put` helper needs the `api::garden.garden.update` permission on the authenticated role for the test run; grant it the way `tests/garden/plots.js:26-30` grants `replacePlots`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/app.test.js -t "draft garden visibility" 2>&1 | tail -30`
Expected: FAIL (draft `/full` returns 200 for signed-out; list contains the draft).

- [ ] **Step 3: Implement `visibleGardenRows` and `publicRowFilter` in `src/api/garden/utils/visibility.js`**

Validate the slug with the same `SLUG_PATTERN` as the controller (move the constant here and import it back). Manager match counts a link on any row (same rule as `loadMembership`).

- [ ] **Step 4: Use it in the controller**

In `fullSlug`, `getPlots`, `getStandingTasks`, `getDaySheet`, `getDaySheetHtml`: call `visibleGardenRows`; `null` → `ctx.notFound('Garden not found')`; otherwise continue with `published || draft` as the row to read for signed-out callers and `draft || published` for managers (plots and standing tasks already read the draft row in their services; keep that).

In `find` (authenticated non-admin branch, 393-434): where becomes `{ $and: [existingWhere, { $or: [{ publishedAt: { $notNull: true } }, { managers: ctx.state.user.id }] }] }`, then de-duplicate by `documentId` preferring the published row (`dedupeByDocument` in `src/utils/documents.js` if its semantics match, else a local reduce).

Add `async update(ctx)` per the Interfaces block. Resolve numeric ids with `db.query.findOne({ where: { id: Number(id) }, select: ['documentId'] })`.

- [ ] **Step 5: Run the new tests and the whole suite**

Run: `npm test 2>&1 | tail -20`
Expected: PASS, same suite count as Task 1 plus the new describe blocks.

- [ ] **Step 6: Commit**

```bash
git add src/api/garden tests/garden/visibility.js tests/app.test.js
git commit -F - <<'EOF'
feat(garden): drafts visible only to managers/admins; stock update keeps drafts draft

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 3: Multi-piece boundary and the public footprint shape

**Files:**
- Modify: `config/helpers/geo.js` (`validateBoundary` 33-75, `pointInPolygon` 83-110; add `polygonAreaM2`, `footprintShape`)
- Modify: `src/api/garden/content-types/garden/schema.json` (`boundary` description; add `footprint_pieces`, `schematic`)
- Modify: `src/api/garden/controllers/garden.js` (`toPublicGarden` 60-80; `fullSlug` and `find` non-manager branches)
- Modify: `tests/geo/geo.test.js`
- Modify: `tests/garden/visibility.js` (add footprint cases)

**Interfaces:**
- Produces: `Geo.validateBoundary(boundary) -> { valid, error? }` accepting `Polygon` or `MultiPolygon`; MultiPolygon errors are prefixed `piece N: `.
- Produces: `Geo.pointInPolygon(lat, lng, geo) -> boolean` true if inside any piece.
- Produces: `Geo.polygonAreaM2(ring) -> number` (ring in `[lng, lat]`, equirectangular at the ring's mean latitude).
- Produces: `Geo.footprintShape(boundary) -> { pieces: [{ ring: [[x, y], ...], area_m2 }] } | null`: x east, y north, metres from the centroid of all outer rings' vertices, rounded to 0.5, closing point dropped; `null` for null/invalid input.
- Produces: `function stripFootprint(garden)` (deletes `boundary`, `footprint_pieces`) and `function withFootprintShape(garden)` (sets `footprint_shape = Geo.footprintShape(garden.boundary)`) as module-level helpers in the garden controller.
- Schema: `footprint_pieces` json (`[{ name, source: 'parcels'|'box', lots: [{ apn, address, area_m2 }] }]`), `schematic` json (`{ rows: number|null, path: 'centre'|'left'|'right'|'none', trees: number }`).

- [ ] **Step 1: Write the failing unit tests in `tests/geo/geo.test.js`**

```js
const SQUARE = [[-122.001, 37.000], [-122.000, 37.000], [-122.000, 37.001], [-122.001, 37.001], [-122.001, 37.000]];
const FAR = SQUARE.map(([x, y]) => [x + 0.01, y]);
const MULTI = { type: 'MultiPolygon', coordinates: [[SQUARE], [FAR]] };

test('validateBoundary accepts a MultiPolygon', () => expect(Geo.validateBoundary(MULTI).valid).toBe(true));
test('validateBoundary names the bad piece', () => {
  const bad = { type: 'MultiPolygon', coordinates: [[SQUARE], [SQUARE.slice(0, 4)]] };
  expect(Geo.validateBoundary(bad)).toEqual({ valid: false, error: expect.stringMatching(/^piece 1: /) });
});
test('pointInPolygon checks every piece', () => {
  expect(Geo.pointInPolygon(37.0005, -122.0005, MULTI)).toBe(true);
  expect(Geo.pointInPolygon(37.0005, -121.9905, MULTI)).toBe(true);
  expect(Geo.pointInPolygon(37.0005, -121.995, MULTI)).toBe(false);
});
test('polygonAreaM2 of a ~111 m x 89 m square', () => {
  expect(Geo.polygonAreaM2(SQUARE)).toBeGreaterThan(9500);
  expect(Geo.polygonAreaM2(SQUARE)).toBeLessThan(10300);
});
test('footprintShape is centroid-relative metres, north up, 0.5 m rounded, no closing point', () => {
  const shape = Geo.footprintShape({ type: 'Polygon', coordinates: [SQUARE] });
  expect(shape.pieces).toHaveLength(1);
  expect(shape.pieces[0].ring).toHaveLength(4);
  const xs = shape.pieces[0].ring.map(p => p[0]);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(88.5, 0);
  expect(shape.pieces[0].ring.every(([x, y]) => x % 0.5 === 0 && y % 0.5 === 0)).toBe(true);
  expect(shape.pieces[0].area_m2).toBeCloseTo(Geo.polygonAreaM2(SQUARE), -1);
});
test('footprintShape of two pieces keeps their offset', () => {
  const shape = Geo.footprintShape(MULTI);
  const cx = r => r.reduce((a, p) => a + p[0], 0) / r.length;
  expect(cx(shape.pieces[1].ring) - cx(shape.pieces[0].ring)).toBeCloseTo(885, -1);
});
test('footprintShape(null) is null; findMatchingGardens matches inside a MultiPolygon piece', () => {
  expect(Geo.footprintShape(null)).toBeNull();
  const g = { id: 9, title: 'm', latitude: 37.0005, longitude: -122.0005, boundary: MULTI };
  expect(Geo.findMatchingGardens(37.0005, -121.9905, [g])[0].matchMethod).toBe('inside_polygon');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/geo/geo.test.js 2>&1 | tail -20`
Expected: FAIL (`footprintShape is not a function`, MultiPolygon rejected).

- [ ] **Step 3: Implement in `config/helpers/geo.js`**

Factor the existing ring checks into `validateRing(ring)`; `validateBoundary` dispatches on `type`. `pointInPolygon` loops pieces with the existing ray cast. `polygonAreaM2`: shoelace on `(lng·cos(meanLat)·111320, lat·110574)`. `footprintShape` uses the same projection about the centroid.

- [ ] **Step 4: Schema edits**

In `schema.json`: `boundary.description` → "GeoJSON Polygon or MultiPolygon defining the garden footprint ([lng, lat] coordinate order)"; add `footprint_pieces` and `schematic` as `{"type": "json"}` with descriptions quoting the shapes from the Interfaces block.

- [ ] **Step 5: Write the failing HTTP tests in `tests/garden/visibility.js`**

Give `published` a `boundary` (the SQUARE polygon) and `footprint_pieces: [{ name: '2707 Park Blvd', source: 'parcels', lots: [] }]` at creation.

```js
describe('footprint privacy', () => {
  it('signed-out /full has footprint_shape and no boundary or footprint_pieces', async () => {
    const { body } = await get(`/api/gardens/${published.slug}/full`);
    expect(body.data.footprint_shape.pieces).toHaveLength(1);
    expect(body.data.boundary).toBeUndefined();
    expect(body.data.footprint_pieces).toBeUndefined();
  });
  it('signed-out list items carry footprint_shape only', async () => {
    const g = (await get('/api/gardens')).body.data.find(x => x.slug === published.slug);
    expect(g.footprint_shape).toBeDefined();
    expect(g.boundary).toBeUndefined();
    expect(g.footprint_pieces).toBeUndefined();
  });
  it('a signed-in non-manager gets the same stripping on /full and the list', async () => {
    const { body } = await get(`/api/gardens/${published.slug}/full`, volunteerJwt);
    expect(body.data.footprint_pieces).toBeUndefined();
    expect(body.data.footprint_shape).toBeDefined();
  });
  it('its manager gets boundary and footprint_pieces on /full', async () => {
    const { body } = await get(`/api/gardens/${published.slug}/full`, mgrJwt);
    expect(body.data.boundary.type).toBe('Polygon');
    expect(body.data.footprint_pieces[0].name).toBe('2707 Park Blvd');
  });
});
```

- [ ] **Step 6: Implement in the controller**

`toPublicGarden`: call `withFootprintShape` before deleting, then `stripFootprint`. `fullSlug` signed-in: when `!withContact` (the existing manager-or-admin flag), apply `withFootprintShape` + `stripFootprint`; managers get `withFootprintShape` only. `find` authenticated non-admin: per item, if the user is not in `managers`, strip; always add the shape.

- [ ] **Step 7: Run all tests**

Run: `npm test 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add config/helpers/geo.js src/api/garden tests/geo/geo.test.js tests/garden/visibility.js
git commit -F - <<'EOF'
feat(garden): MultiPolygon boundary, footprint_pieces/schematic fields, public footprint_shape

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 4: Beds carry a piece; plots save the schematic knobs

**Files:**
- Modify: `src/components/garden/plot.json` (add `piece`)
- Modify: `src/api/garden/services/plots.js` (`validatePlots` 27-60, `toPlots` 63-75, `getForGarden` 83-97, `replaceForGarden` 100-111; add `validateSchematic`)
- Modify: `src/api/garden/controllers/garden.js` (`replacePlots` 244-275 passes `schematic`)
- Modify: `tests/garden/plots.js`

**Interfaces:**
- Consumes: `schematic` field from Task 3.
- Produces: `plot.piece` integer (min 0). `validatePlots(items)` accepts `{ label, plant, piece? }`, returns `piece` as integer, default 0; a non-integer or negative piece throws `'Plot n: piece must be a whole number'`.
- Produces: `validateSchematic(obj) -> { rows: number|null, path, trees }` with `rows` null or 1..8, `path` one of `'centre'|'left'|'right'|'none'` (default `'centre'`), `trees` 0..6 (default 2); anything else throws `'schematic is invalid'` (tagged `plotValidationError`). `undefined` input returns the defaults.
- Produces: `replaceForGarden(garden, items, schematic)` writes both; `getForGarden(garden)` returns `{ plots, saved, schematic }` where each plot has `piece`.
- HTTP: `PUT /gardens/:slug/plots` body `{ data: { plots, schematic? } }`; `GET /gardens/:slug/plots` → `{ data: { plots, schematic, meta } }`.

- [ ] **Step 1: Write the failing tests in `tests/garden/plots.js`**

```js
it('a bed keeps its piece and defaults to 0', async () => {
  await put('plots-one', ownManagerJwt, { data: { plots: [{ label: 'A', plant: null, piece: 1 }, { label: 'B', plant: null }] } });
  const { body } = await get('plots-one');
  expect(body.data.plots.map(p => p.piece)).toEqual([1, 0]);
});
it('rejects a bad piece', async () => {
  const res = await put('plots-one', ownManagerJwt, { data: { plots: [{ label: 'A', plant: null, piece: -1 }] } });
  expect(res.status).toBe(400);
  expect(res.body.error.message).toBe('Plot 0: piece must be a whole number');
});
it('saves and returns the schematic knobs, with defaults when omitted', async () => {
  await put('plots-one', ownManagerJwt, { data: { plots: [], schematic: { rows: 2, path: 'left', trees: 0 } } });
  expect((await get('plots-one')).body.data.schematic).toEqual({ rows: 2, path: 'left', trees: 0 });
  await put('plots-one', ownManagerJwt, { data: { plots: [] } });
  expect((await get('plots-one')).body.data.schematic).toEqual({ rows: null, path: 'centre', trees: 2 });
});
it('rejects a bad schematic', async () => {
  const res = await put('plots-one', ownManagerJwt, { data: { plots: [], schematic: { path: 'diagonal' } } });
  expect(res.status).toBe(400);
  expect(res.body.error.message).toBe('schematic is invalid');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/app.test.js -t "plots" 2>&1 | tail -30`
Expected: FAIL (`piece` undefined; `schematic` undefined).

- [ ] **Step 3: Implement**

`plot.json`: `"piece": { "type": "integer", "min": 0 }`. In `plots.js`, add `piece` to `validatePlots` and `toPlots`; add `validateSchematic`; `replaceForGarden` writes `{ plots, schematic }` in the one `documents.update` call; `getForGarden` reads `schematic` from the chosen row and returns defaults when null. In the controller, pass `body.schematic`.

- [ ] **Step 4: Run all tests**

Run: `npm test 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/garden/plot.json src/api/garden tests/garden/plots.js
git commit -F - <<'EOF'
feat(garden): plots carry a piece index; plots route saves schematic knobs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 5: Managers create a garden as a draft

**Files:**
- Create: `src/api/garden/utils/slugs.js`
- Create: `src/api/garden/utils/manages.js`
- Modify: `src/api/garden/routes/01-custom-garden.js` (add `POST /gardens/create` → `garden.createByManager`)
- Modify: `src/api/garden/controllers/garden.js` (add `createByManager`)
- Modify: `src/index.js` (`MEMBER_ACTIONS` 47-55: add `'api::garden.garden.createByManager'`)
- Create: `tests/garden/create.js`
- Modify: `tests/app.test.js` (require after `./garden/visibility`)

**Interfaces:**
- Produces: `async function managesAnyGarden(strapi, userId) -> { id, documentId, organization: { documentId } | null } | null` in `manages.js`: the lowest-id garden row whose `managers` contains the user, with `organization` populated; `null` if none.
- Produces: in `slugs.js`: `function baseSlug(title) -> string` (slugify, lower, strict), `function baseSmsSlug(title) -> string` (letters and digits of the first two words, lowercase, max 12 chars, min 3 chars padded with `'gdn'`), `async function uniqueSlug(strapi, field, base) -> string` (checks all rows, draft and published, appends `-2`, `-3`... for `slug`, `2`, `3`... for `sms_slug`).
- Produces: `async createByManager(ctx)`: body `{ data: { title, latitude, longitude, boundary, footprint_pieces, plots, schematic } }`. 401 no user; 403 `'Only garden managers can add a garden'` when `managesAnyGarden` is null and not admin; 400 `'title is required'` / `'latitude and longitude are required'` / boundary errors from `Geo.validateBoundary` prefixed `'boundary: '`; plots and schematic validated through the plots service. Creates with `strapi.documents('api::garden.garden').create({ data: {...}, status: 'draft' })` where `managers: [user.id]`, `organization` is the creator's first garden's organization documentId (omitted when that is null, so the auto-org middleware provisions one). Responds 201 `{ data: { documentId, slug, sms_slug, title } }`.

- [ ] **Step 1: Write the failing tests in `tests/garden/create.js`**

Fixtures: `mgr` managing `existing` (published, `organization` set via `tests/billing/helpers.js makeGarden({ organization })` or a direct org create), `volunteer`, `admin`. Body helper `validBody(overrides)` with title `'Riverside Community Garden'`, lat `37.802306`, lng `-122.241417`, boundary a small Polygon, `footprint_pieces: [{ name: 'Lot', source: 'box', lots: [] }]`, `plots: []`, `schematic: undefined`.

```js
it('a volunteer who manages nothing is refused', async () => {
  const res = await post('/api/gardens/create', volunteerJwt, { data: validBody() });
  expect(res.status).toBe(403);
  expect(res.body.error.message).toBe('Only garden managers can add a garden');
});
it('signed out is 401 or 403', async () => {
  expect([401, 403]).toContain((await post('/api/gardens/create', null, { data: validBody() })).status);
});
it('a manager creates a draft with themselves as manager and the same organization', async () => {
  const res = await post('/api/gardens/create', mgrJwt, { data: validBody() });
  expect(res.status).toBe(201);
  expect(res.body.data.slug).toBe('riverside-community-garden');
  const rows = await strapi.db.query('api::garden.garden').findMany({
    where: { documentId: res.body.data.documentId }, populate: { managers: true, organization: true } });
  expect(rows).toHaveLength(1);
  expect(rows[0].publishedAt).toBeNull();
  expect(rows[0].managers.map(m => m.id)).toEqual([mgr.id]);
  expect(rows[0].organization.documentId).toBe(existingOrgDocumentId);
  expect(rows[0].boundary.type).toBe('Polygon');
  expect(rows[0].welcome_email_subject).toBeTruthy(); // lifecycle still ran
});
it('slugs de-duplicate against drafts too', async () => {
  const a = await post('/api/gardens/create', mgrJwt, { data: validBody({ title: 'Twin Garden' }) });
  const b = await post('/api/gardens/create', mgrJwt, { data: validBody({ title: 'Twin Garden' }) });
  expect(a.body.data.slug).toBe('twin-garden');
  expect(b.body.data.slug).toBe('twin-garden-2');
  expect(a.body.data.sms_slug).toBe('twingarden');
  expect(b.body.data.sms_slug).toBe('twingarden2');
});
it('rejects a missing title and a bad boundary with 400', async () => {
  expect((await post('/api/gardens/create', mgrJwt, { data: validBody({ title: '' }) })).status).toBe(400);
  const bad = await post('/api/gardens/create', mgrJwt, { data: validBody({ boundary: { type: 'Polygon', coordinates: [] } }) });
  expect(bad.status).toBe(400);
  expect(bad.body.error.message).toMatch(/^boundary: /);
});
it('the new draft is invisible to the public and visible to its creator', async () => {
  const { body } = await post('/api/gardens/create', mgrJwt, { data: validBody({ title: 'Hidden Garden' }) });
  expect((await get(`/api/gardens/${body.data.slug}/full`)).status).toBe(404);
  expect((await get(`/api/gardens/${body.data.slug}/full`, mgrJwt)).status).toBe(200);
});
```

Unit tests for `slugs.js` go in a new standalone `tests/garden/slugs.test.js`: `baseSmsSlug('Riverside Community Garden') === 'riversidecom'`, `baseSmsSlug('Ivy') === 'ivygdn'`, `baseSlug("Mo's Garden") === 'mos-garden'`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/app.test.js -t "create" 2>&1 | tail -30`
Expected: FAIL with 404 on the route.

- [ ] **Step 3: Implement route, helpers and controller action**

Route entry carries the same comment style as PUT plots ("Authorization is in the controller"). Add the action to `MEMBER_ACTIONS`. In the test file, grant `api::garden.garden.createByManager` the way plots.js grants `replacePlots`.

- [ ] **Step 4: Run all tests**

Run: `npm test 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/garden src/index.js tests/garden/create.js tests/garden/slugs.test.js tests/app.test.js
git commit -F - <<'EOF'
feat(garden): POST /gardens/create lets an existing manager add a draft garden

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 6: Publish route

**Files:**
- Modify: `src/api/garden/routes/01-custom-garden.js` (add `POST /gardens/:slug/publish` → `garden.publish`)
- Modify: `src/api/garden/controllers/garden.js` (add `publish`)
- Modify: `src/index.js` (`MEMBER_ACTIONS`: add `'api::garden.garden.publish'`)
- Modify: `tests/garden/create.js` (publish cases)

**Interfaces:**
- Consumes: `loadMembership(strapi, ctx)` (controller lines 20-51), `visibleGardenRows` (Task 2).
- Produces: `async publish(ctx)`: 401/400/404 via `loadMembership`; 403 `'Only managers of this garden can publish it'` unless `state.manager` or admin; `await strapi.documents('api::garden.garden').publish({ documentId })`; responds 200 `{ data: { documentId, slug, publishedAt } }`. Publishing an already-published garden republishes the draft and still returns 200.

- [ ] **Step 1: Write the failing tests (append to `tests/garden/create.js`)**

```js
describe('publish', () => {
  it('a non-manager is refused', async () => {
    const res = await post(`/api/gardens/${draft.slug}/publish`, volunteerJwt, {});
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Only managers of this garden can publish it');
  });
  it('the manager publishes; the garden becomes public and the SMS cache sees it', async () => {
    const res = await post(`/api/gardens/${draft.slug}/publish`, mgrJwt, {});
    expect(res.status).toBe(200);
    expect(res.body.data.publishedAt).toBeTruthy();
    expect((await get(`/api/gardens/${draft.slug}/full`)).status).toBe(200);
    const cached = await strapi.service('api::garden.garden').findBySmsSlug(draft.sms_slug);
    expect(cached && cached.publishedAt).toBeTruthy();
  });
  it('publishing twice is fine and creates no duplicate interests', async () => {
    const count = async () => strapi.db.query('api::user-garden-interest.user-garden-interest').count({ where: { user: mgr.id } });
    const before = await count();
    expect((await post(`/api/gardens/${draft.slug}/publish`, mgrJwt, {})).status).toBe(200);
    expect(await count()).toBe(before);
  });
  it('before publish, the SMS cache does not answer to the draft slug', async () => {
    const fresh = await post('/api/gardens/create', mgrJwt, { data: validBody({ title: 'Quiet Garden' }) });
    await strapi.service('api::garden.garden').refreshCache();
    const cached = await strapi.service('api::garden.garden').findBySmsSlug(fresh.body.data.sms_slug);
    expect(cached ? cached.publishedAt : null).toBeFalsy();
  });
});
```

The last test documents current behaviour. If it fails because the cache answers for drafts, make `initializeCache` (service lines 18-45) skip rows with `publishedAt === null` and keep the test.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/app.test.js -t "publish" 2>&1 | tail -30`
Expected: FAIL with 404 on the route.

- [ ] **Step 3: Implement**

Route after the membership routes. Grant in `MEMBER_ACTIONS` and in the test file.

- [ ] **Step 4: Run all tests**

Run: `npm test 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/garden src/index.js tests/garden/create.js
git commit -F - <<'EOF'
feat(garden): POST /gardens/:slug/publish for the garden's managers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 7: Parcel lookup with a config registry

**Files:**
- Create: `config/parcels.js`
- Create: `src/api/parcel/routes/parcel.js`
- Create: `src/api/parcel/controllers/parcel.js`
- Create: `src/api/parcel/services/parcel.js`
- Modify: `src/index.js` (`MEMBER_ACTIONS`: add `'api::parcel.parcel.nearby'`)
- Create: `tests/parcel/parcel.test.js` (pure, service with injected fetch)
- Create: `tests/parcel/nearby.js` (HTTP) and require it from `tests/app.test.js`

**Interfaces:**
- Produces: `config/parcels.js` exporting `({ env }) => ({ sources: [ { id: 'oakland', bbox: [-122.355, 37.70, -122.11, 37.885], url: 'https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Parcels/FeatureServer/0/query', fields: { apn: 'APN', address: 'SitusAddress' }, attribution: 'City of Oakland' } ], timeoutMs: env.int('PARCELS_TIMEOUT_MS', 8000) })`. Read with `strapi.config.get('parcels')`.
- Produces (service, factory `({ strapi }) => ({...})` like `plots.js`): `findSource(lat, lng) -> source | null` (first source whose bbox contains the point, `[west, south, east, north]`); `buildQueryUrl(source, lat, lng, radiusM) -> string` (ArcGIS `query` with `f=geojson`, `geometryType=esriGeometryPoint`, `inSR=4326`, `outSR=4326`, `spatialRel=esriSpatialRelIntersects`, `distance=radiusM`, `units=esriSRUnit_Meter`, `returnGeometry=true`, `outFields` = exactly the two configured field names); `toParcels(source, geojson) -> [{ apn, address, area_m2, polygon }]` where `polygon` is the outer ring of the first polygon as `[[lng, lat], ...]` and `area_m2 = Math.round(Geo.polygonAreaM2(ring))`; `async nearby(lat, lng, radiusM, fetchImpl = globalThis.fetch) -> { source: id | null, attribution, parcels, error? }` with `error: 'parcel source unavailable'` and `parcels: []` on timeout, non-2xx, or malformed JSON.
- Produces (controller): `async nearby(ctx)`: query `lat`, `lng`, `radius` (default 100, max 250); 401 no user; 403 `'Only garden managers can look up parcels'` unless `managesAnyGarden` (Task 5) or admin; 400 `'lat and lng are required'` when not finite; 200 `{ data: nearby(...) }`, `Cache-Control: private, max-age=3600`.
- Route: `GET /parcels` → `parcel.nearby`.

- [ ] **Step 1: Write the failing unit tests in `tests/parcel/parcel.test.js`**

Build the service with a stub `strapi` whose `config.get('parcels')` returns the Oakland source and `timeoutMs: 50`.

```js
test('findSource picks Oakland for the pin and nothing for Seattle', () => {
  expect(svc.findSource(37.802306, -122.241417).id).toBe('oakland');
  expect(svc.findSource(47.6, -122.33)).toBeNull();
});
test('buildQueryUrl asks for only the configured fields', () => {
  const u = new URL(svc.buildQueryUrl(src, 37.8, -122.24, 90));
  expect(u.searchParams.get('outFields')).toBe('APN,SitusAddress');
  expect(u.searchParams.get('distance')).toBe('90');
  expect(u.searchParams.get('f')).toBe('geojson');
});
test('toParcels keeps apn, address, area_m2, polygon and nothing else', () => {
  const [p] = svc.toParcels(src, FIXTURE_GEOJSON); // one feature with MailingAddress etc. in properties
  expect(Object.keys(p).sort()).toEqual(['address', 'apn', 'area_m2', 'polygon']);
  expect(p.area_m2).toBeGreaterThan(300); expect(p.area_m2).toBeLessThan(350);
});
test('nearby returns empty parcels with an error on a timeout', async () => {
  const never = () => new Promise(() => {});
  const out = await svc.nearby(37.8, -122.24, 90, never);
  expect(out).toEqual({ source: 'oakland', attribution: 'City of Oakland', parcels: [], error: 'parcel source unavailable' });
});
test('nearby returns empty parcels with an error on malformed JSON', async () => {
  const bad = async () => ({ ok: true, json: async () => { throw new Error('x'); } });
  expect((await svc.nearby(37.8, -122.24, 90, bad)).error).toBe('parcel source unavailable');
});
test('nearby outside any source is { source: null, parcels: [] } without fetching', async () => {
  const spy = jest.fn();
  expect(await svc.nearby(47.6, -122.33, 90, spy)).toEqual({ source: null, attribution: null, parcels: [] });
  expect(spy).not.toHaveBeenCalled();
});
```

`FIXTURE_GEOJSON` is a one-feature FeatureCollection using the real `22-339-16` ring from the brainstorm (365 m²) with extra `MailingAddress*` properties.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/parcel/parcel.test.js 2>&1 | tail -20`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement config, service, controller, route; add to `MEMBER_ACTIONS`**

Timeout via `AbortController` and `setTimeout(timeoutMs)`.

- [ ] **Step 4: Write the failing HTTP tests in `tests/parcel/nearby.js`**

Patch the service's fetch by `patchService('api::parcel.parcel', 'nearby', ...)` from `tests/helpers/patch.js` where needed.

```js
it('a volunteer who manages nothing is refused', async () => {
  const res = await get('/api/parcels?lat=37.8&lng=-122.24', volunteerJwt);
  expect(res.status).toBe(403);
});
it('a manager gets parcels (service stubbed)', async () => {
  patchService('api::parcel.parcel', 'nearby', async () => ({ source: 'oakland', attribution: 'City of Oakland', parcels: [{ apn: '1', address: 'X', area_m2: 1, polygon: [] }] }));
  const res = await get('/api/parcels?lat=37.8&lng=-122.24', mgrJwt);
  expect(res.status).toBe(200);
  expect(res.body.data.parcels).toHaveLength(1);
  expect(res.headers['cache-control']).toBe('private, max-age=3600');
});
it('missing coordinates is 400', async () => {
  expect((await get('/api/parcels?lat=abc', mgrJwt)).status).toBe(400);
});
```

- [ ] **Step 5: Run all tests**

Run: `npm test 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add config/parcels.js src/api/parcel src/index.js tests/parcel tests/app.test.js
git commit -F - <<'EOF'
feat(parcel): GET /parcels looks up nearby lots from a config registry (Oakland first)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 8: Manual smoke against a running backend

**Files:** none changed.

- [ ] **Step 1: Start the backend and exercise the flow with curl**

With `npm run develop` running and a manager JWT in hand: `POST /api/gardens/create` with the Task 5 body → 201; `GET /api/gardens/<slug>/full` signed out → 404; `POST /api/gardens/<slug>/publish` → 200; `GET /api/gardens/<slug>/full` signed out → 200 with `footprint_shape` and no `boundary`; `GET /api/parcels?lat=37.802306&lng=-122.241417` as the manager → parcels from Oakland.
Expected: each status as listed. Paste the five status lines into the task report.
