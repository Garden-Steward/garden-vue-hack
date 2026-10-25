<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ExploreTaskSignup from '@/explore/ExploreTaskSignup.vue';
import { helpSummary, isFull, laterLine, nextSheetHeight, spotsLine } from '@/explore/volunteer';

// The Explore garden page for visitors and volunteers: the next workday and
// the open tasks sit on top of the island, no side sheet. On desktop the tasks
// are a tray along the bottom; on phones they are a bottom sheet with three
// heights. "I can help" opens the phone sign-up in place.

const props = defineProps({
    gardenSlug: { type: String, required: true },
    nextEvent: { type: Object, default: null },
    laterEvents: { type: Array, default: () => [] },
    eventCount: { type: Number, default: 0 },
    tasks: { type: Array, default: () => [] },
    rsvped: { type: Boolean, default: false },
    rsvpBusy: { type: Boolean, default: false },
    /** Managers previewing their garden get a way back to the workbench. */
    canManage: { type: Boolean, default: false }
});
const emit = defineEmits(['rsvp', 'manage', 'signed-up']);

const formatDay = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const formatTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const summary = computed(() => helpSummary(props.tasks));
const later = computed(() => props.laterEvents.slice(0, 2));
const laterText = computed(() => laterLine(later.value, formatDay));

// ── Phone sheet: peek → half → full ──
const sheet = ref('peek');
const phoneQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;
const phone = ref(phoneQuery?.matches ?? false);
const onMedia = (e) => { phone.value = e.matches; };
onMounted(() => phoneQuery?.addEventListener?.('change', onMedia));
onBeforeUnmount(() => phoneQuery?.removeEventListener?.('change', onMedia));

const raise = () => { sheet.value = nextSheetHeight(sheet.value, 'up'); };
const lower = () => { sheet.value = nextSheetHeight(sheet.value, 'down'); };
const toggleSheet = () => (sheet.value === 'peek' ? raise() : (sheet.value = 'peek'));

// Drag the grab bar: a short pull up or down moves one step.
let dragY = null;
const onGrabStart = (e) => { dragY = e.clientY; };
const onGrabEnd = (e) => {
    if (dragY === null) return;
    const dy = e.clientY - dragY;
    dragY = null;
    if (dy < -24) raise();
    else if (dy > 24) lower();
};

// ── Claiming a task: the list gives way to one task and its sign-up ──
const openTask = ref(null);
let returnTo = null; // the "I can help" button to focus again on close
const trayEl = ref(null);

async function claim(task, e) {
    returnTo = e?.currentTarget ?? null;
    openTask.value = task;
    if (phone.value && sheet.value === 'peek') sheet.value = 'half';
    await nextTick();
    trayEl.value?.scrollTo?.({ top: 0 });
}
function closeTask() {
    openTask.value = null;
    returnTo?.focus?.({ preventScroll: true });
    returnTo = null;
}
function onKey(e) {
    if (e.key === 'Escape' && openTask.value) closeTask();
}
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));

// A new garden, or the open task vanishing from the list, resets the view.
watch(() => props.gardenSlug, () => { openTask.value = null; sheet.value = 'peek'; });
watch(() => props.tasks, (list) => {
    if (openTask.value && !list.some(t => t.id === openTask.value.id)) openTask.value = null;
});

/** The island is framed above this element (the tray or the sheet). */
defineExpose({ insetEl: trayEl, sheet });
</script>

<template>
    <div class="exv" :class="[`is-${sheet}`, { 'is-phone': phone, 'has-tasks': tasks.length }]">
        <div class="exv__card exv__header">
            <slot name="header"></slot>
            <button v-if="canManage" type="button" class="exv__manage" data-test="manage" @click="emit('manage')">Manage ›</button>
        </div>

        <section v-if="nextEvent" class="exv__card exv__next" aria-labelledby="exv-next-title" data-test="next">
            <p class="exv__label">Next workday</p>
            <div class="exv__next-row">
                <router-link :to="`/d/${nextEvent.id}`" class="exv__next-link">
                    <span class="exv__when">{{ formatDay(nextEvent.startDatetime) }} · {{ formatTime(nextEvent.startDatetime) }}<template v-if="nextEvent.endText">–{{ nextEvent.endText }}</template></span>
                    <span id="exv-next-title" class="exv__title">{{ nextEvent.title }}</span>
                </router-link>
                <button
                    type="button"
                    class="exv__rsvp"
                    :class="{ 'is-going': rsvped }"
                    :disabled="rsvped || rsvpBusy"
                    data-test="rsvp"
                    @click="emit('rsvp')"
                >{{ rsvped ? "You're going" : "I'm going" }}</button>
            </div>
            <ul v-if="later.length" class="exv__later">
                <li v-for="e in later" :key="e.id">
                    <router-link :to="`/d/${e.id}`"><span>{{ e.title }}</span><span class="exv__meta">{{ formatDay(e.startDatetime) }}</span></router-link>
                </li>
            </ul>
            <router-link v-if="eventCount > 1" :to="{ name: 'garden-public', params: { slug: gardenSlug } }" class="exv__link">
                All {{ eventCount }} workdays →
            </router-link>
        </section>

        <section v-if="tasks.length" ref="trayEl" class="exv__card exv__help" aria-label="Help needed" data-test="help">
            <button
                type="button"
                class="exv__grab"
                :aria-label="sheet === 'peek' ? 'Show tasks' : 'Hide tasks'"
                @pointerdown="onGrabStart"
                @pointerup="onGrabEnd"
                @pointercancel="dragY = null"
                @click="toggleSheet"
            ><span></span></button>

            <div class="exv__summary">
                <div class="exv__sum">
                    <span><span class="exv__dot" aria-hidden="true"></span>{{ summary.label }}</span>
                    <small v-if="sheet === 'peek'" class="exv__sub">{{ summary.sub }}</small>
                </div>
                <button type="button" class="exv__show" data-test="toggle" @click="toggleSheet">{{ sheet === 'peek' ? 'Show ▴' : 'Hide ▾' }}</button>
            </div>

            <div v-if="openTask" class="exv__one" data-test="one">
                <button type="button" class="exv__close" aria-label="Back to all tasks" @click="closeTask">✕</button>
                <p class="exv__one-title">{{ openTask.title }}</p>
                <p class="exv__spots" :class="{ 'is-full': isFull(openTask) }">{{ spotsLine(openTask) }}</p>
                <ExploreTaskSignup :task="openTask" :garden-slug="gardenSlug" :stacked="phone" @signed-up="emit('signed-up')" />
            </div>

            <ul v-else class="exv__list">
                <li v-for="t in tasks" :key="t.id" class="exv__task">
                    <div class="exv__task-text">
                        <span class="exv__task-title">{{ t.title }}</span>
                        <span class="exv__spots" :class="{ 'is-full': isFull(t) }">{{ spotsLine(t) }}</span>
                    </div>
                    <button
                        type="button"
                        class="exv__claim"
                        :class="{ 'is-full': isFull(t) }"
                        :disabled="isFull(t)"
                        :aria-label="isFull(t) ? `${t.title} is full` : `I can help with ${t.title}`"
                        data-test="claim"
                        @click="claim(t, $event)"
                    >{{ isFull(t) ? 'Full' : 'I can help' }}</button>
                </li>
            </ul>

            <p v-if="laterText || eventCount" class="exv__foot">
                <span v-if="laterText">{{ laterText }} · </span>
                <router-link v-if="eventCount" :to="{ name: 'garden-public', params: { slug: gardenSlug } }">All {{ eventCount }} →</router-link>
            </p>
        </section>
    </div>
</template>

<style scoped>
.exv {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none; /* the island takes the drag; only the cards catch it */
}
.exv__card {
    position: absolute;
    pointer-events: auto;
    border-radius: var(--ex-r-surface);
    background: var(--ex-surface);
    color: var(--ex-fg);
    box-shadow: var(--ex-shadow);
    animation: exv-rise 560ms 200ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

/* Header card */
.exv__header {
    top: var(--ex-gutter);
    left: var(--ex-gutter);
    width: min(300px, calc(100% - 2 * var(--ex-gutter)));
    display: grid;
    gap: 6px;
    padding: 14px 16px 12px;
}
.exv__manage {
    position: absolute;
    top: 12px;
    right: 12px;
    padding: 3px 10px;
    border: 1.5px solid var(--ex-accent);
    border-radius: 999px;
    background: transparent;
    color: var(--ex-accent);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
}
.exv__manage:hover {
    background: var(--ex-sunken);
}

/* Next workday card */
.exv__next {
    top: var(--ex-gutter);
    right: var(--ex-gutter);
    width: min(300px, calc(100% - 2 * var(--ex-gutter)));
    display: grid;
    gap: 8px;
    padding: 12px 14px;
}
.exv__label {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ex-muted);
}
.exv__next-row {
    display: grid;
    gap: 8px;
}
.exv__next-link {
    display: grid;
    gap: 1px;
    color: inherit;
    text-decoration: none;
}
.exv__next-link:hover .exv__title {
    text-decoration: underline;
}
.exv__when {
    font-size: var(--ex-t-meta);
    font-weight: 600;
    color: var(--ex-muted);
}
.exv__title {
    font-size: 16px;
    font-weight: 700;
    line-height: 1.25;
    text-wrap: balance;
}
.exv__rsvp {
    min-height: 44px;
    padding: 8px 16px;
    border: 2px solid var(--ex-accent);
    border-radius: var(--ex-r-control);
    background: var(--ex-accent);
    color: var(--ex-on-accent);
    font: inherit;
    font-size: var(--ex-t-body);
    font-weight: 700;
    cursor: pointer;
}
.exv__rsvp.is-going {
    background: transparent;
    color: var(--ex-accent);
    cursor: default;
}
.exv__rsvp:disabled:not(.is-going) {
    opacity: 0.7;
    cursor: progress;
}
.exv__later {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 8px 0 0;
    border-top: 1px solid var(--ex-line);
    list-style: none;
}
/* base.css indents and bullets every `ul li`; these lists are plain rows. */
.exv__later li,
.exv__task {
    margin: 0;
    padding: 0;
    list-style: none;
}
.exv__later a {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 4px 0;
    color: inherit;
    font-size: 14px;
    text-decoration: none;
}
.exv__later a:hover span:first-child {
    text-decoration: underline;
}
.exv__meta {
    flex: none;
    font-size: var(--ex-t-meta);
    color: var(--ex-muted);
}
.exv__link {
    justify-self: start;
    font-size: var(--ex-t-meta);
    font-weight: 700;
    color: var(--ex-accent);
    text-decoration: none;
}
.exv__link:hover {
    text-decoration: underline;
}

/* Help needed: a tray along the bottom on desktop */
.exv__help {
    left: var(--ex-gutter);
    right: var(--ex-gutter);
    bottom: var(--ex-gutter);
    display: grid;
    gap: 8px;
    max-height: 40%;
    padding: 10px 14px 12px;
    overflow: auto;
}
.exv__grab {
    display: none;
}
.exv__summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 44px;
}
.exv__sum {
    display: grid;
    font-size: var(--ex-t-body);
    font-weight: 700;
}
.exv__sub {
    display: none; /* the desktop tray is always open; the hint only matters on the phone sheet */
    font-size: var(--ex-t-meta);
    font-weight: 600;
    color: var(--ex-muted);
}
.exv__dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    margin-right: 7px;
    border-radius: 50%;
    background: var(--ex-help);
    vertical-align: 1px;
}
.exv__show {
    display: none;
    min-height: 44px;
    padding: 0 8px;
    border: 0;
    background: transparent;
    color: var(--ex-accent);
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
}
.exv__list {
    display: flex;
    gap: 8px;
    margin: 0;
    padding: 0 0 4px;
    overflow-x: auto;
    list-style: none;
    scrollbar-width: thin;
}
.exv__task {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 8px 6px 12px;
    border-radius: var(--ex-r-control);
    background: var(--ex-sunken);
}
.exv__task-text {
    display: grid;
    min-width: 0;
}
.exv__task-title {
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
}
.exv__spots {
    margin: 0;
    font-size: var(--ex-t-meta);
    font-weight: 600;
    color: var(--ex-help);
}
.exv__spots.is-full {
    color: var(--ex-muted);
}
.exv__claim {
    flex: none;
    min-height: 44px;
    padding: 6px 14px;
    border: 2px solid var(--ex-accent);
    border-radius: var(--ex-r-control);
    background: var(--ex-accent);
    color: var(--ex-on-accent);
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
}
.exv__claim.is-full {
    border-color: var(--ex-line);
    background: transparent;
    color: var(--ex-muted);
    cursor: default;
}
.exv__one {
    position: relative;
    display: grid;
    gap: 4px;
    max-width: 420px;
    padding-right: 36px;
}
.exv__close {
    position: absolute;
    top: -6px;
    right: -6px;
    min-width: 44px;
    min-height: 44px;
    border: 0;
    background: transparent;
    color: var(--ex-muted);
    font: inherit;
    font-size: 18px;
    font-weight: 700;
    cursor: pointer;
}
.exv__close:hover {
    color: var(--ex-fg);
}
.exv__one-title {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
}
.exv__foot {
    display: none;
    margin: 0;
    padding-top: 8px;
    border-top: 1px solid var(--ex-line);
    font-size: 14px;
    font-weight: 600;
    color: var(--ex-muted);
}
.exv__foot a {
    color: var(--ex-accent);
    font-weight: 700;
    text-decoration: none;
}

/* Phone: a header chip and a next workday chip at the top, a bottom sheet for the tasks */
@media (max-width: 640px) {
    .exv__header {
        right: var(--ex-gutter);
        width: auto;
        padding: 10px 12px;
    }
    .exv__header :deep(h2) {
        font-size: 15px;
    }
    .exv__header :deep(.explore-sheet__blurb) {
        display: none;
    }
    .exv__next {
        top: auto;
        bottom: 118px; /* clear of the sheet in its peek state */
        left: var(--ex-gutter);
        right: var(--ex-gutter);
        width: auto;
        padding: 10px 12px;
    }
    .exv:not(.has-tasks) .exv__next {
        bottom: var(--ex-gutter);
    }
    .exv__next-row {
        grid-template-columns: 1fr auto;
        align-items: center;
    }
    .exv__title {
        font-size: 14px;
    }
    .exv__later,
    .exv__link {
        display: none;
    }
    /* Once the sheet is up, the dates move to its last line and the chip steps aside. */
    .exv.has-tasks:not(.is-peek) .exv__next {
        display: none;
    }
    .exv__help {
        left: 0;
        right: 0;
        bottom: 0;
        max-height: none;
        padding: 6px 16px 20px;
        border-radius: var(--ex-r-surface) var(--ex-r-surface) 0 0;
        transition: max-height 240ms ease;
    }
    .exv__grab {
        display: block;
        width: 100%;
        min-height: 24px;
        padding: 6px 0;
        border: 0;
        background: transparent;
        cursor: grab;
        touch-action: none;
    }
    .exv__grab span {
        display: block;
        width: 44px;
        height: 5px;
        margin: 0 auto;
        border-radius: 3px;
        background: var(--ex-muted);
        opacity: 0.6;
    }
    .exv__show,
    .exv__sub {
        display: block;
    }
    .exv.is-peek .exv__list,
    .exv.is-peek .exv__one,
    .exv.is-peek .exv__foot {
        display: none;
    }
    .exv.is-half .exv__help {
        max-height: 60%;
    }
    .exv.is-full .exv__help {
        max-height: 88%;
    }
    .exv__list {
        flex-direction: column;
        gap: 0;
        overflow: visible;
    }
    .exv__task {
        display: flex;
        min-height: 64px;
        padding: 10px 0;
        border-top: 1px solid var(--ex-line);
        border-radius: 0;
        background: transparent;
    }
    .exv__task-title {
        font-size: 16px;
        white-space: normal;
    }
    .exv__claim {
        padding: 8px 16px;
        font-size: 15px;
    }
    .exv__one {
        max-width: none;
        padding-top: 4px;
    }
    .exv__one-title {
        font-size: 18px;
    }
    .exv__spots {
        font-size: 14px;
    }
    .exv__foot {
        display: block;
    }
}

.exv button:focus-visible,
.exv a:focus-visible {
    outline: 2px solid var(--ex-ring);
    outline-offset: 2px;
}

@keyframes exv-rise {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
    .exv__card {
        animation: none;
        transition: none;
    }
}
</style>
