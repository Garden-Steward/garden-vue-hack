<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuthStore, useEventStore } from '@/stores';
import { fetchWrapper } from '@/helpers';
import { RsvpPhoneModal } from '@/components/modals';
import { approximateCenter, APPROX_AREA_RADIUS_M } from '@/helpers/location-privacy';
import { distanceKm, formatDistance, geocode, nearest, searchArea } from '@/explore/geo';
import Schematic from '@/explore/schematic/Schematic.vue';
import LoadingSpinner from '@/components/LoadingSpinner.vue';
import ExploreEventForm from '@/explore/ExploreEventForm.vue';
import ExploreTaskForm from '@/explore/ExploreTaskForm.vue';
import ExploreTaskRow from '@/explore/ExploreTaskRow.vue';
import ExplorePlotEditor from '@/explore/ExplorePlotEditor.vue';
import { repeatSummary } from '@/explore/repeat';

// Explore: find a garden on the map, then open its flat SVG schematic
// where each bed shows one of the plants logged nearby.
// Ported from the garden-discover prototype; data comes from Strapi.

const PLANT_RADIUS_KM = 0.5; // same radius as the garden Plants tab
const FLY_MS = 900;
const TYPE_LABELS = {
    annual: 'Annual',
    perennial: 'Perennial',
    herb: 'Herb',
    tree: 'Tree',
    shrub: 'Shrub',
    wildflower: 'Wildflower',
    fungi: 'Fungi'
};

// A tiny floating island, used for map markers and garden cards.
const ISLE_SVG = `<svg viewBox="0 0 48 44" aria-hidden="true">
<path d="M8 17 L24 42 L40 17 Z" fill="#7d7468"/><path d="M24 42 L40 17 L31 17 Z" fill="#5f574d"/>
<path d="M6 15 L42 15 L39 21 L9 21 Z" fill="#8a6446"/>
<ellipse cx="24" cy="14" rx="19" ry="6" fill="#7fb05a"/><ellipse cx="24" cy="13" rx="17" ry="4.6" fill="#93c26b"/>
<rect x="15" y="10" width="7" height="4" rx="1" fill="#5c4331"/><rect x="26" y="10" width="7" height="4" rx="1" fill="#5c4331"/>
<circle cx="18.5" cy="8.5" r="3" fill="#4f8a3c"/><circle cx="29.5" cy="8" r="3.4" fill="#5e9a45"/><circle cx="31" cy="6.5" r="1.1" fill="#d9443a"/>
</svg>`;

// Same rule as the public tasks page: only tasks that are ready or under way.
const ACTIVE_TASK = (t) => ['INITIALIZED', 'IN_PROGRESS'].includes(String(t.task_status || '').toUpperCase());

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const eventStore = useEventStore();
const { user } = storeToRefs(authStore);
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// ── Data ──
// Our own copy of every published garden. The shared gardens store can hold
// another page's list (e.g. /manage), so Explore never reads it.
const gardens = ref({ loading: true });
const trackings = ref(null); // null while loading
const trackingsError = ref(false);

const events = ref([]); // upcoming public workdays, every garden
const allTasks = ref([]); // every unfinished garden task, every garden (managers see these)
const tasks = computed(() => allTasks.value.filter(ACTIVE_TASK)); // what the public sees

/** Every page of a Strapi collection. `query` already holds filters and populate. */
async function fetchAllPages(path, query) {
    const all = [];
    for (let page = 1, pageCount = 1; page <= pageCount; page++) {
        const res = await fetchWrapper.get(`${import.meta.env.VITE_API_URL}${path}?${query}&pagination[page]=${page}&pagination[pageSize]=100`);
        const rows = Array.isArray(res) ? res : res?.data;
        all.push(...(Array.isArray(rows) ? rows : []));
        pageCount = res?.meta?.pagination?.pageCount ?? 1;
    }
    return all;
}

async function loadGardens() {
    gardens.value = { loading: true };
    try {
        // Managers come back as bare ids on this route; names are loaded per garden (see loadHosts).
        const rows = await fetchAllPages('/api/gardens', 'populate[managers][fields][0]=id');
        // Signed in, this route also returns each garden's draft row (Strapi 5 keeps
        // both). Current gardens are the published ones, one per slug.
        const bySlug = new Map();
        for (const g of rows) if (g?.publishedAt && g.slug && !bySlug.has(g.slug)) bySlug.set(g.slug, g);
        gardens.value = [...bySlug.values()];
    } catch (error) {
        gardens.value = { error };
    }
}

async function loadTrackings() {
    try {
        trackings.value = await fetchAllPages('/api/location-trackings', 'populate[plant][populate][0]=clipart&populate[plant][populate][1]=images');
    } catch (e) {
        trackingsError.value = true;
        trackings.value = [];
    }
}

// Events and tasks are extras: the map and islands still work without them.
const eventsLoading = ref(true);

async function loadEvents() {
    eventsLoading.value = true;
    try {
        const now = Date.now();
        events.value = (await fetchAllPages('/api/volunteer-days/public', 'populate[0]=garden'))
            .filter(e => e?.garden?.slug && e.startDatetime && new Date(e.startDatetime).getTime() >= now)
            .sort((a, b) => new Date(a.startDatetime) - new Date(b.startDatetime));
    } catch (e) {
        events.value = [];
    }
    eventsLoading.value = false;
}

async function loadTasks() {
    try {
        // Only volunteer ids and the garden slug: a bare populate would ship whole user records.
        const query = 'populate[volunteers][fields][0]=id&populate[garden][fields][0]=slug'
            + '&filters[$or][0][task_status][$ne]=FINISHED&filters[$or][1][task_status][$null]=true';
        allTasks.value = (await fetchAllPages('/api/garden-tasks', query)).filter(t => t?.garden?.slug);
    } catch (e) {
        allTasks.value = [];
    }
}

const spotsOf = (t) => Math.max(0, (t.max_volunteers || 1) - (Array.isArray(t.volunteers) ? t.volunteers.length : 0));

/** Per garden slug: upcoming events, open tasks, and how many people / spots those tasks have. */
const activity = computed(() => {
    const bySlug = {};
    const entry = (slug) => bySlug[slug] || (bySlug[slug] = { events: [], tasks: [], people: new Set(), openSpots: 0 });
    for (const e of events.value) entry(e.garden.slug).events.push(e);
    for (const t of tasks.value) {
        const a = entry(t.garden.slug);
        a.tasks.push(t);
        a.openSpots += spotsOf(t);
        (t.volunteers || []).forEach(v => a.people.add(v.id ?? v));
    }
    return bySlug;
});
const activityOf = (slug) => activity.value[slug] ?? { events: [], tasks: [], people: new Set(), openSpots: 0 };

/** "3 volunteers signed up · 2 spots open", or '' when the garden has no open tasks. */
function volunteerText(slug) {
    const a = activityOf(slug);
    if (!a.tasks.length) return '';
    const signed = a.people.size ? `${plural(a.people.size, 'volunteer')} signed up` : 'No volunteers yet';
    return a.openSpots ? `${signed} · ${plural(a.openSpots, 'spot')} open` : signed;
}

const formatDay = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const formatTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const plantImage = (plant) =>
    plant?.clipart?.url || plant?.images?.[0]?.formats?.small?.url || plant?.images?.[0]?.url || null;

/**
 * Every published garden, each with the distinct plants logged within
 * PLANT_RADIUS_KM. Gardens without coordinates (`onMap: false`) still get a
 * card and an island, just no map marker. Signed-out visitors only get the
 * approximate spot.
 */
const exploreGardens = computed(() => {
    if (!Array.isArray(gardens.value)) return [];
    const logged = Array.isArray(trackings.value) ? trackings.value : [];
    return gardens.value
        .filter(g => g.slug)
        .map(g => {
            const base = {
                id: g.id,
                slug: g.slug,
                title: g.title,
                blurb: g.blurb,
                managerIds: (Array.isArray(g.managers) ? g.managers : []).map(m => m.id ?? m),
                footprintShape: g.footprint_shape ?? null
            };
            if (!Number.isFinite(Number(g.latitude)) || !Number.isFinite(Number(g.longitude)) || g.latitude === null || g.longitude === null) {
                return { ...base, onMap: false, lat: null, lng: null, plants: [] };
            }
            const exact = { lat: Number(g.latitude), lng: Number(g.longitude) };
            // Strapi already offsets coordinates for signed-out callers and says so;
            // offsetting again would double the shift.
            const shown = user.value || g.location_approximate ? exact : (() => {
                const c = approximateCenter(exact.lat, exact.lng, g.id);
                return { lat: c.latitude, lng: c.longitude };
            })();
            const byPlant = new Map();
            for (const t of logged) {
                if (!t.plant || t.latitude == null || t.longitude == null) continue;
                if (distanceKm(exact, { lat: Number(t.latitude), lng: Number(t.longitude) }) > PLANT_RADIUS_KM) continue;
                const key = t.plant.documentId ?? t.plant.id;
                const entry = byPlant.get(key);
                if (entry) entry.count++;
                else byPlant.set(key, { key: String(key), plant: t.plant, count: 1 });
            }
            const plants = [...byPlant.values()].sort((a, b) => (a.plant.title || '').localeCompare(b.plant.title || ''));
            return { ...base, onMap: true, ...shown, plants };
        });
});
const mappedGardens = computed(() => exploreGardens.value.filter(g => g.onMap));

// ── Hosts (garden managers) ──
// Public garden routes only expose manager ids. The garden's own /full route may
// carry names (it does for some callers); otherwise the public event route
// populates its garden's managers, so a garden with an upcoming workday can
// still show who runs it.
const hostsBySlug = ref({}); // slug → [{ id, firstName, lastName, username, color }]
const hostRequests = new Map();

const hasName = (m) => !!(m && (m.firstName || m.username));

function loadHosts(slug) {
    if (hostRequests.has(slug)) return hostRequests.get(slug);
    const api = import.meta.env.VITE_API_URL;
    const request = (async () => {
        // A failure here just falls through to the event route.
        const full = await fetchWrapper.get(`${api}/api/gardens/${slug}/full?populate=managers`).catch(() => null);
        const named = (full?.data?.managers || []).filter(hasName);
        if (named.length) return named;
        const next = activityOf(slug).events[0];
        if (!next) return [];
        try {
            const res = await fetchWrapper.get(`${api}/api/volunteer-days/by-id/${next.id}`);
            const managers = res?.data?.garden?.managers;
            return Array.isArray(managers) ? managers.filter(hasName) : [];
        } catch (e) {
            return [];
        }
    })().then(hosts => {
        hostsBySlug.value = { ...hostsBySlug.value, [slug]: hosts };
        return hosts;
    });
    hostRequests.set(slug, request);
    return request;
}

/** Hosts for the cards and the schematic, once events are in (the fallback needs them). */
watch([exploreGardens, events, eventsLoading], () => {
    if (eventsLoading.value) return;
    exploreGardens.value.forEach(g => loadHosts(g.slug));
});

const hostsOf = (slug) => hostsBySlug.value[slug] || [];
const hostName = (u) => [u.firstName, u.lastName ? `${u.lastName[0]}.` : ''].filter(Boolean).join(' ') || u.username;
const initials = (u) => ((u.firstName?.[0] || u.username?.[0] || '') + (u.lastName?.[0] || '')).toUpperCase();
// Profile colors are plain names ("yellow", "indigo"); tone them down and keep initials readable.
const AVATAR_COLORS = {
    red: ['#d9443a', '#fff'],
    orange: ['#f39a1e', '#1c2318'],
    yellow: ['#ffcf3f', '#1c2318'],
    green: ['#4f8a3c', '#fff'],
    teal: ['#2f8f83', '#fff'],
    blue: ['#3a6fc4', '#fff'],
    indigo: ['#5b4fc0', '#fff'],
    purple: ['#8a5bc4', '#fff'],
    pink: ['#e06c9f', '#fff'],
    gray: ['#6b7280', '#fff']
};
const avatarStyle = (u) => {
    const [bg, fg] = AVATAR_COLORS[String(u.color || '').toLowerCase()] || [];
    if (bg) return { backgroundColor: bg, color: fg };
    return u.color ? { backgroundColor: u.color } : {};
};

/** "Hosted by Jane D. & 3 others", or a count when names aren't public. */
function hostLine(g) {
    const hosts = hostsOf(g.slug);
    if (hosts.length) {
        const others = hosts.length - 1;
        return `Hosted by ${hostName(hosts[0])}${others ? ` & ${plural(others, 'other')}` : ''}`;
    }
    return g.managerIds.length ? `${plural(g.managerIds.length, 'garden manager')}` : '';
}

const loading = computed(() => gardens.value?.loading || trackings.value === null);
const slug = computed(() => route.params.slug || null);
const current = computed(() => exploreGardens.value.find(g => g.slug === slug.value) || null);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const plantCount = (g) => g.plants.length ? plural(g.plants.length, 'plant') : 'Nothing logged yet';

/**
 * The one line a garden card shows: open volunteer spots first (that's the
 * yellow "needs help" state), else the next workday, else what's growing.
 * After a search the distance leads.
 */
function cardStatus(g, km) {
    const a = activityOf(g.slug);
    const text = a.openSpots
        ? `${plural(a.openSpots, 'spot')} open`
        : a.events.length
            ? `Workday ${formatDay(a.events[0].startDatetime)}`
            : plantCount(g);
    // Signed out, distances are to the approximate spot, so they read "≈ 0.3 mi".
    const where = km !== null ? `${user.value ? '' : '≈ '}${formatDistance(km)}` : g.onMap ? '' : 'Not on the map';
    return { text: where ? `${where} · ${text}` : text, help: a.openSpots > 0 };
}

// ── Full-bleed frame: the page escapes the app's centred container ──
const rootEl = ref(null);
const frame = ref({});

function measureFrame() {
    const parent = rootEl.value?.parentElement;
    if (!parent) return;
    const left = parent.getBoundingClientRect().left;
    const nav = document.querySelector('.gs-navbar')?.getBoundingClientRect().height ?? 0;
    const style = getComputedStyle(parent);
    frame.value = {
        '--ex-left': `${-left}px`,
        '--ex-width': `${document.documentElement.clientWidth}px`,
        '--ex-pull': `${parseFloat(style.paddingTop) || 0}px`,
        '--ex-pull-bottom': `${parseFloat(style.paddingBottom) || 0}px`,
        '--ex-nav': `${nav}px`
    };
}

// ── Search (kept at module scope so it survives a trip to a garden and back) ──
const query = ref(lastSearch.query);
const searchStatus = ref(lastSearch.status);
const place = ref(lastSearch.place);
const searching = ref(false);
let pending;

/**
 * Every garden for the card strip: nearest first after a search, else by name.
 * Gardens without a location come last, so they're still there to open.
 */
const cards = computed(() => {
    const byName = (a, b) => (a.title || '').localeCompare(b.title || '');
    const unmapped = exploreGardens.value.filter(g => !g.onMap).sort(byName).map(g => ({ g, km: null }));
    if (place.value) {
        return [...nearest(mappedGardens.value, place.value, Infinity).map(({ item, km }) => ({ g: item, km })), ...unmapped];
    }
    return [...mappedGardens.value.slice().sort(byName).map(g => ({ g, km: null })), ...unmapped];
});

async function onSearch() {
    const q = query.value.trim();
    if (!q) return;
    pending?.abort();
    const controller = (pending = new AbortController());
    searching.value = true;
    searchStatus.value = 'Searching…';
    try {
        const hit = await geocode(q, searchArea(mappedGardens.value), controller.signal);
        if (controller.signal.aborted) return;
        place.value = hit;
        searchStatus.value = hit ? `Nearest to ${hit.label}` : `We couldn't find "${q}". Try a street address, city or ZIP code.`;
    } catch (e) {
        if (controller.signal.aborted) return;
        place.value = null;
        searchStatus.value = 'Search is unavailable right now. Please try again in a moment.';
    } finally {
        if (pending === controller) searching.value = false;
    }
}

/** The search chip's short place name: "98104, Seattle" rather than the geocoder's full address. */
const placeShort = computed(() => (place.value?.label || '').split(',').slice(0, 2).join(',').trim());

function clearSearch() {
    pending?.abort();
    query.value = '';
    place.value = null;
    searchStatus.value = '';
    searching.value = false;
}

watch([query, searchStatus, place], ([q, status, p]) => Object.assign(lastSearch, { query: q, status, place: p }));

// ── Map ──
const mapEl = ref(null);
const leaving = ref(false); // the map is flying in to a garden
const hot = ref(null); // slug of the garden a card is pointing at
let map = null;
let placeMarker = null;
let markerEls = new Map();
let gardenLayers = new Map(); // slug → { layer, g, i }
let flyTimer = 0;

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Swoops the map down onto the garden and fades to sky before the island takes over. */
function openGarden(s) {
    if (leaving.value) return;
    const g = mappedGardens.value.find(x => x.slug === s);
    const go = () => router.push({ name: 'explore-garden', params: { slug: s } });
    if (!map || !g || reducedMotion()) return go();
    leaving.value = true;
    map.flyTo([g.lat, g.lng], Math.max(map.getZoom(), 17), { duration: FLY_MS / 1000 });
    flyTimer = window.setTimeout(go, FLY_MS);
}

function createMap() {
    destroyMap();
    if (!mapEl.value) return;
    leaving.value = false;
    map = L.map(mapEl.value, { zoomControl: false, scrollWheelZoom: true });
    // Bottom right, lined up with the garden cards (CSS lifts it above the strip).
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    markerEls = new Map();
    gardenLayers = new Map();
    mappedGardens.value.forEach((g, i) => {
        if (user.value) {
            const marker = L.marker([g.lat, g.lng], { title: g.title, riseOnHover: true, icon: isleIcon(g, i) });
            marker.on('add', () => {
                markerEls.set(g.slug, marker.getElement());
                describeGarden(g);
            });
            marker.on('click', () => openGarden(g.slug));
            marker.addTo(map);
            gardenLayers.set(g.slug, { layer: marker, g, i });
        } else {
            // Signed-out visitors see the same approximate area as the garden page.
            const circle = L.circle([g.lat, g.lng], {
                radius: APPROX_AREA_RADIUS_M,
                className: 'explore-area',
                color: '#2f6b58',
                weight: 2,
                fillColor: '#93c26b',
                fillOpacity: 0.3
            });
            circle.bindTooltip('', { permanent: true, direction: 'center', className: 'explore-area-label' });
            circle.on('click', () => openGarden(g.slug));
            circle.on('add', () => {
                markerEls.set(g.slug, circle.getElement());
                describeGarden(g);
            });
            circle.addTo(map);
            gardenLayers.set(g.slug, { layer: circle, g, i });
        }
    });

    // Circles can't report bounds before the map has a view, so frame from the coordinates.
    const radius = user.value ? 0 : APPROX_AREA_RADIUS_M;
    const bounds = mappedGardens.value.reduce(
        (b, g) => b.extend(L.latLng(g.lat, g.lng).toBounds(radius * 2)),
        L.latLngBounds([])
    );
    if (mappedGardens.value.length) map.fitBounds(bounds, framePadding());
    else map.setView([37.8019, -122.2418], 12);

    showPlace();
}

/** Island marker: the island, its name, and a yellow dot while volunteers are needed. Numbers live on the card and the island. */
function isleIcon(g, i) {
    const help = activityOf(g.slug).openSpots ? '<span class="explore-isle__dot" aria-hidden="true"></span>' : '';
    return L.divIcon({
        className: 'explore-isle',
        // Stagger the bob so neighbouring islands don't move in lockstep.
        html: `<span class="explore-isle__float" style="animation-delay:${-(i * 0.7) % 4}s">${ISLE_SVG}${help}</span><span class="explore-isle__label">${escapeHtml(g.title)}</span>`,
        iconSize: [52, 48],
        iconAnchor: [26, 40]
    });
}

/** Screen-reader label (pins) or visible label (signed-out circles), with plants and volunteer needs. */
function describeGarden(g) {
    const entry = gardenLayers.get(g.slug);
    if (!entry) return;
    const help = volunteerText(g.slug);
    if (entry.layer instanceof L.Marker) {
        entry.layer.getElement()?.setAttribute('aria-label', [g.title, plantCount(g), hostLine(g), help].filter(Boolean).join(', '));
    } else {
        entry.layer.setTooltipContent(
            `${escapeHtml(g.title)}${help ? `<br><span class="explore-area-label__help">${escapeHtml(help)}</span>` : ''}`
        );
    }
}

watch(hostsBySlug, () => {
    for (const { g } of gardenLayers.values()) describeGarden(g);
});

// Events and tasks arrive after the map is drawn; refresh badges in place so the view doesn't jump.
watch(activity, () => {
    for (const { layer, g, i } of gardenLayers.values()) {
        if (layer instanceof L.Marker) {
            layer.setIcon(isleIcon(g, i));
            markerEls.set(g.slug, layer.getElement());
            if (hot.value === g.slug) layer.getElement()?.classList.add('is-hot');
        }
        describeGarden(g);
    }
});

/** Keeps framed points clear of the search card (top left) and the garden strip (bottom). */
function framePadding() {
    const phone = (mapEl.value?.clientWidth ?? 1000) <= 640;
    return phone
        ? { paddingTopLeft: [32, 120], paddingBottomRight: [32, 140], maxZoom: 16 }
        : { paddingTopLeft: [80, 120], paddingBottomRight: [96, 150], maxZoom: 16 };
}

function showPlace() {
    if (!map) return;
    placeMarker?.remove();
    placeMarker = null;
    if (!place.value) return;
    const p = place.value;
    placeMarker = L.marker([p.lat, p.lng], {
        title: p.label,
        alt: `Searched place: ${p.label}`,
        keyboard: false,
        zIndexOffset: -100,
        icon: L.divIcon({ className: 'explore-place-pin', iconSize: [18, 18], iconAnchor: [9, 9] })
    }).addTo(map);
    const points = [[p.lat, p.lng], ...cards.value.filter(({ g }) => g.onMap).slice(0, 5).map(({ g }) => [g.lat, g.lng])];
    map.fitBounds(L.latLngBounds(points), { ...framePadding(), maxZoom: 15 });
}

function destroyMap() {
    window.clearTimeout(flyTimer);
    map?.remove();
    map = null;
    placeMarker = null;
    markerEls = new Map();
    gardenLayers = new Map();
}

watch(place, showPlace);
watch(hot, (next, prev) => {
    markerEls.get(prev)?.classList.remove('is-hot');
    markerEls.get(next)?.classList.add('is-hot');
});

// ── Schematic ──
const sheetEl = ref(null);
const selected = ref(null); // index into schematicBeds
const panelCloseBtn = ref(null);
let returnFocus = null;

// ── Plots ──
// A garden's managers lay out its plots (GET/PUT /api/gardens/:slug/plots).
// Until they do, the schematic shows the plants logged nearby instead.
const savedPlots = ref({}); // slug → { plots, schematic } (plots [] when none); absent until loaded
const editingPlots = ref(false);

async function loadPlots(gardenSlug) {
    // A failure (or a backend without plots yet) reads as "no saved layout": the schematic shows logged plants.
    const res = await fetchWrapper.get(`${import.meta.env.VITE_API_URL}/api/gardens/${gardenSlug}/plots`).catch(() => null);
    const plots = res?.data?.meta?.saved ? res.data.plots || [] : [];
    selected.value = null;
    savedPlots.value = { ...savedPlots.value, [gardenSlug]: { plots, schematic: res?.data?.schematic ?? null } };
}

watch(slug, (s) => {
    editingPlots.value = false;
    if (s && !(s in savedPlots.value)) loadPlots(s);
}, { immediate: true });

const plotsReady = computed(() => !!current.value && current.value.slug in savedPlots.value);
const plotsSaved = computed(() => !!savedPlots.value[current.value?.slug]?.plots?.length);

/** What the schematic draws and the sheet lists: [{ key, label, plant (or null), piece, count }]. */
const schematicBeds = computed(() => {
    if (!current.value) return [];
    if (plotsSaved.value) {
        return savedPlots.value[current.value.slug].plots.map((p, i) => ({ key: `plot-${i}`, label: p.label, plant: p.plant, piece: p.piece ?? 0, count: 1 }));
    }
    return current.value.plants.map(p => ({ key: p.key, label: null, plant: p.plant, piece: 0, count: p.count }));
});

// Accepts the editor's current array payload or the { plots, schematic } shape (Task 6 drops the array branch).
function onPlotsSaved(payload) {
    const slugNow = current.value.slug;
    const next = Array.isArray(payload)
        ? { plots: payload, schematic: savedPlots.value[slugNow]?.schematic ?? null }
        : payload;
    savedPlots.value = { ...savedPlots.value, [slugNow]: next };
    selected.value = null;
    editingPlots.value = false;
}

const selectedPlant = computed(() => selected.value === null ? null : schematicBeds.value[selected.value]?.plant ?? null);

function onKey(e) {
    if (e.key === 'Escape' && selected.value !== null) closePanel(true);
}

async function openPanel(i, opener) {
    if (selected.value === null) returnFocus = opener ?? document.activeElement;
    selected.value = i;
    await nextTick();
    // preventScroll: the panel is still sliding in, off the edge of the stage.
    panelCloseBtn.value?.focus({ preventScroll: true });
}

// Call sites may still pass a legacy flag; `selected` is the single source of truth now, so it is always cleared.
function closePanel() {
    if (selected.value === null) return;
    selected.value = null;
    returnFocus?.focus?.();
    returnFocus = null;
}

// ── Workdays and tasks on the schematic sheet ──
const gardenEvents = computed(() => current.value ? activityOf(current.value.slug).events : []);
// The next workday that's still on gets the big card and RSVP; canceled ones list under it, tagged.
const nextEvent = computed(() => gardenEvents.value.find(e => !e.canceled) || null);
const laterEvents = computed(() => gardenEvents.value.filter(e => e !== nextEvent.value).slice(0, 3));
// ── Managers edit workdays and tasks right on the sheet ──
// Same rule as the manage page: you manage a garden if you're one of its managers.
const isManager = computed(() => !!(user.value && current.value?.managerIds.includes(user.value.id)));
const editing = ref(null); // { kind: 'event' | 'task', item: the row being edited, or null for a new one }

const editEvent = (item = null) => {
    editing.value = { kind: 'event', item };
    openSection('workdays');
};
const editTask = (item = null) => {
    editing.value = { kind: 'task', item };
    openSection('tasks');
};
const editPlots = () => {
    selected.value = null;
    editingPlots.value = true;
    openSection('plots');
};
const isEditing = (kind, item) => editing.value?.kind === kind && editing.value.item?.id === item?.id;

async function onSaved() {
    editing.value = null;
    await Promise.all([loadEvents(), loadTasks(), current.value && isManager.value ? loadRepeats(current.value.slug) : null]);
}

// Repeating tasks (templates the daily cron turns into that day's task), for the
// garden's managers. Read the draft rows: every template has one, published or not.
const repeatsBySlug = ref({});
async function loadRepeats(gardenSlug) {
    const params = new URLSearchParams();
    params.set('filters[garden][slug][$eq]', gardenSlug);
    params.set('status', 'draft');
    ['title', 'type', 'max_volunteers', 'repeat_frequency', 'repeat_days', 'repeat_start'].forEach((f, i) => params.set(`fields[${i}]`, f));
    params.set('sort[0]', 'title:asc');
    params.set('pagination[pageSize]', '50');
    const res = await fetchWrapper.get(`${import.meta.env.VITE_API_URL}/api/recurring-tasks?${params}`).catch(() => null);
    repeatsBySlug.value = { ...repeatsBySlug.value, [gardenSlug]: Array.isArray(res?.data) ? res.data : [] };
}
const gardenRepeats = computed(() => (current.value && repeatsBySlug.value[current.value.slug]) || []);
watch([isManager, () => current.value?.slug], ([manager, s]) => {
    if (manager && s && !(s in repeatsBySlug.value)) loadRepeats(s);
}, { immediate: true });

// Managers also see tasks the public can't (no status yet), so they can fix them.
const gardenTasks = computed(() => {
    if (!current.value) return [];
    if (!isManager.value) return activityOf(current.value.slug).tasks;
    return allTasks.value.filter(t => t.garden.slug === current.value.slug);
});
const taskStatusTag = (t) => ({ IN_PROGRESS: 'In progress' })[String(t.task_status).toUpperCase()]
    || (ACTIVE_TASK(t) ? '' : 'Hidden — no status');

// Tasks open in place on the sheet: details plus a phone sign-up, no page change.
const openTaskId = ref(null);
// Give the server a moment to record the sign-up before refreshing counts, as the task page does.
const onSignedUp = () => window.setTimeout(loadTasks, 500);

// ── Sheet sections: Workdays, Volunteer, Plots, each collapsible ──
// The first one with something in it starts open; after that the visitor's toggles win.
const sectionOverrides = ref({}); // section id → open?
const sheetSections = computed(() => {
    const list = [];
    if (gardenEvents.value.length || isManager.value) list.push({ id: 'workdays', count: gardenEvents.value.length });
    if (gardenTasks.value.length || isManager.value) list.push({ id: 'tasks', count: gardenTasks.value.length });
    list.push({ id: 'plots', count: schematicBeds.value.length });
    return list;
});
const hasSection = (id) => sheetSections.value.some(s => s.id === id);
const sectionCount = (id) => sheetSections.value.find(s => s.id === id)?.count ?? 0;
const defaultSection = computed(() => (sheetSections.value.find(s => s.count > 0) || sheetSections.value.at(-1)).id);
const isOpen = (id) => (id in sectionOverrides.value ? sectionOverrides.value[id] : id === defaultSection.value);
const toggleSection = (id) => { sectionOverrides.value = { ...sectionOverrides.value, [id]: !isOpen(id) }; };
function openSection(id) {
    sectionOverrides.value = { ...sectionOverrides.value, [id]: true };
}

watch(slug, () => {
    editing.value = null;
    openTaskId.value = null;
    sectionOverrides.value = {};
});

// Same flow as the garden page: signed-in people RSVP directly, everyone else gives a phone number.
const showRsvpModal = ref(false);
const rsvpedIds = ref(new Set());
const rsvpBusy = ref(false);
const nextEventRsvped = computed(() => !!nextEvent.value && rsvpedIds.value.has(nextEvent.value.id));
const markRsvped = (id) => { rsvpedIds.value = new Set(rsvpedIds.value).add(id); };

async function rsvpNextEvent() {
    if (!nextEvent.value || nextEventRsvped.value || rsvpBusy.value) return;
    if (!user.value) {
        showRsvpModal.value = true;
        return;
    }
    rsvpBusy.value = true;
    const id = nextEvent.value.id;
    // On failure the store's error handler already raises an alert.
    await eventStore.rsvpEvent({ userId: user.value.id, id }).then(() => markRsvped(id), () => null);
    rsvpBusy.value = false;
}

function pickPlant(i, e) {
    openPanel(i, e?.currentTarget);
}

// ── Lifecycle ──
const mode = computed(() => {
    if (loading.value) return 'loading';
    if (!slug.value) return 'map';
    return current.value ? 'garden' : 'missing';
});

watch([mode, slug, user], async () => {
    await nextTick();
    selected.value = null;
    if (mode.value === 'map') {
        createMap();
    } else {
        destroyMap();
    }
}, { flush: 'post' });

onMounted(() => {
    measureFrame();
    window.addEventListener('resize', measureFrame);
    document.addEventListener('keydown', onKey);
    loadGardens();
    loadTrackings();
    loadEvents();
    loadTasks();
});

onBeforeUnmount(() => {
    window.removeEventListener('resize', measureFrame);
    document.removeEventListener('keydown', onKey);
    pending?.abort();
    destroyMap();
});
</script>

<script>
// Survives the component being torn down between /explore and /explore/:slug.
const lastSearch = { query: '', status: '', place: null };
</script>

<template>
    <div ref="rootEl" class="explore" :style="frame">
        <div v-if="mode === 'loading'" class="explore-center">
            <LoadingSpinner />
        </div>

        <div v-else-if="gardens?.error" class="explore-center">
            <p>We couldn't load the gardens. Please try again in a moment.</p>
        </div>

        <template v-else-if="mode === 'map'">
            <div ref="mapEl" class="explore-map"></div>
            <div class="explore-vignette" aria-hidden="true"></div>
            <div class="explore-sky" :class="{ 'is-on': leaving }" aria-hidden="true"></div>

            <h1 class="explore-sr">Explore gardens</h1>
            <div class="explore-hud" :class="{ 'is-away': leaving }">
                <form class="explore-search" role="search" @submit.prevent="onSearch">
                    <svg class="explore-search__mark" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 19C5 11 10 6 19 5c-1 9-6 14-14 14Zm0 0 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    <input
                        v-model="query"
                        type="search"
                        name="q"
                        placeholder="Find a garden near…"
                        required
                        autocomplete="street-address"
                        enterkeyhint="search"
                        aria-label="Find gardens near an address or ZIP code"
                    />
                    <button type="submit" :disabled="searching">{{ searching ? 'Searching…' : 'Search' }}</button>
                </form>
                <p v-if="searchStatus && !searching" class="explore-chip" :class="{ 'is-error': !place }" role="status" :title="searchStatus">
                    <span>{{ place ? `Near ${placeShort}` : searchStatus }}</span>
                    <button type="button" aria-label="Clear search" @click="clearSearch">×</button>
                </p>
            </div>

            <nav class="explore-strip" :class="{ 'is-away': leaving }" aria-label="Gardens">
                <button
                    v-for="({ g, km }, i) in cards"
                    :key="g.slug"
                    type="button"
                    class="explore-card"
                    :class="{ 'is-hot': hot === g.slug }"
                    :style="{ animationDelay: `${i * 50}ms` }"
                    @mouseenter="hot = g.slug"
                    @mouseleave="hot = null"
                    @focus="hot = g.slug"
                    @blur="hot = null"
                    @click="openGarden(g.slug)"
                >
                    <span class="explore-card__isle" v-html="ISLE_SVG"></span>
                    <span class="explore-card__text">
                        <span class="explore-card__name">{{ g.title }}</span>
                        <span class="explore-card__status" :class="{ 'needs-help': cardStatus(g, km).help }">{{ cardStatus(g, km).text }}</span>
                    </span>
                </button>
                <p v-if="!cards.length" class="explore-strip__empty">No gardens yet.</p>
            </nav>
        </template>

        <div v-else-if="mode === 'missing'" class="explore-center">
            <p>We couldn't find that garden.</p>
            <router-link to="/explore" class="explore-link">Back to the map</router-link>
        </div>

        <template v-else-if="mode === 'garden'">
            <div class="explore-stage">
                <Schematic
                    :pieces="current.footprintShape?.pieces"
                    :beds="schematicBeds"
                    :options="savedPlots[current.slug]?.schematic"
                    :selected="selected"
                    :seed="current.slug"
                    @select="openPanel"
                    @deselect="closePanel(false)"
                />
            </div>

            <section ref="sheetEl" class="explore-sheet" aria-labelledby="explore-garden-title">
                <header class="explore-sheet__header">
                    <router-link to="/explore" class="explore-sheet__back">← Map</router-link>
                    <h2 id="explore-garden-title">{{ current.title }}</h2>
                    <p v-if="current.blurb" class="explore-sheet__blurb">{{ current.blurb }}</p>
                    <div v-if="hostsOf(current.slug).length" class="explore-hosts">
                        <span class="explore-hosts__faces">
                            <span
                                v-for="h in hostsOf(current.slug).slice(0, 4)"
                                :key="h.id"
                                class="explore-hosts__face"
                                :style="avatarStyle(h)"
                                :title="hostName(h)"
                                aria-hidden="true"
                            >{{ initials(h) }}</span>
                        </span>
                        <span>{{ hostLine(current) }}</span>
                    </div>
                    <p v-else-if="current.managerIds.length" class="explore-hosts">
                        Looked after by {{ plural(current.managerIds.length, 'garden manager') }}
                    </p>
                </header>

                <div class="explore-sheet__body">
                    <section v-if="hasSection('workdays')" class="explore-section">
                        <div class="explore-section__head">
                            <button
                                type="button"
                                class="explore-section__toggle"
                                :aria-expanded="isOpen('workdays')"
                                aria-controls="ex-sec-workdays"
                                @click="toggleSection('workdays')"
                            >
                                <span class="explore-section__chev" aria-hidden="true"></span>
                                <span>Workdays</span>
                                <span class="explore-section__count">{{ sectionCount('workdays') }}</span>
                            </button>
                            <button
                                v-if="isManager && !(editing?.kind === 'event' && !editing.item)"
                                type="button"
                                class="explore-sheet__add"
                                @click="editEvent()"
                            >+ Add</button>
                        </div>
                        <div v-show="isOpen('workdays')" id="ex-sec-workdays" class="explore-section__body">
                            <ExploreEventForm
                                v-if="editing?.kind === 'event' && !editing.item"
                                :garden-id="current.id"
                                @saved="onSaved"
                                @cancel="editing = null"
                            />
                            <p v-if="isManager && !gardenEvents.length && !editing" class="explore-sheet__empty">No upcoming workdays yet.</p>
                            <ExploreEventForm
                                v-if="nextEvent && isEditing('event', nextEvent)"
                                :key="`edit-event-${nextEvent.id}`"
                                :garden-id="current.id"
                                :event="nextEvent"
                                @saved="onSaved"
                                @cancel="editing = null"
                            />
                            <div v-else-if="nextEvent" class="explore-event">
                                <button v-if="isManager" type="button" class="explore-edit explore-event__edit" :aria-label="`Edit ${nextEvent.title}`" @click="editEvent(nextEvent)">Edit</button>
                                <router-link :to="`/d/${nextEvent.id}`" class="explore-event__link">
                                    <span class="explore-event__when">{{ formatDay(nextEvent.startDatetime) }} · {{ formatTime(nextEvent.startDatetime) }}<template v-if="nextEvent.endText">–{{ nextEvent.endText }}</template></span>
                                    <span class="explore-event__title">{{ nextEvent.title }}</span>
                                </router-link>
                                <button
                                    type="button"
                                    class="explore-event__rsvp"
                                    :class="{ 'is-going': nextEventRsvped }"
                                    :disabled="nextEventRsvped || rsvpBusy"
                                    @click="rsvpNextEvent"
                                >{{ nextEventRsvped ? "You're going" : "I'm going" }}</button>
                            </div>
                            <ul v-if="laterEvents.length" class="explore-rows">
                                <li v-for="e in laterEvents" :key="e.id">
                                    <ExploreEventForm
                                        v-if="isEditing('event', e)"
                                        :garden-id="current.id"
                                        :event="e"
                                        @saved="onSaved"
                                        @cancel="editing = null"
                                    />
                                    <div v-else class="explore-rows__item">
                                        <router-link :to="`/d/${e.id}`">
                                            <span>{{ e.title }}</span>
                                            <span class="explore-rows__meta">
                                                <span v-if="e.canceled" class="explore-tag">Canceled</span>{{ formatDay(e.startDatetime) }}
                                            </span>
                                        </router-link>
                                        <button v-if="isManager" type="button" class="explore-edit" :aria-label="`Edit ${e.title}`" @click="editEvent(e)">Edit</button>
                                    </div>
                                </li>
                            </ul>
                        </div>
                    </section>

                    <section v-if="hasSection('tasks')" class="explore-section">
                        <div class="explore-section__head">
                            <button
                                type="button"
                                class="explore-section__toggle"
                                :aria-expanded="isOpen('tasks')"
                                aria-controls="ex-sec-tasks"
                                @click="toggleSection('tasks')"
                            >
                                <span class="explore-section__chev" aria-hidden="true"></span>
                                <span>{{ isManager ? 'Tasks' : 'Volunteer' }}</span>
                                <span class="explore-section__count">{{ sectionCount('tasks') }}</span>
                            </button>
                            <button
                                v-if="isManager && !(editing?.kind === 'task' && !editing.item)"
                                type="button"
                                class="explore-sheet__add"
                                @click="editTask()"
                            >+ Add</button>
                        </div>
                        <div v-show="isOpen('tasks')" id="ex-sec-tasks" class="explore-section__body">
                            <ExploreTaskForm
                                v-if="editing?.kind === 'task' && !editing.item"
                                :garden-id="current.id"
                                :garden-slug="current.slug"
                                @saved="onSaved"
                                @cancel="editing = null"
                            />
                            <div v-if="isManager && gardenRepeats.length" class="explore-repeats">
                                <p class="explore-repeats__label">Repeats</p>
                                <ul class="explore-rows">
                                    <li v-for="r in gardenRepeats" :key="r.documentId ?? r.id" class="explore-repeats__row">
                                        <span>{{ r.title }}</span>
                                        <span class="explore-rows__meta">
                                            {{ repeatSummary(r) }} · {{ plural(r.max_volunteers || 1, 'volunteer') }}
                                        </span>
                                    </li>
                                </ul>
                            </div>
                            <p v-if="isManager && !gardenTasks.length && !editing" class="explore-sheet__empty">No open tasks today.</p>
                            <ul v-if="gardenTasks.length" class="explore-rows">
                                <li v-for="t in (isManager ? gardenTasks : gardenTasks.slice(0, 5))" :key="t.id">
                                    <ExploreTaskForm
                                        v-if="isEditing('task', t)"
                                        :garden-id="current.id"
                                        :garden-slug="current.slug"
                                        :task="t"
                                        @saved="onSaved"
                                        @cancel="editing = null"
                                    />
                                    <ExploreTaskRow
                                        v-else
                                        :task="t"
                                        :garden-slug="current.slug"
                                        :can-edit="isManager"
                                        :status-tag="isManager ? taskStatusTag(t) : ''"
                                        :open="openTaskId === t.id"
                                        @toggle="openTaskId = openTaskId === t.id ? null : t.id"
                                        @edit="editTask(t)"
                                        @signed-up="onSignedUp"
                                    />
                                </li>
                            </ul>
                            <router-link
                                v-if="!isManager && gardenTasks.length > 5"
                                :to="{ name: 'garden-tasks-public', params: { slug: current.slug } }"
                                class="explore-link explore-sheet__more"
                            >All {{ gardenTasks.length }} tasks →</router-link>
                        </div>
                    </section>

                    <section class="explore-section">
                        <div class="explore-section__head">
                            <button
                                type="button"
                                class="explore-section__toggle"
                                :aria-expanded="isOpen('plots')"
                                aria-controls="ex-sec-plots"
                                @click="toggleSection('plots')"
                            >
                                <span class="explore-section__chev" aria-hidden="true"></span>
                                <span>{{ plotsSaved ? 'Plots' : 'Growing here' }}</span>
                                <span class="explore-section__count">{{ sectionCount('plots') }}</span>
                            </button>
                            <button
                                v-if="isManager && plotsReady && !editingPlots"
                                type="button"
                                class="explore-sheet__add"
                                @click="editPlots"
                            >{{ plotsSaved ? 'Edit' : '+ Lay out' }}</button>
                        </div>
                        <div v-show="isOpen('plots')" id="ex-sec-plots" class="explore-section__body">
                            <ExplorePlotEditor
                                v-if="editingPlots"
                                :garden-slug="current.slug"
                                :plots="plotsSaved ? schematicBeds : []"
                                :suggestions="current.plants.map(p => p.plant)"
                                @saved="onPlotsSaved"
                                @cancel="editingPlots = false"
                            />
                            <template v-else>
                                <p v-if="!schematicBeds.length" class="explore-sheet__empty">
                                    No plants have been logged near this garden yet.
                                </p>
                                <ul v-else class="explore-sheet__plants">
                                    <li v-for="(p, i) in schematicBeds" :key="p.key">
                                        <button
                                            type="button"
                                            :class="{ 'is-selected': selected === i }"
                                            :disabled="!p.plant"
                                            @click="pickPlant(i, $event)"
                                        >
                                            <span>
                                                <span v-if="p.label" class="explore-sheet__plot">{{ p.label }}</span>
                                                {{ p.plant ? p.plant.title : 'Empty bed' }}
                                            </span>
                                            <span v-if="p.count > 1" class="explore-sheet__count">×{{ p.count }}</span>
                                        </button>
                                    </li>
                                </ul>
                                <p v-if="trackingsError && !plotsSaved" class="explore-sheet__empty">Some plants couldn't be loaded.</p>
                            </template>
                        </div>
                    </section>

                    <footer class="explore-sheet__footer">
                        <p class="explore-sheet__hint">Drag to pan · scroll or pinch to zoom · tap a bed</p>
                        <router-link :to="{ name: 'garden-public', params: { slug: current.slug } }" class="explore-link">
                            Visit the garden page →
                        </router-link>
                    </footer>
                </div>
            </section>

            <aside
                class="explore-panel"
                :class="{ 'is-open': selectedPlant }"
                role="dialog"
                aria-labelledby="explore-plant-title"
                :inert="!selectedPlant || undefined"
            >
                <template v-if="selectedPlant">
                    <button ref="panelCloseBtn" type="button" class="explore-panel__close" aria-label="Close plant details" @click="closePanel(true)">×</button>
                    <img v-if="plantImage(selectedPlant)" :src="plantImage(selectedPlant)" :alt="`Photo of ${selectedPlant.title}`" class="explore-panel__photo" />
                    <div class="explore-panel__body">
                        <h2 id="explore-plant-title">{{ selectedPlant.title }}</h2>
                        <p v-if="selectedPlant.latin" class="explore-panel__latin">{{ selectedPlant.latin }}</p>
                        <dl class="explore-panel__facts">
                            <template v-if="selectedPlant.type"><dt>Type</dt><dd>{{ TYPE_LABELS[selectedPlant.type] || selectedPlant.type }}</dd></template>
                            <template v-if="selectedPlant.sun_detail"><dt>Sun</dt><dd>{{ selectedPlant.sun_detail }}</dd></template>
                            <template v-if="selectedPlant.water_detail"><dt>Water</dt><dd>{{ selectedPlant.water_detail }}</dd></template>
                        </dl>
                        <router-link v-if="selectedPlant.slug" :to="`/plants/${selectedPlant.slug}`" class="explore-link">
                            More about this plant →
                        </router-link>
                    </div>
                </template>
            </aside>
        </template>

        <RsvpPhoneModal
            v-model="showRsvpModal"
            :event-id="nextEvent?.id"
            :garden-title="current?.title"
            @rsvped="markRsvped"
        />
    </div>
</template>

<style scoped>
/*
 * One visual system for every surface on Explore:
 *  - solid surfaces with a soft shadow (no frosted blur)
 *  - spacing on an 8-pt grid, 16px gutters from the screen edge
 *  - radius 12 for controls, 16 for surfaces
 *  - type at 13 (meta) / 15 (body) / 20 (title), weights 500 and 700
 *  - colour has two jobs only: green acts, yellow means "volunteers needed"
 *  - hover/selection lifts and gets a green ring (focus uses the same ring)
 */
.explore {
    --ex-surface: #fbfcf8;
    --ex-sunken: #f1f4ec;
    --ex-fg: #1c2318;
    --ex-muted: #5a6553;
    --ex-line: rgb(28 35 24 / 0.12);
    --ex-accent: #2f6b58;
    --ex-on-accent: #fbfcf8;
    --ex-help: #f5b700;
    --ex-help-soft: rgb(245 183 0 / 0.22);
    --ex-ring: #2f6b58;
    --ex-pick: var(--ex-ring); /* focus colour used by the Explore forms */
    --ex-shadow: 0 1px 2px rgb(28 35 24 / 0.08), 0 8px 24px rgb(28 35 24 / 0.14);
    --ex-shadow-lift: 0 2px 4px rgb(28 35 24 / 0.1), 0 14px 32px rgb(28 35 24 / 0.2);
    --ex-sky: #cfe3ec;
    --ex-gutter: 16px;
    --ex-r-control: 12px;
    --ex-r-surface: 16px;
    --ex-t-meta: 13px;
    --ex-t-body: 15px;
    --ex-t-title: 20px;
    /* Full bleed: escape the app container sideways and up to the nav. */
    position: relative;
    left: var(--ex-left, 0);
    width: var(--ex-width, 100%);
    margin-top: calc(-1 * var(--ex-pull, 0px));
    margin-bottom: calc(-1 * var(--ex-pull-bottom, 0px));
    height: calc(100dvh - var(--ex-nav, 60px));
    min-height: 520px;
    overflow: hidden;
    background: var(--ex-sky);
    color: var(--ex-fg);
    font-size: var(--ex-t-body);
    isolation: isolate;
}
:root.dark .explore {
    --ex-surface: #1b2418;
    --ex-sunken: #151c13;
    --ex-fg: #e4eadc;
    --ex-muted: #a3ae99;
    --ex-line: rgb(228 234 220 / 0.12);
    --ex-accent: #82c7ad;
    --ex-on-accent: #10140e;
    --ex-help: #ffcf3f;
    --ex-help-soft: rgb(255 207 63 / 0.2);
    --ex-ring: #82c7ad;
    --ex-shadow: 0 1px 2px rgb(0 0 0 / 0.3), 0 8px 24px rgb(0 0 0 / 0.4);
    --ex-shadow-lift: 0 2px 4px rgb(0 0 0 / 0.35), 0 14px 32px rgb(0 0 0 / 0.5);
}

.explore-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
}

.explore-map,
.explore-stage {
    position: absolute;
    inset: 0;
}
/* Dark mode turns the street map into a night map. Filtering each tile (not the
   whole pane) keeps it cheap: tiles are static, so the browser filters them once. */
:root.dark .explore-map :deep(.leaflet-tile) {
    filter: invert(0.92) hue-rotate(180deg) saturate(0.5) brightness(0.9);
}
:root.dark .explore-map {
    background: #1a2117;
}
/* A light tint pulls the map toward the garden palette, with softly darker edges. */
.explore-vignette {
    position: absolute;
    inset: 0;
    z-index: 400; /* over tiles, under Leaflet markers */
    pointer-events: none;
    background:
        radial-gradient(ellipse at 50% 45%, transparent 55%, rgb(28 50 30 / 0.15) 100%),
        linear-gradient(to bottom, rgb(28 50 30 / 0.05), transparent 18%, transparent 72%, rgb(28 50 30 / 0.12)),
        rgb(147 194 107 / 0.06);
}
:root.dark .explore-vignette {
    background:
        radial-gradient(ellipse at 50% 45%, transparent 55%, rgb(0 0 0 / 0.25) 100%),
        rgb(40 70 40 / 0.09);
}
.explore-sky {
    position: absolute;
    inset: 0;
    z-index: 1100;
    pointer-events: none;
    background: var(--ex-sky);
    opacity: 0;
    transition: opacity 420ms ease 480ms; /* fade to sky as the fly-in lands */
}
.explore-sky.is-on {
    opacity: 1;
}

.explore-center {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 16px;
    height: 100%;
    padding: 24px;
    text-align: center;
    color: #1c2318;
}
.explore-link {
    color: var(--ex-accent);
    font-size: var(--ex-t-meta);
    font-weight: 700;
    text-decoration: none;
}
.explore-link:hover {
    text-decoration: underline;
}

/* ── Map: search bar (top left) ── */
.explore-hud {
    position: absolute;
    top: var(--ex-gutter);
    left: var(--ex-gutter);
    z-index: 1000; /* above Leaflet panes and controls */
    display: grid;
    justify-items: start;
    gap: 8px;
    width: min(400px, calc(100% - 2 * var(--ex-gutter)));
    animation: ex-rise 480ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    transition: opacity 300ms ease, transform 300ms ease;
}
.explore-search {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    padding: 6px 6px 6px 16px;
    border-radius: 999px;
    background: var(--ex-surface);
    box-shadow: var(--ex-shadow);
}
.explore-search__mark {
    flex: none;
    width: 20px;
    height: 20px;
    color: var(--ex-accent);
}
.explore-search input {
    flex: 1;
    min-width: 0;
    padding: 8px 0;
    border: 0;
    background: transparent;
    color: var(--ex-fg);
    font: inherit;
    font-size: var(--ex-t-body);
}
.explore-search input::placeholder {
    color: var(--ex-muted);
}
/* The chip under the bar clears a search; the browser's own × would be a second one. */
.explore-search input::-webkit-search-cancel-button {
    display: none;
}
.explore-search input:focus {
    outline: none;
}
.explore-search:focus-within {
    box-shadow: 0 0 0 2px var(--ex-ring), var(--ex-shadow);
}
.explore-search button {
    flex: none;
    padding: 8px 16px;
    border: 0;
    border-radius: 999px;
    background: var(--ex-accent);
    color: var(--ex-on-accent);
    font-size: var(--ex-t-meta);
    font-weight: 700;
    cursor: pointer;
}
.explore-search button:disabled {
    opacity: 0.7;
    cursor: progress;
}
.explore-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    margin: 0;
    padding: 4px 4px 4px 16px;
    border-radius: 999px;
    background: var(--ex-surface);
    box-shadow: var(--ex-shadow);
    font-size: var(--ex-t-meta);
    font-weight: 500;
}
.explore-chip span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.explore-chip.is-error {
    color: var(--ex-muted);
}
.explore-chip button {
    flex: none;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 50%;
    background: var(--ex-sunken);
    color: var(--ex-muted);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
}

/* ── Map: garden cards (bottom) ── */
.explore-strip {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    display: flex;
    gap: 8px;
    padding: var(--ex-gutter) 96px calc(var(--ex-gutter) + env(safe-area-inset-bottom, 0px)) var(--ex-gutter);
    overflow-x: auto;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
    pointer-events: none; /* only the cards catch clicks; gaps go to the map */
    transition: opacity 300ms ease, transform 300ms ease;
}
.explore-strip::-webkit-scrollbar {
    display: none;
}
.explore-card {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 264px;
    padding: 8px 16px 8px 8px;
    border: 0;
    border-radius: var(--ex-r-surface);
    background: var(--ex-surface);
    color: var(--ex-fg);
    text-align: left;
    box-shadow: var(--ex-shadow);
    scroll-snap-align: start;
    cursor: pointer;
    pointer-events: auto;
    animation: ex-rise 480ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    transition: transform 180ms ease, box-shadow 180ms ease;
}
.explore-card:hover,
.explore-card.is-hot {
    transform: translateY(-4px);
    box-shadow: 0 0 0 2px var(--ex-ring), var(--ex-shadow-lift);
}
.explore-card__isle {
    flex: none;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: var(--ex-r-control);
    background: var(--ex-sunken);
}
.explore-card__isle :deep(svg) {
    width: 30px;
    height: 28px;
}
.explore-card__text {
    display: grid;
    min-width: 0;
}
.explore-card__name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--ex-t-body);
    font-weight: 700;
}
.explore-card__status {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--ex-t-meta);
    font-weight: 500;
    color: var(--ex-muted);
}
.explore-card__status.needs-help {
    color: var(--ex-fg);
}
.explore-card__status.needs-help::before {
    content: '';
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ex-help);
}
.explore-strip__empty {
    margin: 0;
    padding: 8px 16px;
    border-radius: var(--ex-r-surface);
    background: var(--ex-surface);
    box-shadow: var(--ex-shadow);
    color: var(--ex-muted);
    font-size: var(--ex-t-meta);
    pointer-events: auto;
}

.explore-hud.is-away {
    opacity: 0;
    transform: translateY(-8px);
}
.explore-strip.is-away {
    opacity: 0;
    transform: translateY(16px);
}

/* Zoom: bottom right, sitting on the card row's top edge. */
.explore-map :deep(.leaflet-bottom.leaflet-right) {
    margin-bottom: 88px;
}
.explore-map :deep(.leaflet-control-zoom) {
    margin: 0 var(--ex-gutter) 0 0;
    border: 0;
    border-radius: var(--ex-r-control);
    overflow: hidden;
    box-shadow: var(--ex-shadow);
}
.explore-map :deep(.leaflet-control-zoom a) {
    width: 40px;
    height: 40px;
    line-height: 40px;
    border: 0;
    background: var(--ex-surface);
    color: var(--ex-fg);
    font-size: 18px;
}
.explore-map :deep(.leaflet-control-zoom a + a) {
    border-top: 1px solid var(--ex-line);
}
.explore-map :deep(.leaflet-control-zoom a:hover) {
    background: var(--ex-sunken);
}
.explore-map :deep(.leaflet-control-attribution) {
    margin-right: var(--ex-gutter);
    border-radius: 8px 8px 0 0;
}

/* ── Schematic screen ── */
.explore-stage {
    background: #f6f6f0;
}

.explore-sheet {
    position: absolute;
    top: var(--ex-gutter);
    left: var(--ex-gutter);
    bottom: var(--ex-gutter);
    z-index: 4;
    display: flex;
    flex-direction: column;
    width: min(360px, calc(100% - 2 * var(--ex-gutter)));
    overflow: hidden;
    border-radius: var(--ex-r-surface);
    background: var(--ex-surface);
    color: var(--ex-fg);
    box-shadow: var(--ex-shadow);
    animation: ex-rise 560ms 200ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.explore-sheet__header {
    flex: none;
    display: grid;
    gap: 8px;
    padding: 16px 16px 16px;
    border-bottom: 1px solid var(--ex-line);
}
.explore-sheet__back {
    justify-self: start;
    margin: -4px 0 0 -8px;
    padding: 4px 8px;
    border-radius: 8px;
    color: var(--ex-muted);
    font-size: var(--ex-t-meta);
    font-weight: 700;
    text-decoration: none;
}
.explore-sheet__back:hover {
    background: var(--ex-sunken);
    color: var(--ex-fg);
}
.explore-sheet__header h2 {
    margin: 0;
    font-size: var(--ex-t-title);
    font-weight: 700;
    line-height: 1.2;
    text-wrap: balance;
}
.explore-sheet__blurb {
    margin: 0;
    font-size: var(--ex-t-meta);
    color: var(--ex-muted);
}
.explore-hosts {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: var(--ex-t-meta);
    font-weight: 500;
    color: var(--ex-muted);
}
.explore-hosts__faces {
    display: flex;
    flex: none;
}
.explore-hosts__face {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-left: -8px;
    border-radius: 50%;
    background: var(--ex-accent);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    box-shadow: 0 0 0 2px var(--ex-surface);
}
.explore-hosts__face:first-child {
    margin-left: 0;
}
.explore-sheet__body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 8px 16px;
}

/* Collapsible sections */
.explore-section + .explore-section {
    border-top: 1px solid var(--ex-line);
}
.explore-section__head {
    display: flex;
    align-items: center;
    gap: 8px;
}
.explore-section__toggle {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 8px;
    border: 0;
    border-radius: var(--ex-r-control);
    background: transparent;
    color: var(--ex-fg);
    font-size: var(--ex-t-body);
    font-weight: 700;
    text-align: left;
    cursor: pointer;
}
.explore-section__toggle:hover {
    background: var(--ex-sunken);
}
.explore-section__chev {
    width: 8px;
    height: 8px;
    border-right: 2px solid var(--ex-muted);
    border-bottom: 2px solid var(--ex-muted);
    transform: rotate(-45deg);
    transition: transform 160ms ease;
}
.explore-section__toggle[aria-expanded='true'] .explore-section__chev {
    transform: rotate(45deg) translate(-2px, -2px);
}
.explore-section__count {
    padding: 0 8px;
    border-radius: 999px;
    background: var(--ex-sunken);
    color: var(--ex-muted);
    font-size: 12px;
    font-weight: 700;
    line-height: 20px;
}
.explore-section__body {
    display: grid;
    gap: 8px;
    padding: 0 8px 16px;
}
.explore-sheet__add {
    flex: none;
    padding: 8px 12px;
    border: 0;
    border-radius: var(--ex-r-control);
    background: transparent;
    color: var(--ex-accent);
    font-size: var(--ex-t-meta);
    font-weight: 700;
    cursor: pointer;
}
.explore-sheet__add:hover,
.explore-edit:hover {
    background: var(--ex-sunken);
}
.explore-sheet__empty,
.explore-sheet__hint {
    margin: 0;
    font-size: var(--ex-t-meta);
    color: var(--ex-muted);
}
.explore-sheet__more {
    justify-self: start;
}
.explore-sheet__footer {
    display: grid;
    gap: 8px;
    margin-top: 8px;
    padding: 16px 8px 0;
    border-top: 1px solid var(--ex-line);
}

/* Plants / plots list */
.explore-sheet__plants {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
}
.explore-sheet__plants button {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 8px;
    border: 0;
    border-radius: var(--ex-r-control);
    background: transparent;
    color: var(--ex-fg);
    font-size: var(--ex-t-body);
    text-align: left;
    cursor: pointer;
}
.explore-sheet__plants button:hover {
    background: var(--ex-sunken);
}
.explore-sheet__plants button.is-selected {
    background: var(--ex-sunken);
    box-shadow: inset 0 0 0 2px var(--ex-ring);
}
.explore-sheet__plants button:disabled {
    color: var(--ex-muted);
    font-style: italic;
    cursor: default;
}
.explore-sheet__plants button:disabled:hover {
    background: transparent;
}
.explore-sheet__count {
    color: var(--ex-muted);
    font-size: var(--ex-t-meta);
}
.explore-sheet__plot {
    margin-right: 8px;
    font-size: var(--ex-t-meta);
    font-weight: 700;
    color: var(--ex-muted);
}

/* Next workday: featured card with the RSVP */
.explore-event {
    position: relative;
    display: grid;
    gap: 8px;
    padding: 16px;
    border-radius: var(--ex-r-surface);
    background: var(--ex-sunken);
}
.explore-event__link {
    display: grid;
    gap: 4px;
    color: var(--ex-fg);
    text-decoration: none;
}
.explore-event__link:hover .explore-event__title {
    text-decoration: underline;
}
.explore-event__when {
    font-size: var(--ex-t-meta);
    font-weight: 700;
    color: var(--ex-muted);
}
.explore-event__title {
    padding-right: 48px; /* clear of a manager's Edit button */
    font-size: var(--ex-t-body);
    font-weight: 700;
    line-height: 1.3;
}
.explore-event__rsvp {
    padding: 8px 16px;
    border: 2px solid var(--ex-accent);
    border-radius: var(--ex-r-control);
    background: var(--ex-accent);
    color: var(--ex-on-accent);
    font-size: var(--ex-t-body);
    font-weight: 700;
    cursor: pointer;
}
.explore-event__rsvp.is-going {
    background: transparent;
    color: var(--ex-accent);
    cursor: default;
}
.explore-event__rsvp:disabled:not(.is-going) {
    opacity: 0.7;
    cursor: progress;
}
.explore-event__edit {
    position: absolute;
    top: 8px;
    right: 8px;
}
.explore-edit {
    flex: none;
    padding: 4px 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--ex-accent);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
}

/* Managers: the garden's repeating tasks */
.explore-repeats {
    display: grid;
    gap: 4px;
    padding: 8px;
    border-radius: var(--ex-r-control);
    background: var(--ex-sunken);
}
.explore-repeats__label {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    color: var(--ex-muted);
}
.explore-repeats__row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    font-size: var(--ex-t-meta);
    font-weight: 700;
}

/* Compact rows for later workdays and tasks */
.explore-rows {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
}
/* base.css indents and bullets every `ul li`; these lists are plain rows. */
.explore-rows li,
.explore-sheet__plants li {
    margin: 0;
    padding: 0;
    list-style: none;
}
.explore-rows__item {
    display: flex;
    align-items: center;
    gap: 4px;
}
.explore-rows__item > a {
    flex: 1;
    min-width: 0;
}
.explore-rows a {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    padding: 8px;
    border-radius: var(--ex-r-control);
    color: var(--ex-fg);
    font-size: var(--ex-t-body);
    text-decoration: none;
}
.explore-rows a:hover {
    background: var(--ex-sunken);
}
.explore-rows__meta {
    flex: none;
    font-size: var(--ex-t-meta);
    color: var(--ex-muted);
}
.explore-tag {
    margin-right: 8px;
    padding: 1px 8px;
    border-radius: 6px;
    background: rgb(217 68 58 / 0.14);
    color: #b3352c;
    font-size: 12px;
    font-weight: 700;
}
:root.dark .explore-tag {
    color: #ff8a80;
}

/* Plant details */
.explore-panel {
    position: absolute;
    top: var(--ex-gutter);
    right: var(--ex-gutter);
    bottom: var(--ex-gutter);
    z-index: 6;
    width: min(360px, calc(100% - 2 * var(--ex-gutter)));
    overflow-y: auto;
    border-radius: var(--ex-r-surface);
    background: var(--ex-surface);
    color: var(--ex-fg);
    box-shadow: var(--ex-shadow);
    transform: translateX(calc(100% + 2 * var(--ex-gutter)));
    transition: transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.explore-panel.is-open {
    transform: none;
}
.explore-panel__close {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.45);
    color: #fff;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
}
.explore-panel__photo {
    display: block;
    width: 100%;
    aspect-ratio: 400 / 260;
    object-fit: contain;
    background: var(--ex-sunken);
}
.explore-panel__body {
    display: grid;
    gap: 8px;
    padding: 16px 16px 24px;
}
.explore-panel__body h2 {
    margin: 0;
    font-size: var(--ex-t-title);
    font-weight: 700;
    line-height: 1.2;
}
.explore-panel__latin {
    margin: 0;
    font-size: var(--ex-t-meta);
    font-style: italic;
    color: var(--ex-muted);
}
.explore-panel__facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 16px;
    margin: 8px 0;
    padding-top: 16px;
    border-top: 1px solid var(--ex-line);
    font-size: var(--ex-t-body);
}
.explore-panel__facts dt {
    padding-top: 2px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ex-muted);
}
.explore-panel__facts dd {
    margin: 0;
}

@media (max-width: 640px) {
    .explore {
        --ex-gutter: 8px;
    }
    .explore-strip {
        padding-right: var(--ex-gutter);
    }
    .explore-card {
        width: 240px;
    }
    /* Pinch to zoom on phones. */
    .explore-map :deep(.leaflet-control-zoom) {
        display: none;
    }
    .explore-sheet {
        top: auto;
        left: 0;
        bottom: 0;
        width: 100%;
        max-height: 50%;
        border-radius: var(--ex-r-surface) var(--ex-r-surface) 0 0;
    }
    .explore-panel {
        top: auto;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        max-height: 70%;
        border-radius: var(--ex-r-surface) var(--ex-r-surface) 0 0;
        transform: translateY(105%);
    }
}

.explore-search button:focus-visible,
.explore-chip button:focus-visible,
.explore-card:focus-visible,
.explore-sheet button:focus-visible,
.explore-sheet a:focus-visible,
.explore-panel__close:focus-visible {
    outline: 2px solid var(--ex-ring);
    outline-offset: 2px;
}

@keyframes ex-rise {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
    .explore-hud,
    .explore-card,
    .explore-sheet,
    .explore-stage {
        animation: none;
    }
    .explore-card,
    .explore-panel,
    .explore-sky,
    .explore-section__chev {
        transition: none;
    }
}
</style>

<style>
/* Leaflet builds these outside the component, so they can't be scoped. */
.explore-isle {
    position: relative;
    overflow: visible;
    cursor: pointer;
}
/* Ground shadow under the floating island; it stays put while the island bobs. */
.explore-isle::before {
    content: '';
    position: absolute;
    left: 14px;
    top: 40px;
    width: 24px;
    height: 7px;
    border-radius: 50%;
    background: rgb(28 35 24 / 0.28);
}
.explore-isle__float {
    position: relative;
    display: block;
    width: 52px;
    height: 48px;
    animation: ex-bob 4s ease-in-out infinite;
    transition: transform 180ms ease;
}
.explore-isle__float svg {
    display: block;
    width: 100%;
    height: 100%;
}
.explore-isle:hover .explore-isle__float,
.explore-isle.is-hot .explore-isle__float {
    transform: scale(1.18);
}
/* Volunteers needed: the only yellow on the map. */
.explore-isle__dot {
    position: absolute;
    top: 0;
    right: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #f5b700;
    box-shadow: 0 0 0 2px #fbfcf8;
}
.explore-isle__label {
    position: absolute;
    top: 50px;
    left: 50%;
    transform: translateX(-50%);
    padding: 2px 8px;
    border-radius: 999px;
    background: #fbfcf8;
    color: #1c2318;
    font: 700 12px/1.4 system-ui, sans-serif;
    white-space: nowrap;
    box-shadow: 0 1px 2px rgb(28 35 24 / 0.12), 0 4px 10px rgb(28 35 24 / 0.16);
    pointer-events: none;
    transition: box-shadow 180ms ease;
}
.explore-isle:hover .explore-isle__label,
.explore-isle.is-hot .explore-isle__label {
    box-shadow: 0 0 0 2px #2f6b58, 0 4px 12px rgb(28 35 24 / 0.22);
}
.explore-area {
    cursor: pointer;
    transition: fill-opacity 180ms ease, stroke-width 180ms ease;
}
.explore-area.is-hot {
    fill-opacity: 0.45;
    stroke-width: 4;
}
.leaflet-tooltip.explore-area-label {
    padding: 2px 8px;
    border: 0;
    border-radius: 999px;
    background: #fbfcf8;
    color: #1c2318;
    font: 700 12px/1.4 system-ui, sans-serif;
    text-align: center;
    box-shadow: 0 1px 2px rgb(28 35 24 / 0.12), 0 4px 10px rgb(28 35 24 / 0.16);
}
.leaflet-tooltip.explore-area-label::before {
    display: none;
}
.explore-area-label__help {
    font-weight: 500;
    font-size: 11px;
    color: #5a6553;
}
.explore-place-pin {
    border-radius: 50%;
    background: #2f6b58;
    border: 3px solid #fbfcf8;
    box-shadow: 0 0 0 6px rgb(47 107 88 / 0.22), 0 4px 12px rgb(28 35 24 / 0.3);
}
@keyframes ex-bob {
    0%, 100% { translate: 0 0; }
    50% { translate: 0 -4px; }
}
@media (prefers-reduced-motion: reduce) {
    .explore-isle__float {
        animation: none;
    }
}
</style>
