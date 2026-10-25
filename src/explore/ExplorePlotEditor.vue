<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { fetchWrapper } from '@/helpers';
import { useAlertStore } from '@/stores';

// Lay out a garden's plots from the Explore island sheet: name each bed, pick
// its plant, reorder, add and remove. Saves the whole list at once
// (PUT /api/gardens/:slug/plots), so a half-edited layout never goes live.

const MAX_PLOTS = 64; // the API's limit
const PAGE = 20; // plants shown in the dropdown at once

const props = defineProps({
    gardenSlug: { type: String, required: true },
    /** Current plots, [{ label, plant }], used to start editing. */
    plots: { type: Array, default: () => [] },
    /** Plants logged near the garden, offered as a starting layout when there are no plots yet. */
    suggestions: { type: Array, default: () => [] }
});
const emit = defineEmits(['saved', 'cancel']);

const api = import.meta.env.VITE_API_URL;
let nextKey = 0;
// `text` is what the plant box shows: the chosen plant's name, or what's being typed.
const row = (label, plant) => ({ key: nextKey++, label: label || '', plant: plant || null, text: plant?.title || '' });

const rows = ref(props.plots.map(p => row(p.label, p.plant)));
const saving = ref(false);
const error = ref('');
const plantInputs = ref({}); // row key → plant input element

// ── Plant combobox: typing in a row's plant box opens a dropdown of matches ──
const openKey = ref(null); // row whose dropdown is showing
const results = ref([]);
const total = ref(0); // matches on the server; the dropdown shows the first PAGE
const searching = ref(false);
const active = ref(-1); // highlighted option, for the arrow keys
let searchTimer = 0;
let searchController = null;

const listId = (r) => `ex-plot-plants-${r.key}`;
const optionId = (r, i) => `ex-plot-plant-${r.key}-${i}`;
const activeId = computed(() => {
    const r = rows.value.find(x => x.key === openKey.value);
    return r && active.value >= 0 ? optionId(r, active.value) : undefined;
});

/** Plants A–Z, narrowed to names (common or latin) containing `q` when given. */
async function search(q) {
    searchController?.abort();
    const controller = (searchController = new AbortController());
    searching.value = true;
    const params = new URLSearchParams();
    if (q) {
        params.set('filters[$or][0][title][$containsi]', q);
        params.set('filters[$or][1][latin][$containsi]', q);
    }
    ['documentId', 'title', 'latin', 'type', 'slug'].forEach((f, i) => params.set(`fields[${i}]`, f));
    params.set('sort[0]', 'title:asc');
    params.set('pagination[pageSize]', String(PAGE));
    try {
        const res = await fetch(`${api}/api/plants?${params}`, { signal: controller.signal });
        const json = await res.json();
        if (controller.signal.aborted) return;
        results.value = Array.isArray(json?.data) ? json.data : [];
        total.value = json?.meta?.pagination?.total ?? results.value.length;
        active.value = results.value.length ? 0 : -1;
    } catch (e) {
        if (!controller.signal.aborted) results.value = [];
    } finally {
        if (searchController === controller) searching.value = false;
    }
}

function openFor(r) {
    if (openKey.value !== r.key) {
        openKey.value = r.key;
        results.value = [];
        active.value = -1;
    }
    window.clearTimeout(searchTimer);
    // When the box still shows the chosen plant, list everything rather than just that plant.
    const q = r.plant && r.text === r.plant.title ? '' : r.text.trim();
    searchTimer = window.setTimeout(() => search(q), q ? 200 : 0);
}

function close() {
    openKey.value = null;
    window.clearTimeout(searchTimer);
    searchController?.abort();
    searching.value = false;
}

function choose(r, plant) {
    r.plant = plant;
    r.text = plant.title;
    close();
}

/** Leaving the box: keep a real choice, empty the bed if it was cleared, otherwise undo the typing. */
function settle(r) {
    if (openKey.value === r.key) close();
    if (!r.text.trim()) r.plant = null;
    r.text = r.plant?.title || '';
}

function onKeydown(r, e) {
    const open = openKey.value === r.key;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open) return openFor(r);
        const n = results.value.length;
        if (n) active.value = (active.value + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    } else if (e.key === 'Enter') {
        if (open && results.value[active.value]) {
            e.preventDefault();
            choose(r, results.value[active.value]);
        }
    } else if (e.key === 'Escape' && open) {
        // Close just the dropdown, not the whole editor.
        e.stopPropagation();
        r.text = r.plant?.title || '';
        close();
    }
}

// ── Rows ──
async function addPlot() {
    if (rows.value.length >= MAX_PLOTS) return;
    const r = row('', null);
    rows.value.push(r);
    await nextTick();
    plantInputs.value[r.key]?.focus();
}

function move(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= rows.value.length) return;
    const next = [...rows.value];
    [next[i], next[j]] = [next[j], next[i]];
    rows.value = next;
}

function remove(i) {
    if (openKey.value === rows.value[i].key) close();
    rows.value = rows.value.filter((_, k) => k !== i);
}

function startFromSuggestions() {
    rows.value = props.suggestions.slice(0, MAX_PLOTS).map(p => row('', p));
}

async function save() {
    error.value = '';
    if (rows.value.some(r => r.label.trim().length > 60)) {
        error.value = 'Plot names are 60 characters at most.';
        return;
    }
    saving.value = true;
    try {
        const res = await fetchWrapper.put(`${api}/api/gardens/${props.gardenSlug}/plots`, {
            data: { plots: rows.value.map(r => ({ label: r.label.trim() || null, plant: r.plant?.documentId ?? null })) }
        });
        useAlertStore().success('Plots saved');
        emit('saved', res?.data?.plots || []);
    } catch (e) {
        // fetchWrapper rejects with the API's message, as a string or { message }.
        error.value = (typeof e === 'string' ? e : e?.message) || "Couldn't save the plots. Try again in a moment.";
    } finally {
        saving.value = false;
    }
}

onBeforeUnmount(close);
</script>

<template>
    <div class="ex-plots" @keydown.esc="emit('cancel')">
        <p class="ex-plots__title">Edit plots</p>

        <div v-if="!rows.length" class="ex-plots__empty">
            <p>No plots yet. Each plot is one bed on the island, growing one plant.</p>
            <button v-if="suggestions.length" type="button" class="ex-plots__link" @click="startFromSuggestions">
                Start from the {{ suggestions.length }} {{ suggestions.length === 1 ? 'plant' : 'plants' }} logged nearby
            </button>
        </div>

        <ol class="ex-plots__list">
            <li v-for="(r, i) in rows" :key="r.key" class="ex-plots__row">
                <span class="ex-plots__num" aria-hidden="true">{{ i + 1 }}</span>
                <div class="ex-plots__fields">
                    <input
                        v-model="r.label"
                        type="text"
                        maxlength="60"
                        :placeholder="`Plot ${i + 1}`"
                        :aria-label="`Name of plot ${i + 1}`"
                    />
                    <div class="ex-plots__combo">
                        <input
                            :ref="(el) => { if (el) plantInputs[r.key] = el; else delete plantInputs[r.key]; }"
                            v-model="r.text"
                            type="text"
                            role="combobox"
                            autocomplete="off"
                            placeholder="Type a plant…"
                            class="ex-plots__plant"
                            :class="{ 'is-set': r.plant && r.text === r.plant.title }"
                            :aria-label="`Plant for plot ${i + 1}`"
                            aria-autocomplete="list"
                            :aria-expanded="openKey === r.key"
                            :aria-controls="listId(r)"
                            :aria-activedescendant="openKey === r.key ? activeId : undefined"
                            @input="openFor(r)"
                            @keydown="onKeydown(r, $event)"
                            @blur="settle(r)"
                        />
                        <ul v-if="openKey === r.key" :id="listId(r)" class="ex-plots__dropdown" role="listbox">
                            <li v-if="searching && !results.length" class="ex-plots__hint">Loading plants…</li>
                            <li v-else-if="!searching && !results.length" class="ex-plots__hint">
                                {{ r.text.trim() ? 'No plants match.' : 'No plants in the directory yet.' }}
                            </li>
                            <li
                                v-for="(p, k) in results"
                                :id="optionId(r, k)"
                                :key="p.documentId"
                                role="option"
                                class="ex-plots__option"
                                :class="{ 'is-active': k === active }"
                                :aria-selected="r.plant?.documentId === p.documentId"
                                @mousedown.prevent="choose(r, p)"
                                @mousemove="active = k"
                            >
                                <span>{{ p.title }}</span>
                                <span v-if="p.latin" class="ex-plots__latin">{{ p.latin }}</span>
                            </li>
                            <li v-if="total > results.length" class="ex-plots__hint">
                                Showing {{ results.length }} of {{ total }}. Keep typing to narrow it down.
                            </li>
                        </ul>
                    </div>
                </div>
                <div class="ex-plots__tools">
                    <button type="button" :disabled="i === 0" :aria-label="`Move plot ${i + 1} up`" @click="move(i, -1)">↑</button>
                    <button type="button" :disabled="i === rows.length - 1" :aria-label="`Move plot ${i + 1} down`" @click="move(i, 1)">↓</button>
                    <button type="button" :aria-label="`Remove plot ${i + 1}`" @click="remove(i)">×</button>
                </div>
            </li>
        </ol>

        <button v-if="rows.length < MAX_PLOTS" type="button" class="ex-plots__add" @click="addPlot">+ Add plot</button>

        <p v-if="error" class="ex-form__error" role="alert">{{ error }}</p>
        <div class="ex-form__actions">
            <button type="button" class="ex-form__save" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save plots' }}</button>
            <button type="button" class="ex-form__cancel" @click="emit('cancel')">Cancel</button>
        </div>
    </div>
</template>

<style src="./explore-form.css"></style>

<style scoped>
.ex-plots {
    display: grid;
    gap: 10px;
    margin: 6px 0 10px;
    padding: 14px;
    border: 1px solid var(--ex-line);
    border-radius: 16px;
    background: var(--ex-surface);
    color: var(--ex-fg);
}
.ex-plots__title {
    margin: 0;
    font-weight: 700;
    font-size: 15px;
}
.ex-plots__empty p {
    margin: 0 0 6px;
    font-size: 13px;
    color: var(--ex-muted);
}
.ex-plots__list {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
}
.ex-plots__row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
}
.ex-plots__num {
    flex: none;
    width: 22px;
    height: 22px;
    margin-top: 7px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    background: #5c4331;
    color: #fbfcf8;
    font-size: 11px;
    font-weight: 700;
}
.ex-plots__fields {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 4px;
}
.ex-plots__fields input {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 9px;
    border: 1px solid var(--ex-line);
    border-radius: 8px;
    background: transparent;
    color: var(--ex-fg);
    font: inherit;
    font-size: 13px;
}
.ex-plots__combo {
    position: relative;
}
.ex-plots__fields .ex-plots__plant {
    border-style: dashed;
}
.ex-plots__fields .ex-plots__plant.is-set {
    border-style: solid;
    font-weight: 600;
}
.ex-plots__dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 10;
    max-height: 220px;
    overflow-y: auto;
    margin: 0;
    padding: 4px;
    border: 1px solid var(--ex-line);
    border-radius: 10px;
    background: var(--ex-surface);
    box-shadow: var(--ex-shadow);
}
.ex-plots__dropdown li {
    margin: 0;
    list-style: none;
}
.ex-plots__option {
    display: grid;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
}
.ex-plots__option.is-active {
    background: rgb(127 176 90 / 0.22);
}
.ex-plots__option[aria-selected='true'] {
    font-weight: 700;
}
.ex-plots__latin {
    font-size: 11px;
    font-style: italic;
    font-weight: 400;
    color: var(--ex-muted);
}
.ex-plots__hint {
    padding: 4px 8px;
    font-size: 12px;
    color: var(--ex-muted);
}
.ex-plots__tools {
    flex: none;
    display: flex;
    gap: 2px;
}
.ex-plots__tools button {
    width: 26px;
    height: 28px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ex-muted);
    font-size: 14px;
    cursor: pointer;
}
.ex-plots__tools button:hover:not(:disabled) {
    background: rgb(127 176 90 / 0.18);
    color: var(--ex-fg);
}
.ex-plots__tools button:disabled {
    opacity: 0.3;
    cursor: default;
}
.ex-plots__add,
.ex-plots__link {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ex-accent);
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
}
.ex-plots button:focus-visible,
.ex-plots input:focus-visible {
    outline: 3px solid var(--ex-pick);
    outline-offset: 1px;
}
</style>
