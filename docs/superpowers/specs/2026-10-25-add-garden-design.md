# Add a garden: design

Date: 2026-10-25
Status: reviewed by a builder check, awaiting approval
Repos: this one (Vue frontend, `garden-vue-hack`) and the Strapi backend in the sibling folder `../steward-bank-hack`.

## Intent

A person who already manages a garden on Garden Steward can add another one themselves, without emailing us. They give the garden a name and a location, mark its footprint on aerial imagery by tapping lots and clicking on the garden itself, and list its beds. The garden stays hidden from the public until they say it's ready. Visitors then see it on Explore as a flat schematic drawing, which replaces the current 3D floating island for every garden.

Why now: today the only way to get a garden onto the site is the "Request a new garden" email link on the manage dashboard, and someone on our side creates it in the Strapi admin. Managers who run more than one site are blocked on us.

## Goals

- A manager can create a second (third, ...) garden end to end from the manage dashboard, in one sitting, on a phone or a laptop.
- The footprint is close to the real garden, not just a pin, so the schematic and location matching are meaningful.
- The garden stays invisible to the public until the manager publishes it.
- Explore shows every garden as a schematic drawn from real data: the footprint and the bed list.

## Non-goals

- Self-serve garden creation for people who manage nothing yet. They keep the email link.
- A free-form drawing canvas where beds are dragged around. Beds are a list; the picture draws itself.
- Automatic detection of garden edges with no input from the manager.
- Editing the footprint or beds on the public pages. Visitors only look.
- Changing anything about volunteers, events, tasks, SMS, or projects.

## Anti-goals (what would make this a failure even if it works)

- A draft garden leaking into the public list, map, Explore, or search before "Make public".
- Showing anyone the owner or mailing-address fields that come with parcel data. Only the street address and area may ever reach the browser.
- Breaking the existing 3D-era data: gardens that already have beds (the `plots` component) must render as a schematic without re-entry.
- A footprint tool that only works in Oakland. It must degrade gracefully anywhere.

## The people

**Manager** (signed in, already in the `managers` relation of at least one garden). Does everything in this document.

**Volunteer** (signed in, manages nothing). Sees no change except the schematic on Explore.

**Visitor** (signed out). Sees the schematic on Explore. Never sees a draft garden, the footprint polygon, or an exact location (the existing offset rules stay).

## The flow

The entry point is an "Add a garden" button on the manage dashboard at `/manage`, shown in place of the "Request a new garden" email link when the signed-in user manages at least one garden. Everyone else keeps the email link. The button goes to `/manage/gardens/new`.

The new page is a three-step wizard. Each step saves nothing until the end of step 2, when the garden is created as a draft. Step 3 is editing the draft.

### Step 1: name and footprint

Fields, in order:

1. **Garden name.** Required. Free text, up to the schema's limit.
2. **Coordinates.** One text box that accepts decimal (`37.802306, -122.241417`), degrees-minutes-seconds (`37°48'08.3"N 122°14'29.1"W`), or a pasted Google Maps style string. Parse it client-side; show the parsed decimal pair under the box so the manager can see what was understood. Required.
3. **Aerial map.** Leaflet showing USGS NAIP Plus public-domain aerial imagery (see "Aerial imagery"), centred on the pin at about 1:1,000, zoomable to the imagery's 30 cm pixels, pannable. A draggable pin for small corrections. The existing OpenStreetMap tiles are not used on this page.

Then two moves on the map, with a small two-segment switch "Lots / Garden":

**Lots.** The app fetches parcel polygons within about 100 m of the pin from a parcel source (see "Parcel sources") and draws them as thin white outlines on the imagery. Tapping a lot selects it (green tint), tapping again deselects. A side panel lists the selected lots with their street address and area, and a total. If no parcel source covers the location, this segment is hidden, no box is drawn, and the "allowed" area for the Garden step is everything within 100 m of the pin. The colour match does the bounding on its own there; the "Whole lots" button is hidden. A note under the map says lot lines aren't available for this area.

**Garden.** The lot lines stay as dashed guides. Clicking on the imagery grows an estimated garden region from that spot: cells of about 1.4 m whose average colour is similar to the clicked cell, flood-filled from the click, never leaving the selected lots (see "Estimating the garden from a click"). The region renders as a translucent green overlay. More clicks add regions. A click inside the green removes that connected patch. Controls: "Undo click", "Whole lots" (fills all selected lots), and a "How picky" slider for the colour tolerance. The panel shows the estimated area live in m² and sq ft.

The footprint saved is the union of the marked cells, traced to a polygon per connected piece and simplified so small stair-steps become straight edges. A garden may have several pieces that don't touch. Each piece gets a name defaulting to the street address of the lot it mostly sits in, or "Piece 1", "Piece 2" when there is no parcel data. These names are for the manager only (see Privacy).

Validation to continue: a name, parsed coordinates, and at least one marked cell. "Whole lots" with one lot selected is the quickest valid path.

### Step 2: beds

The existing bed editor (today `src/explore/ExplorePlotEditor.vue`, used from the Explore sheet) is reused: name each bed, pick a plant from the plant search, reorder, add, remove. It becomes a controlled component, since in the wizard the garden doesn't exist yet to save against. Two additions:

- When the footprint has more than one piece, each bed has a "which piece" selector. Hidden when there's one piece.
- Three layout knobs with sensible defaults: rows per piece (auto), path position (centre), decorative trees (2). These only affect the drawing.

Beds are optional. A garden can be created with none; the schematic then falls back to plants logged nearby, and to "No beds laid out yet" when there are none.

Pressing "Create garden" creates the garden as a Strapi draft with the creator as its first manager and the footprint, beds and layout knobs saved. The manager lands on step 3.

### Step 3: done, and finishing up

A short page: the garden's name, a preview of the schematic, a "Not public yet" notice, and three links: "Finish setting up" (the existing manage page at `/manage/gardens/:slug`), "Add another garden", "Back to dashboard".

The existing manage page gets a banner at the top for draft gardens: "This garden isn't public yet. Volunteers can't find it." with a **Make public** button. Pressing it publishes the draft. After that the banner is gone and nothing else changes; the public page link that already exists on that page starts working.

### Editing after creation

Nothing set in the wizard is permanent:

- **Footprint.** The manage page gets a "Footprint" section that mounts the same map component as step 1 (pin, lots, garden estimate, zoom), loaded with the garden's saved `boundary` and `footprint_pieces` as the starting marking. Saving replaces `boundary` and `footprint_pieces`. Beds assigned to a piece that no longer exists fall back to piece 0.
- **Coordinates.** Editable in the same section by moving the pin or retyping; the existing settings field for location, if any, is folded into it rather than duplicated.
- **Beds, piece and layout knobs.** The Explore bed editor grows the "which piece" selector and the three layout knobs, and `PUT /gardens/:slug/plots` accepts `piece` per bed and a `schematic` object alongside `plots`. The wizard's step 2 and the Explore editor are the same component.
- **Name and SMS slug.** Editable in the manage page's general settings (the SMS slug field is added there).

Deleting a garden and unpublishing stay out of scope.

The manage dashboard shows draft gardens in the manager's list with the existing "Draft" badge (the code for it is already there, `isDraft` in `GardensView.vue`, it just never had data to show).

## Explore: the schematic replaces the island

`src/views/ExploreView.vue` currently mounts a three.js floating island (`src/explore/viewer/*`). That whole viewer is replaced by an SVG schematic component. The three.js dependency is removed from `package.json`.

What the schematic draws, for one garden, from top down:

- **The footprint**, each piece as a filled light shape with a dashed dark outline, in its real shape and orientation (north up). Pieces are placed in their real relative positions when the bounding box of all pieces, scaled to fit the stage, still leaves beds at least about 60 px wide. Otherwise pieces sit side by side with equal gaps and a small "not to scale" caption.
- **A path**, a lighter strip through each piece, positioned by the path knob (centre by default), running the long way of the piece.
- **Beds**, as rounded rectangles in rows on either side of the path, filled in a colour by plant type (the existing `archetypeOf` mapping decides the family, the schematic maps families to four or five soft colours), each with a white label chip showing the bed's name and "Bed N". Bed size is fixed in metres (about 2.4 m by 1.2 m) and scaled with the footprint, with a minimum pixel size so labels stay readable. A bed with no plant is drawn in neutral grey.
- **Trees**, soft green circles with a dot, scattered in corners of the footprint by the trees knob, deterministic from the garden slug so they don't jump around.
- A garden with no footprint (every garden created before this feature) gets a default rectangle sized to fit its beds, so nothing existing breaks.
- A garden with no saved beds keeps today's fallback: the schematic draws one unlabelled bed per plant logged nearby (the `islandPlots` logic in `ExploreView.vue`, the "Growing here" section, and the editor's "start from the N plants logged nearby" all survive). "No beds laid out yet" appears only when there are no saved beds and no logged plants either. So on day one existing gardens look populated, not empty.

Interaction, unchanged from the island: tapping a bed selects it, opens the same side sheet with the plant and its care notes, and the selected bed is outlined. Escape or tapping empty space deselects. Pinch to zoom and drag to pan on the stage. The "Edit beds" affordance for managers stays where it is on the Explore sheet.

What is dropped: the bobbing animation, the sky background, WebGL. The reduced-motion check becomes irrelevant and goes away.

## Data

### Garden schema (backend)

Existing fields used: `title`, `slug`, `sms_slug`, `latitude`, `longitude`, `boundary`, `managers`, `organization`, `plots`, `hero_image`, draft and publish.

Changes:

- `boundary` becomes a GeoJSON **MultiPolygon** (or a Polygon, both accepted on read). The validator in `config/helpers/geo.js` accepts both; the point-in-polygon check used for location matching tests every piece. Existing single-polygon data keeps working.
- New JSON field `footprint_pieces`: `[{ name: string, source: "parcels" | "box", lots: [{ apn, address, area_m2 }] }]`, one entry per polygon in `boundary`, same order. Only street address and area from parcel data. No owner or mailing fields, ever.
- The `plots` component (`garden.plot`) gets an optional `piece` integer, index into `footprint_pieces`. Missing or out of range means piece 0.
- New JSON field `schematic`: `{ rows: number | null, path: "centre" | "left" | "right" | "none", trees: number }`. Defaults when absent: `{ rows: null, path: "centre", trees: 2 }`.

### Creating the garden (backend)

A new custom route `POST /api/gardens/create` (name is the builder's call), authenticated, with the manager check in the controller like the other custom garden routes: the caller must be in `managers` of at least one garden. Body: `title`, `latitude`, `longitude`, `boundary`, `footprint_pieces`, `plots`, `schematic`. The controller:

1. Rejects callers who manage no garden with a 403 and the same anti-enumeration wording style the other routes use.
2. Generates `slug` from the title (lowercase, hyphens, ASCII), de-duplicated with a numeric suffix. Generates `sms_slug` the same way but shorter (first word or two, letters and digits only, up to 12 characters), de-duplicated against both draft and published rows. The SMS slug is what volunteers text to join, so it is shown to the manager on the done page and is editable on the manage page's settings (add the field there if it isn't already editable).
3. Sets `organization` to the organization of the first garden the caller manages (ordered by id), or null if that garden has none.
4. Sets `managers` to `[caller]`. The caller is not added as a volunteer.
5. Creates the document as a **draft** through the Document Service (`status: 'draft'`), so the existing `beforeCreate` lifecycle still seeds the welcome email and validates the boundary.
6. Returns the garden with `slug`, `documentId`, `sms_slug`.

The stock `POST /api/gardens` route stays closed to the Authenticated role as it is today.

### Publishing (backend)

A new route `POST /api/gardens/:slug/publish`, authenticated, manager-of-this-garden check in the controller (same `loadMembership` helper). Publishes the draft through the Document Service `publish`. Returns the published garden. There is no unpublish in this feature.

The existing garden cache (`initializeCache` in the garden service) already prefers published rows; the builder verifies that a draft garden's `sms_slug` doesn't start answering texts before publish. If it does, the cache skips drafts.

### Drafts: who sees them and how they stay drafts (backend)

Two facts about the code as it stands today, both of which this feature must fix because the draft state is what keeps the garden hidden:

1. **The stock update publishes.** Strapi's core `update` defaults to `status: 'published'`, so the existing `PUT /api/gardens/:id` used by the manage page's settings, visit info, and add/remove manager would publish a draft garden the first time the manager saved anything. Fix: override `update` in the garden controller (or service) so it passes the document's current status: a draft stays a draft, a published garden updates its published row as today. Publishing happens only through the explicit publish route. This changes nothing for published gardens.

2. **Drafts are not actually hidden today.** The custom `find` for signed-in non-admins queries every row with no `publishedAt` filter, and the signed-out `/gardens/:slug/full` and `/gardens/:slug/plots` only order by `publishedAt` rather than filtering, so a draft-only garden would already answer on its public page. Fix: every read filters to published rows unless the caller is an administrator or a manager of that specific garden (the `loadMembership` helper already answers that). That covers the list, `/full`, `/plots`, the day sheet, and anything else that resolves a garden by slug.

With those in place the manage dashboard's `getAll` and `getSlug` in `src/stores/gardens.store.js` see a manager's drafts with no frontend change, and the public endpoints cannot. The leak test (Privacy section) asserts both as a volunteer who is not a manager of the draft and as a signed-out visitor.

### Parcel sources (backend)

A small registry in the backend, keyed by a bounding box, each entry an ArcGIS Feature Service query URL and the field names for APN, street address, and area. The backend exposes `GET /api/parcels?lat=&lng=&radius=` (authenticated) that picks the source whose box contains the point, queries it with `outFields` limited to the three fields, converts to GeoJSON if needed, and returns `[{ apn, address, area_m2, polygon }]`. It returns an empty list with `source: null` when no registry entry covers the point, and the frontend shows the default box instead.

First entry: City of Oakland's open parcel layer at `https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Parcels/FeatureServer/0`, fields `APN`, `SitusAddress`, geometry area computed server-side in m². This was tested on 2026-10-25 against the coordinates in the mockups and returned 58 lots within 90 m with polygons.

The frontend never calls a parcel service directly. That keeps owner fields out of the browser and lets us swap sources without a release.

### Aerial imagery (frontend)

USGS NAIP Plus, the public-domain US orthoimagery service from The National Map: `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer`. No API key, no account, public domain, so reading its pixels and storing shapes derived from them is unrestricted. Attribution in the map corner: "USGS, USDA, The National Map: Orthoimagery".

Checked on 2026-10-25 at the Oakland coordinates: 30 cm pixels (Esri's were 24 cm), `Access-Control-Allow-Origin: *` so canvas pixel reading works, responses cached 12 hours, `exportImage` up to 4000 px a side. It has no tile cache, so the builder writes a small Leaflet tile layer whose tile URL is an `exportImage` request for that tile's bounding box in Web Mercator at 256 or 512 px (no plugin needed), with `crossOrigin: 'anonymous'`.

Limits accepted: US only, and refreshed every one to three years per state. Outside the US the page falls back to the OpenStreetMap tiles the app already uses, with the "Garden" step disabled and "Whole lots" or the 100 m area as the only footprint. Esri, Mapbox and Google were not chosen because each needs an API key and has terms to check for pixel derivation.

## Estimating the garden from a click (frontend)

Done entirely in the browser, on a canvas the Leaflet imagery tiles are drawn into for the current view. The algorithm, which the mockup implements and which was tested (on Esri imagery; NAIP's 30 cm pixels average into the same 1.4 m cells):

- Divide the view into square cells of about 1.4 m on the ground (scale the cell size in pixels with zoom so it stays about 1.4 m).
- Each cell's colour is the mean RGB of its pixels.
- A cell is **allowed** if its centre is inside a selected lot, or, with no parcel source, within 100 m of the pin.
- On click, flood-fill from the clicked cell over 4-connected allowed cells whose colour distance (Euclidean RGB) from the region's running mean is under the tolerance. Default tolerance 38, slider range 15 to 80.
- After an add, fill single holes: an allowed cell with three or more marked neighbours becomes marked.
- A click on a marked cell removes the flood-filled region of similar colour instead.
- Keep a history for undo.

Cells are kept in geographic terms (cell centre lat/lng) so zooming and panning don't lose the marking. On "Create garden", trace the marked cells into polygon rings per connected piece, simplify (Douglas-Peucker, about 0.5 m tolerance), and save as `boundary`.

Tested on 2026-10-25 with the Oakland coordinates: one click in the open part of a 324 m² lot marked 116 m² and stopped at the house roof and the lot line.

Cross-origin note: pixels are only readable from the canvas if the imagery server sends CORS headers. The USGS service does (verified). The builder sets `crossOrigin: 'anonymous'` on the layer; if pixel reading ever fails, the page falls back to "Whole lots" only and says so.

## Privacy

- Parcel data reaches the browser as street address, area and polygon only. The backend strips everything else.
- A draft garden is excluded from every public read. The builder adds a test that creates a draft and asserts it is absent from the public list, the public garden page, Explore's fetch, and the map.
- Public reads of a published garden keep today's rules: offset location, no `boundary`, no user records. `footprint_pieces` is treated like `boundary` and removed from public responses.
- The schematic on Explore is drawn from the garden's real footprint shape, which is fine: it's shape and orientation, not position. What the public gets is a separate derived field, `footprint_shape`, computed on the backend from `boundary`: each piece as a ring of `[x, y]` metres relative to the centroid of all pieces, north up, rounded to 0.5 m, plus each piece's area in m². No coordinates, no lot addresses, no piece names. It is served wherever the public garden is served today (`/api/gardens` list, `/gardens/:slug/full`), published rows only.
- Piece names (street addresses by default) exist for the manager's own use in the bed editor and never leave the authenticated manager-only responses. On the public schematic, pieces are unlabelled when there is one and lettered "A", "B", ... when there are several. The bed editor's "which piece" selector shows the manager's names.

## Decisions the manager-side user made (theirs)

- Only existing managers can add a garden.
- Fields to create: name, coordinates, footprint ("the plot"), beds.
- Hidden until finished setting up.
- The picture is a flat schematic, in the style of the sketch they provided (labelled beds in soft colours, a path, trees, a dashed plot outline), not 3D.
- Beds are a list and the picture draws itself (option B in the mockups).
- Footprint is marked by tapping lots, then clicking on the garden to estimate the region, with zoom. Corner-dragging was tried and rejected.
- A garden can span lots that don't touch.

## Sequencing

The Explore page, its bed editor, the three.js viewer, and the backend `plots` component, service and routes are all uncommitted work in both repos at the time of writing. Nothing with `plots` data has reached production. So:

- The schematic is built directly into the uncommitted Explore page. The three.js island never ships, and the `three` dependency is removed before the first commit of this work.
- The first task in the plan commits the current uncommitted state of both repos as a baseline, so the schematic work is reviewable as a diff.
- Adding `piece` to the `plots` component and the new garden fields are plain schema edits, not migrations.
- The "3D-era data must render" anti-goal reduces to: gardens with saved beds but no footprint render in the default rectangle.

## Decisions I made (mine, check these)

- The new garden joins the organization of the first garden the creator manages.
- Slugs and the SMS slug are generated from the name; the SMS slug is editable afterwards.
- The creator becomes the first manager and is not added as a volunteer.
- USGS NAIP Plus public-domain aerial imagery, no API key; Oakland's open parcel layer as the first parcel source; a 100 m radius around the pin as the allowed area where there is no parcel source.
- Colour-match flood fill for the estimate, with the tolerance slider, undo, and "Whole lots".
- The schematic replaces the island for every garden, including ones with no footprint (default rectangle).
- Pieces are drawn in real relative positions when that keeps beds readable, otherwise side by side with a "not to scale" caption.
- No unpublish. No deleting a garden from the site. Everything else set in the wizard is editable afterwards (the manager-side user asked for this).
- Beds are optional at creation.
- `footprint_pieces` and `schematic` are JSON fields rather than components, to keep the Strapi schema change small.
- The public gets a derived `footprint_shape` in centroid-relative metres and never `boundary`, lot addresses or piece names.
- The garden controller's `update` preserves draft status, and every garden read filters drafts to that garden's managers and administrators.
- The "plants logged nearby" fallback stays.
- With no parcel source, the Garden step works within 100 m of the pin with no box.
- The schematic lands in the uncommitted Explore work; three.js is never shipped.
- New routes (`create`, `publish`, `parcels`) are gated to managers in their controllers, not merely to the Authenticated role, and are added to the boot-time grant list in the backend's `src/index.js`. The publish route makes the garden `afterCreate` lifecycle work idempotent, since publishing creates a second row.

## Left to the builder

- Component and file layout on the frontend, including whether the wizard is one view with steps or three routes.
- Exact route names and the `mine`-vs-`status=draft` choice for reading a manager's drafts.
- The parcel registry's shape beyond the first entry, and how a second county gets added.
- Polygon tracing and simplification implementation (a small dependency is fine).
- Schematic colour values and typography, matching the mockups' feel: paper background, soft terracotta, greens, pink, and a pale path.
- Keyboard and screen-reader paths for the lot picker and the schematic (each lot and bed is focusable and announces its name and area).
- Test strategy, following the repo's existing patterns.

## Mockups

Throwaway mockups from the brainstorm, for feel only:

- `.superpowers/brainstorm/schematic-mockups.html` in this repo: the add form, options A and B for beds, the visitor schematic.
- `.superpowers/brainstorm/parcels-paint.html` (with `parcels.js`): the agreed footprint interaction, lots then click-to-estimate, with zoom, on real Oakland parcel data. It uses Esri tiles embedded as data; the build uses USGS imagery instead.
