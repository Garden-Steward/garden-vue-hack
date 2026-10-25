<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ExploreTaskSignup from '@/explore/ExploreTaskSignup.vue';
import { helpSummary, isFull, laterLine, nextSheetHeight, spotsLine } from '@/explore/volunteer';
import { LEVEL_LABEL, healthNudge } from '@/explore/health';
import { STATUS_LABEL, myStanding, personInitials, personName, reservePosition } from '@/explore/people';

// The Explore garden page for visitors and volunteers: the next workday, the
// garden's health, who's committed, and the open tasks sit on top of the
// island, no side sheet. Committed volunteers stand on the island as small
// figures. On desktop the tasks are a tray along the bottom; on phones they
// are a bottom sheet with three heights and a People tab. "I can help" opens
// the phone sign-up in place; "Can't make it" drops you off; full tasks take
// a reserve list.

const props = defineProps({
    gardenSlug: { type: String, required: true },
    nextEvent: { type: Object, default: null },
    laterEvents: { type: Array, default: () => [] },
    eventCount: { type: Number, default: 0 },
    tasks: { type: Array, default: () => [] },
    /** From computeHealth(): level, streak, days, nudge inputs. */
    health: { type: Object, default: null },
    /** From volunteersOf(): everyone committed, with statuses. */
    people: { type: Array, default: () => [] },
    /** Screen positions for the people standing on the island, in canvas px, same order as `islandPeople`. */
    figures: { type: Array, default: () => [] },
    user: { type: Object, default: null },
    rsvped: { type: Boolean, default: false },
    rsvpBusy: { type: Boolean, default: false },
    /** Managers previewing their garden get a way back to the workbench. */
    canManage: { type: Boolean, default: false }
});
const emit = defineEmits(['rsvp', 'unrsvp', 'manage', 'signed-up', 'leave', 'finish', 'leave-reserve']);

const formatDay = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const formatTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const userId = computed(() => props.user?.id ?? null);

const summary = computed(() => helpSummary(props.tasks));
const later = computed(() => props.laterEvents.slice(0, 2));
const laterText = computed(() => laterLine(later.value, formatDay));

// Overdue repeating tasks first, then the rest in their own order.
const overdueDays = computed(() => new Map((props.health?.overdue || []).map(o => [o.task.id, o.days])));
const orderedTasks = computed(() => [...props.tasks].sort((a, b) => (overdueDays.value.get(b.id) || 0) - (overdueDays.value.get(a.id) || 0)));
const taskSub = (t) => {
    const d = overdueDays.value.get(t.id);
    if (d) return `Overdue · ${d === 1 ? '1 day' : `${d} days`}`;
    const s = myStanding(t, userId.value);
    if (s === 'on') return "you're on it";
    if (s === 'offered') return 'a spot is yours · reply YES to our text';
    if (s === 'reserve') return `you're ${ordinal(reservePosition(t, userId.value))} on reserve`;
    return '';
};
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th'}`;
const standing = (t) => myStanding(t, userId.value);
const facesOf = (t) => (t.volunteers || []).filter(u => u && typeof u === 'object').slice(0, 3);

// ── Health ──
const level = computed(() => props.health?.level || 'quiet');
const showHealth = computed(() => !!props.health && (level.value !== 'quiet' || props.health.doneWeekAll > 0));
const nudge = computed(() => (props.health ? healthNudge(props.health) : ''));
const dayTitle = (d) => `${d.key}: ${{ done: 'every task done', part: 'some tasks done', miss: 'nothing done', pending: 'not done yet', none: 'nothing due' }[d.state]}`;

// ── People and figures ──
const islandPeople = computed(() => props.people.filter(p => p.onIsland).slice(0, 12));
const extraOnIsland = computed(() => Math.max(0, props.people.filter(p => p.onIsland).length - 12));
const topPeople = computed(() => props.people.slice(0, 4));
const allPeople = ref(false);
const focusPerson = ref(null); // id of the person whose figure was tapped
const goingFaces = computed(() => (props.nextEvent?.confirmed || []).slice(0, 5));
const goingCount = computed(() => (props.nextEvent?.confirmed || []).length);
const figureClass = (p) => ({ 'is-me': p.me, 'is-done': p.doneToday, 'is-going': !p.doneToday && !p.statuses.includes('signedUp') && p.statuses.includes('going') });
function tapFigure(p) {
    focusPerson.value = p.id;
    if (phone.value) {
        tab.value = 'people';
        if (sheet.value === 'peek') sheet.value = 'half';
    } else {
        allPeople.value = true;
    }
    nextTick(() => trayEl.value?.querySelector?.(`[data-person="${p.id}"]`)?.scrollIntoView?.({ block: 'nearest' }));
}

// ── Phone sheet: peek → half → full, with Tasks / People tabs ──
const sheet = ref('peek');
const tab = ref('tasks');
const phoneQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;
const phone = ref(phoneQuery?.matches ?? false);
const onMedia = (e) => { phone.value = e.matches; };
onMounted(() => phoneQuery?.addEventListener?.('change', onMedia));
onBeforeUnmount(() => phoneQuery?.removeEventListener?.('change', onMedia));

const raise = () => { sheet.value = nextSheetHeight(sheet.value, 'up'); };
const lower = () => { sheet.value = nextSheetHeight(sheet.value, 'down'); };
const toggleSheet = () => (sheet.value === 'peek' ? raise() : (sheet.value = 'peek'));
let dragY = null;
const onGrabStart = (e) => { dragY = e.clientY; };
const onGrabEnd = (e) => {
    if (dragY === null) return;
    const dy = e.clientY - dragY;
    dragY = null;
    if (dy < -24) raise();
    else if (dy > 24) lower();
};
function showTasks() {
    tab.value = 'tasks';
    if (sheet.value === 'peek') sheet.value = 'half';
    nextTick(() => trayEl.value?.scrollIntoView?.({ block: 'end', behavior: 'smooth' }));
}

// ── One task open: sign-up, reserve, or your own controls ──
const openTask = ref(null);
const confirmLeave = ref(false);
const busy = ref(false);
let returnTo = null; // the button to focus again on close
const trayEl = ref(null);

async function open(task, e) {
    returnTo = e?.currentTarget ?? null;
    openTask.value = task;
    confirmLeave.value = false;
    tab.value = 'tasks';
    if (phone.value && sheet.value === 'peek') sheet.value = 'half';
    await nextTick();
    trayEl.value?.scrollTo?.({ top: 0 });
}
function closeTask() {
    openTask.value = null;
    confirmLeave.value = false;
    returnTo?.focus?.({ preventScroll: true });
    returnTo = null;
}
function onKey(e) {
    if (e.key === 'Escape' && openTask.value) closeTask();
}
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));

const act = (name, task) => {
    busy.value = true;
    emit(name, task, () => { busy.value = false; });
};

// A new garden, or the open task vanishing from the list, resets the view.
watch(() => props.gardenSlug, () => { openTask.value = null; sheet.value = 'peek'; tab.value = 'tasks'; allPeople.value = false; focusPerson.value = null; });
watch(() => props.tasks, (list) => {
    if (!openTask.value) return;
    const fresh = list.find(t => t.id === openTask.value.id);
    if (fresh) openTask.value = fresh; // keep the open panel on the latest copy (volunteers, reserves)
    else openTask.value = null;
    busy.value = false;
});

/** The island is framed above this element (the tray or the sheet). */
defineExpose({ insetEl: trayEl, sheet });
</script>

<template>
    <div class="exv" :class="[`is-${sheet}`, `is-${level}`, { 'is-phone': phone, 'has-tasks': tasks.length || people.length }]">
        <!-- Volunteers standing on the island -->
        <div class="exv__figures" aria-label="Volunteers on the island">
            <button
                v-for="(p, i) in islandPeople"
                :key="p.id"
                type="button"
                class="exv__fig"
                :class="[figureClass(p), { 'is-hidden': figures[i] && !figures[i].visible, 'is-back': figures[i]?.back, 'is-focus': focusPerson === p.id }]"
                :style="figures[i] ? { left: `${figures[i].x}px`, top: `${figures[i].y}px`, zIndex: figures[i].back ? 1 : 2 } : { display: 'none' }"
                :aria-label="`${p.name || 'A volunteer'} · ${STATUS_LABEL[p.primary]}`"
                data-test="figure"
                @click="tapFigure(p)"
            >
                <span class="exv__fig-shadow" aria-hidden="true"></span>
                <span class="exv__fig-body" :style="p.user.color ? {} : {}" aria-hidden="true"></span>
                <span class="exv__fig-head" aria-hidden="true">{{ p.initials }}</span>
                <span class="exv__fig-tip" role="tooltip">
                    <b>{{ p.me ? `${p.name} (you)` : (p.name || 'A volunteer') }}</b>
                    <span :class="`is-${p.primary}`">{{ STATUS_LABEL[p.primary] }}<template v-if="p.tasks[0]"> · {{ p.tasks[0].title }}</template></span>
                </span>
            </button>
            <span v-if="extraOnIsland && figures[islandPeople.length - 1]" class="exv__fig-more" :style="{ left: `${figures[islandPeople.length - 1].x + 18}px`, top: `${figures[islandPeople.length - 1].y - 30}px` }">+{{ extraOnIsland }}</span>
        </div>

        <div class="exv__col exv__col--left">
        <div class="exv__card exv__header">
            <slot name="header"></slot>
            <button v-if="canManage" type="button" class="exv__manage" data-test="manage" @click="emit('manage')">Manage ›</button>
            <p v-if="phone && showHealth" class="exv__header-health"><span class="exv__badge" :class="`is-${level}`">{{ LEVEL_LABEL[level] }}</span> <template v-if="health.streak">· {{ health.streak }} day streak</template><template v-if="islandPeople.length"> · {{ islandPeople.length + extraOnIsland }} on the island</template></p>
        </div>

        <!-- Garden health -->
        <section v-if="showHealth" class="exv__card exv__health" aria-label="Garden health" data-test="health">
            <span class="exv__badge" :class="`is-${level}`">{{ level === 'thriving' ? '🌿 ' : level === 'needs' ? '🥀 ' : '' }}{{ LEVEL_LABEL[level] }}</span>
            <div class="exv__streak">
                <b>{{ health.streak }}</b>
                <span v-if="health.streak">day streak{{ health.streak === health.best ? '' : ` · best ${health.best}` }}</span>
                <span v-else>day streak{{ health.best ? ` · best was ${health.best}` : '' }}</span>
            </div>
            <div class="exv__days" role="img" :aria-label="`Last 14 days: ${health.days.filter(d => d.state === 'done').length} fully done`">
                <i v-for="d in health.days" :key="d.key" :class="[`is-${d.state}`, { 'is-today': d.today }]" :title="dayTitle(d)"></i>
            </div>
            <div class="exv__days-label"><span>2 weeks ago</span><span>today</span></div>
            <p class="exv__stat"><span>Done this week</span><b>{{ health.doneWeekAll }} {{ health.doneWeekAll === 1 ? 'task' : 'tasks' }}<template v-if="health.dueWeek"> · {{ health.doneWeek }} of {{ health.dueWeek }} scheduled</template></b></p>
            <p class="exv__nudge" :class="{ 'is-needs': level === 'needs' }">{{ nudge }}</p>
            <button v-if="level === 'needs' && tasks.length" type="button" class="exv__btn exv__btn--block" @click="showTasks">See what needs doing ↓</button>
            <div v-if="islandPeople.length" class="exv__legend">
                <span><i class="is-signed"></i>Signed up</span>
                <span><i class="is-done"></i>Done today</span>
                <span v-if="user"><i class="is-me"></i>You</span>
                <b>{{ islandPeople.length + extraOnIsland }} on the island</b>
            </div>
        </section>
        </div>

        <div class="exv__col exv__col--right">
        <!-- Next workday -->
        <section v-if="nextEvent" class="exv__card exv__next" aria-labelledby="exv-next-title" data-test="next">
            <p class="exv__label">Next workday</p>
            <div class="exv__next-row">
                <router-link :to="`/d/${nextEvent.id}`" class="exv__next-link">
                    <span class="exv__when">{{ formatDay(nextEvent.startDatetime) }} · {{ formatTime(nextEvent.startDatetime) }}<template v-if="nextEvent.endText">–{{ nextEvent.endText }}</template></span>
                    <span id="exv-next-title" class="exv__title">{{ nextEvent.title }}</span>
                </router-link>
                <div class="exv__rsvp-row">
                    <button
                        type="button"
                        class="exv__rsvp"
                        :class="{ 'is-going': rsvped }"
                        :disabled="rsvped || rsvpBusy"
                        data-test="rsvp"
                        @click="emit('rsvp')"
                    >{{ rsvped ? "You're going ✓" : "I'm going" }}</button>
                    <button v-if="rsvped && user" type="button" class="exv__btn exv__btn--quiet exv__btn--sm" :disabled="rsvpBusy" data-test="unrsvp" @click="emit('unrsvp')">Can't make it</button>
                </div>
            </div>
            <p v-if="goingCount" class="exv__going">
                <span class="exv__faces"><span v-for="g in goingFaces" :key="g.id" class="exv__face">{{ personInitials(g) }}</span></span>
                {{ goingCount }} going<template v-if="goingCount === 1 && !rsvped"> · it'd be great to have more</template>
            </p>
            <ul v-if="later.length" class="exv__later">
                <li v-for="e in later" :key="e.id">
                    <router-link :to="`/d/${e.id}`"><span>{{ e.title }}</span><span class="exv__meta">{{ formatDay(e.startDatetime) }}</span></router-link>
                </li>
            </ul>
            <router-link v-if="eventCount > 1" :to="{ name: 'garden-public', params: { slug: gardenSlug } }" class="exv__link">
                All {{ eventCount }} workdays →
            </router-link>
        </section>

        <!-- Volunteers (desktop card) -->
        <section v-if="people.length && !phone" class="exv__card exv__people" aria-label="Volunteers" data-test="people">
            <p class="exv__label">Volunteers · this week</p>
            <ul class="exv__plist">
                <li v-for="p in (allPeople ? people : topPeople)" :key="p.id" :data-person="p.id" class="exv__person" :class="{ 'is-me': p.me, 'is-focus': focusPerson === p.id }">
                    <span class="exv__face exv__face--lg">{{ p.initials }}</span>
                    <span class="exv__person-text">
                        <b>{{ p.me ? `${p.name || 'You'} (you)` : (p.name || 'A volunteer') }}</b>
                        <small>{{ p.tasks.map(t => t.title).slice(0, 2).join(' · ') }}</small>
                    </span>
                    <span class="exv__pill" :class="`is-${p.primary}`">{{ p.primary === 'done' && p.doneCount > 1 ? `${p.doneCount} done` : STATUS_LABEL[p.primary] }}</span>
                </li>
            </ul>
            <button v-if="people.length > 4" type="button" class="exv__link exv__link--btn" @click="allPeople = !allPeople">{{ allPeople ? 'Fewer' : `All ${people.length} helpers →` }}</button>
        </section>
        </div>

        <!-- Help needed: tray on desktop, bottom sheet on phone -->
        <section v-if="tasks.length || (phone && people.length)" ref="trayEl" class="exv__card exv__help" aria-label="Help needed" data-test="help">
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
                    <span><span class="exv__dot" :class="{ 'is-needs': level === 'needs' }" aria-hidden="true"></span>{{ tasks.length ? summary.label : 'Everything is covered' }}</span>
                    <small v-if="sheet === 'peek'" class="exv__sub">{{ tasks.length ? summary.sub : `${people.length} people helping` }}</small>
                </div>
                <button type="button" class="exv__show" data-test="toggle" @click="toggleSheet">{{ sheet === 'peek' ? 'Show ▴' : 'Hide ▾' }}</button>
            </div>

            <div v-if="phone && people.length" class="exv__tabs" role="tablist">
                <button type="button" role="tab" :aria-selected="tab === 'tasks'" :class="{ 'is-on': tab === 'tasks' }" @click="tab = 'tasks'">Tasks · {{ tasks.length }}</button>
                <button type="button" role="tab" :aria-selected="tab === 'people'" :class="{ 'is-on': tab === 'people' }" data-test="people-tab" @click="tab = 'people'">People · {{ people.length }}</button>
            </div>

            <!-- People tab (phone) -->
            <ul v-if="phone && tab === 'people'" class="exv__plist exv__plist--sheet" data-test="people">
                <li v-for="p in people" :key="p.id" :data-person="p.id" class="exv__person" :class="{ 'is-me': p.me, 'is-focus': focusPerson === p.id }">
                    <span class="exv__face exv__face--lg">{{ p.initials }}</span>
                    <span class="exv__person-text">
                        <b>{{ p.me ? `${p.name || 'You'} (you)` : (p.name || 'A volunteer') }}</b>
                        <small>{{ p.tasks.map(t => t.title).slice(0, 2).join(' · ') }}</small>
                    </span>
                    <span class="exv__pill" :class="`is-${p.primary}`">{{ STATUS_LABEL[p.primary] }}</span>
                </li>
            </ul>

            <!-- One task -->
            <div v-else-if="openTask" class="exv__one" data-test="one">
                <button type="button" class="exv__close" aria-label="Back to all tasks" @click="closeTask">✕</button>
                <p class="exv__one-title">{{ openTask.title }}</p>
                <p class="exv__spots" :class="{ 'is-full': isFull(openTask), 'is-mine': standing(openTask) === 'on' }">
                    <template v-if="standing(openTask) === 'on'">You're signed up · {{ spotsLine(openTask) }}</template>
                    <template v-else>{{ spotsLine(openTask) }}</template>
                    <template v-if="overdueDays.get(openTask.id)"> · overdue {{ overdueDays.get(openTask.id) }} {{ overdueDays.get(openTask.id) === 1 ? 'day' : 'days' }}</template>
                </p>
                <p v-if="facesOf(openTask).length" class="exv__going">
                    <span class="exv__faces"><span v-for="v in facesOf(openTask)" :key="v.id" class="exv__face">{{ personInitials(v) }}</span></span>
                    {{ facesOf(openTask).map(personName).filter(Boolean).join(', ') || `${openTask.volunteers.length} signed up` }}
                </p>

                <!-- You're on it -->
                <template v-if="standing(openTask) === 'on'">
                    <p v-if="openTask.overview" class="exv__overview">{{ openTask.overview }}</p>
                    <div v-if="!confirmLeave" class="exv__row">
                        <button type="button" class="exv__btn exv__btn--block" :disabled="busy" data-test="finish" @click="act('finish', openTask)">Mark done ✓</button>
                        <button type="button" class="exv__btn exv__btn--quiet" :disabled="busy" data-test="leave" @click="confirmLeave = true">Can't make it</button>
                    </div>
                    <div v-else class="exv__confirm" data-test="confirm-leave">
                        <p><b>Drop off this task?</b></p>
                        <p>Your spot opens right away.<template v-if="openTask.reserves?.length"> The first person on reserve will get a text.</template></p>
                        <div class="exv__row">
                            <button type="button" class="exv__btn exv__btn--block" :disabled="busy" data-test="confirm" @click="act('leave', openTask)">Yes, drop off</button>
                            <button type="button" class="exv__btn exv__btn--quiet" @click="confirmLeave = false">Keep it</button>
                        </div>
                        <p class="exv__fine">No hard feelings. Dropping off never counts against you.</p>
                    </div>
                </template>

                <!-- You're on the reserve list -->
                <template v-else-if="standing(openTask) === 'reserve' || standing(openTask) === 'offered'">
                    <div class="exv__note">
                        <template v-if="standing(openTask) === 'offered'">A spot just opened and it's yours. Reply <b>YES</b> to our text within 2 hours to take it.</template>
                        <template v-else>We'll text you the moment a spot opens. Reply <b>YES</b> within 2 hours to take it, or it passes to the next person.</template>
                    </div>
                    <button type="button" class="exv__btn exv__btn--quiet exv__btn--block" :disabled="busy" data-test="leave-reserve" @click="act('leave-reserve', openTask)">Leave reserve list</button>
                </template>

                <!-- Full: join the reserve list -->
                <ExploreTaskSignup v-else-if="isFull(openTask)" :task="openTask" :garden-slug="gardenSlug" mode="reserve" :stacked="phone" @signed-up="emit('signed-up')" />

                <!-- Open: sign up -->
                <ExploreTaskSignup v-else :task="openTask" :garden-slug="gardenSlug" :stacked="phone" @signed-up="emit('signed-up')" />
            </div>

            <!-- Task list -->
            <ul v-else class="exv__list">
                <li v-for="t in orderedTasks" :key="t.id" class="exv__task" :class="{ 'is-mine': standing(t) === 'on', 'is-overdue': overdueDays.get(t.id) }">
                    <div class="exv__task-text">
                        <span class="exv__task-title">{{ t.title }}</span>
                        <span class="exv__task-sub">
                            <span v-if="taskSub(t)" class="exv__task-when" :class="{ 'is-overdue': overdueDays.get(t.id) }">{{ taskSub(t) }}</span>
                            <span class="exv__spots" :class="{ 'is-full': isFull(t) }">
                                <span v-if="facesOf(t).length" class="exv__faces"><span v-for="v in facesOf(t)" :key="v.id" class="exv__face exv__face--xs">{{ personInitials(v) }}</span></span>
                                {{ isFull(t) ? (t.reserves?.length ? `Full · ${t.reserves.length} on reserve` : spotsLine(t)) : (t.volunteers?.length ? spotsLine(t) : `nobody yet · ${spotsLine(t)}`) }}
                            </span>
                        </span>
                    </div>
                    <button
                        v-if="standing(t) === 'on'"
                        type="button"
                        class="exv__claim exv__claim--ghost"
                        :aria-label="`Open ${t.title}`"
                        data-test="mine"
                        @click="open(t, $event)"
                    >Can't make it</button>
                    <button
                        v-else-if="standing(t) !== 'none'"
                        type="button"
                        class="exv__claim exv__claim--full"
                        :aria-label="`Open ${t.title}`"
                        data-test="reserved"
                        @click="open(t, $event)"
                    >Reserve ✓</button>
                    <button
                        v-else-if="isFull(t)"
                        type="button"
                        class="exv__claim exv__claim--ghost"
                        :aria-label="`Join the reserve list for ${t.title}`"
                        data-test="join-reserve"
                        @click="open(t, $event)"
                    >Join reserve</button>
                    <button
                        v-else
                        type="button"
                        class="exv__claim"
                        :aria-label="`I can help with ${t.title}`"
                        data-test="claim"
                        @click="open(t, $event)"
                    >I can help</button>
                </li>
            </ul>

            <p v-if="tab === 'tasks' && (laterText || eventCount)" class="exv__foot">
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
    --exv-good: #8fd99a;
    --exv-good-soft: rgb(143 217 154 / 0.18);
    --exv-bad: #ff8a80;
    --exv-bad-soft: rgb(255 138 128 / 0.18);
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
.exv__label {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ex-muted);
}
.exv__btn {
    min-height: 44px;
    padding: 8px 14px;
    border: 2px solid var(--ex-accent);
    border-radius: var(--ex-r-control);
    background: var(--ex-accent);
    color: var(--ex-on-accent);
    font: inherit;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
}
.exv__btn--block { flex: 1; width: 100%; }
.exv__btn--quiet { background: transparent; border-color: var(--ex-line); color: var(--ex-fg); }
.exv__btn--sm { min-height: 36px; padding: 4px 10px; font-size: 12px; }
.exv__btn:disabled { opacity: 0.7; cursor: progress; }
.exv__row { display: flex; gap: 8px; }

/* Faces */
.exv__faces { display: inline-flex; margin-right: 6px; vertical-align: middle; }
.exv__face {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-right: -6px;
    border: 2px solid var(--ex-surface);
    border-radius: 50%;
    background: #4f7f4a;
    color: #fff;
    font-size: 9px;
    font-weight: 800;
    line-height: 1;
}
.exv__face--xs { width: 18px; height: 18px; font-size: 8px; margin-right: -5px; }
.exv__face--lg { width: 28px; height: 28px; font-size: 11px; margin-right: 0; border: 0; }

/* Desktop: a column of cards down each side; the tray gets the bottom 40%. */
.exv__col {
    position: absolute;
    top: var(--ex-gutter);
    width: min(300px, calc(100% - 2 * var(--ex-gutter)));
    max-height: calc(60% - 2 * var(--ex-gutter));
    display: grid;
    align-content: start;
    gap: 8px;
    pointer-events: none;
}
.exv__col--left { left: var(--ex-gutter); }
.exv__col--right { right: var(--ex-gutter); }
.exv__col .exv__card { position: relative; min-width: 0; }

/* Header card */
.exv__header {
    display: grid;
    gap: 6px;
    padding: 14px 16px 12px;
}
.exv__header-health { display: none; margin: 0; font-size: 12px; font-weight: 600; color: var(--ex-muted); }
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
.exv__manage:hover { background: var(--ex-sunken); }

/* Health card */
.exv__health {
    display: grid;
    gap: 6px;
    padding: 12px 14px;
}
.exv__badge {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 800;
    background: var(--ex-sunken);
    color: var(--ex-fg);
}
.exv__badge.is-thriving { background: var(--exv-good-soft); color: var(--exv-good); }
.exv__badge.is-steady { background: var(--ex-help-soft); color: var(--ex-help); }
.exv__badge.is-needs { background: var(--exv-bad-soft); color: var(--exv-bad); }
.exv__streak { display: flex; align-items: baseline; gap: 8px; }
.exv__streak b { font-size: 30px; line-height: 1; font-weight: 800; }
.exv__streak span { font-size: 13px; font-weight: 600; color: var(--ex-muted); }
.exv__days { display: grid; grid-template-columns: repeat(14, 1fr); gap: 4px; margin-top: 4px; }
.exv__days i { display: block; height: 16px; border-radius: 4px; background: var(--ex-line); }
.exv__days i.is-done { background: var(--exv-good); }
.exv__days i.is-part { background: var(--ex-help); }
.exv__days i.is-miss { background: var(--exv-bad); opacity: 0.85; }
.exv__days i.is-pending { background: var(--ex-line); outline: 1.5px dashed var(--ex-muted); outline-offset: -2px; }
.exv__days i.is-today { outline: 2px solid var(--ex-fg); outline-offset: 1px; }
.exv__days-label { display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; color: var(--ex-muted); }
.exv__stat { display: flex; justify-content: space-between; gap: 8px; margin: 4px 0 0; padding-top: 8px; border-top: 1px solid var(--ex-line); font-size: 13px; color: var(--ex-muted); }
.exv__stat b { color: var(--ex-fg); text-align: right; }
.exv__nudge { margin: 0; font-size: 13px; color: var(--ex-muted); }
.exv__nudge.is-needs { color: var(--ex-fg); }
.exv__legend { display: grid; gap: 4px; margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--ex-line); font-size: 12px; color: var(--ex-muted); }
.exv__legend span { display: flex; align-items: center; gap: 8px; }
.exv__legend i { display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 2.5px solid var(--ex-help); }
.exv__legend i.is-done { border-color: var(--exv-good); background: var(--exv-good); }
.exv__legend i.is-me { border-color: #fff; box-shadow: 0 0 0 2px rgb(255 255 255 / 0.4); }
.exv__legend b { color: var(--ex-fg); }

/* Next workday card */
.exv__next {
    display: grid;
    gap: 8px;
    padding: 12px 14px;
}
.exv__next-row { display: grid; gap: 8px; }
.exv__next-link { display: grid; gap: 1px; color: inherit; text-decoration: none; }
.exv__next-link:hover .exv__title { text-decoration: underline; }
.exv__when { font-size: var(--ex-t-meta); font-weight: 600; color: var(--ex-muted); }
.exv__title { font-size: 16px; font-weight: 700; line-height: 1.25; text-wrap: balance; }
.exv__rsvp-row { display: flex; gap: 8px; align-items: center; }
.exv__rsvp {
    flex: 1;
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
.exv__rsvp.is-going { background: transparent; color: var(--ex-accent); cursor: default; }
.exv__rsvp:disabled:not(.is-going) { opacity: 0.7; cursor: progress; }
.exv__going { display: flex; align-items: center; gap: 4px; margin: 0; font-size: 12px; color: var(--ex-muted); }
.exv__later { display: grid; gap: 2px; margin: 0; padding: 8px 0 0; border-top: 1px solid var(--ex-line); list-style: none; }
.exv__later li, .exv__task, .exv__person { margin: 0; padding: 0; list-style: none; }
.exv__later a { display: flex; justify-content: space-between; gap: 10px; padding: 4px 0; color: inherit; font-size: 14px; text-decoration: none; }
.exv__later a:hover span:first-child { text-decoration: underline; }
.exv__meta { flex: none; font-size: var(--ex-t-meta); color: var(--ex-muted); }
.exv__link { justify-self: start; font-size: var(--ex-t-meta); font-weight: 700; color: var(--ex-accent); text-decoration: none; }
.exv__link:hover { text-decoration: underline; }
.exv__link--btn { padding: 0; border: 0; background: transparent; font: inherit; font-size: var(--ex-t-meta); font-weight: 700; cursor: pointer; }

/* People card */
.exv__people {
    display: grid;
    gap: 6px;
    padding: 12px 14px;
    min-height: 0;
    overflow: auto;
}
.exv__plist { display: grid; margin: 0; padding: 0; }
.exv__person { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-top: 1px solid var(--ex-line); font-size: 13px; }
.exv__person:first-child { border-top: 0; }
.exv__person.is-me { margin: 0 -8px; padding-left: 8px; padding-right: 8px; border-radius: 10px; border-top-color: transparent; background: rgb(130 199 173 / 0.08); }
.exv__person.is-focus { box-shadow: inset 0 0 0 2px var(--ex-ring); border-radius: 10px; }
.exv__person-text { display: grid; min-width: 0; flex: 1; }
.exv__person-text b { font-size: 13px; }
.exv__person-text small { font-size: 11px; color: var(--ex-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.exv__pill { flex: none; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 800; background: var(--ex-line); color: var(--ex-fg); }
.exv__pill.is-done, .exv__pill.is-doneToday { background: var(--exv-good-soft); color: var(--exv-good); }
.exv__pill.is-signedUp, .exv__pill.is-going { background: var(--ex-help-soft); color: var(--ex-help); }
.exv__pill.is-dropped { background: transparent; border: 1px solid var(--ex-line); color: var(--ex-muted); }

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
.exv__grab { display: none; }
.exv__summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; }
.exv__sum { display: grid; font-size: var(--ex-t-body); font-weight: 700; }
.exv__sub { display: none; font-size: var(--ex-t-meta); font-weight: 600; color: var(--ex-muted); }
.exv__dot { display: inline-block; width: 9px; height: 9px; margin-right: 7px; border-radius: 50%; background: var(--ex-help); vertical-align: 1px; }
.exv__dot.is-needs { background: var(--exv-bad); }
.exv__show { display: none; min-height: 44px; padding: 0 8px; border: 0; background: transparent; color: var(--ex-accent); font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
.exv__tabs { display: none; gap: 16px; font-size: 13px; font-weight: 800; }
.exv__tabs button { padding: 0 0 4px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--ex-muted); font: inherit; font-weight: 800; cursor: pointer; min-height: 32px; }
.exv__tabs button.is-on { color: var(--ex-fg); border-bottom-color: var(--ex-accent); }
.exv__list { display: flex; gap: 8px; margin: 0; padding: 0 0 4px; overflow-x: auto; list-style: none; scrollbar-width: thin; }
.exv__task { flex: none; display: flex; align-items: center; gap: 12px; padding: 6px 8px 6px 12px; border-radius: var(--ex-r-control); background: var(--ex-sunken); }
.exv__task.is-mine { box-shadow: inset 0 0 0 1.5px var(--ex-accent); }
.exv__task-text { display: grid; min-width: 0; }
.exv__task-title { font-size: 14px; font-weight: 700; white-space: nowrap; }
.exv__task-sub { display: grid; }
.exv__task-when { font-size: 11px; font-weight: 600; color: var(--ex-muted); }
.exv__task-when.is-overdue { color: var(--exv-bad); }
.exv__spots { margin: 0; font-size: var(--ex-t-meta); font-weight: 600; color: var(--ex-help); white-space: nowrap; }
.exv__spots.is-full { color: var(--ex-muted); }
.exv__spots.is-mine { color: var(--exv-good); }
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
.exv__claim--ghost { background: transparent; color: var(--ex-accent); }
.exv__claim--full { border-color: var(--ex-line); background: transparent; color: var(--ex-muted); }
.exv__one { position: relative; display: grid; gap: 6px; max-width: 440px; padding-right: 36px; }
.exv__close { position: absolute; top: -6px; right: -6px; min-width: 44px; min-height: 44px; border: 0; background: transparent; color: var(--ex-muted); font: inherit; font-size: 18px; font-weight: 700; cursor: pointer; }
.exv__close:hover { color: var(--ex-fg); }
.exv__one-title { margin: 0; font-size: 17px; font-weight: 800; }
.exv__overview { margin: 0; font-size: 13px; color: var(--ex-muted); }
.exv__note { padding: 8px 10px; border-radius: 10px; background: var(--ex-sunken); font-size: 13px; }
.exv__note b { color: var(--exv-good); }
.exv__confirm { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--ex-line); border-radius: 12px; }
.exv__confirm p { margin: 0; font-size: 13px; }
.exv__fine { margin: 0; font-size: 11px; color: var(--ex-muted); }
.exv__foot { display: none; margin: 0; padding-top: 8px; border-top: 1px solid var(--ex-line); font-size: 14px; font-weight: 600; color: var(--ex-muted); }
.exv__foot a { color: var(--ex-accent); font-weight: 700; text-decoration: none; }

/* Figures on the island */
.exv__figures { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
.exv__fig {
    position: absolute;
    width: 0;
    height: 0;
    padding: 0;
    border: 0;
    background: transparent;
    pointer-events: auto;
    cursor: pointer;
    transition: opacity 200ms ease;
}
.exv__fig.is-hidden { opacity: 0; pointer-events: none; }
.exv__fig.is-back { opacity: 0.55; }
.exv__fig-shadow { position: absolute; left: -13px; top: 14px; width: 26px; height: 7px; border-radius: 50%; background: rgb(0 0 0 / 0.28); }
.exv__fig-body { position: absolute; left: -10px; top: -6px; width: 20px; height: 24px; border-radius: 10px 10px 6px 6px; background: #4f7f4a; }
.exv__fig-head {
    position: absolute;
    left: -14px;
    top: -34px;
    width: 28px;
    height: 28px;
    border: 2.5px solid var(--ex-help);
    border-radius: 50%;
    background: #4f7f4a;
    color: #fff;
    font-size: 10px;
    font-weight: 800;
    line-height: 23px;
    text-align: center;
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.35);
}
.exv__fig.is-done .exv__fig-head { border-color: var(--exv-good); }
.exv__fig.is-done .exv__fig-head::after {
    content: '✓';
    position: absolute;
    right: -7px;
    top: -7px;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: var(--exv-good);
    color: #10140e;
    font-size: 10px;
    line-height: 15px;
    font-weight: 900;
}
.exv__fig.is-me .exv__fig-head { border-color: #fff; box-shadow: 0 0 0 3px rgb(255 255 255 / 0.45), 0 2px 6px rgb(0 0 0 / 0.35); }
.exv__fig.is-focus .exv__fig-head { box-shadow: 0 0 0 4px var(--ex-ring); }
.exv__fig-tip {
    position: absolute;
    left: -95px;
    bottom: 44px;
    width: 190px;
    padding: 8px 10px;
    border-radius: 12px;
    background: var(--ex-surface);
    color: var(--ex-fg);
    font-size: 12px;
    text-align: left;
    box-shadow: var(--ex-shadow);
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease;
}
.exv__fig-tip b { display: block; font-size: 13px; }
.exv__fig-tip span { color: var(--ex-muted); }
.exv__fig-tip span.is-signedUp, .exv__fig-tip span.is-going { color: var(--ex-help); }
.exv__fig-tip span.is-done, .exv__fig-tip span.is-doneToday { color: var(--exv-good); }
.exv__fig:hover .exv__fig-tip, .exv__fig:focus-visible .exv__fig-tip, .exv__fig.is-focus .exv__fig-tip { opacity: 1; }
.exv__fig-more {
    position: absolute;
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--ex-surface);
    color: var(--ex-fg);
    font-size: 11px;
    font-weight: 800;
    box-shadow: var(--ex-shadow);
}

/* Phone: chips at the top, a bottom sheet for tasks and people */
@media (max-width: 640px) {
    /* The columns dissolve: each card positions itself against the stage again. */
    .exv__col { display: contents; }
    .exv__col .exv__card { position: absolute; }
    .exv__header { top: var(--ex-gutter); left: var(--ex-gutter); right: var(--ex-gutter); width: auto; padding: 10px 12px; }
    .exv__header :deep(h2) { font-size: 15px; }
    .exv__header :deep(.explore-sheet__blurb) { display: none; }
    .exv__header-health { display: block; }
    .exv__health, .exv__people { display: none; }
    .exv__next { top: auto; bottom: 118px; left: var(--ex-gutter); right: var(--ex-gutter); width: auto; padding: 10px 12px; }
    .exv:not(.has-tasks) .exv__next { bottom: var(--ex-gutter); }
    .exv__next-row { grid-template-columns: 1fr auto; align-items: center; }
    .exv__rsvp-row { flex-direction: column; align-items: stretch; gap: 4px; }
    .exv__title { font-size: 14px; }
    .exv__later, .exv__link, .exv__going { display: none; }
    .exv.has-tasks:not(.is-peek) .exv__next { display: none; }
    .exv__help { left: 0; right: 0; bottom: 0; max-height: none; padding: 6px 16px 20px; border-radius: var(--ex-r-surface) var(--ex-r-surface) 0 0; transition: max-height 240ms ease; }
    .exv__grab { display: block; width: 100%; min-height: 24px; padding: 6px 0; border: 0; background: transparent; cursor: grab; touch-action: none; }
    .exv__grab span { display: block; width: 44px; height: 5px; margin: 0 auto; border-radius: 3px; background: var(--ex-muted); opacity: 0.6; }
    .exv__show, .exv__sub { display: block; }
    .exv:not(.is-peek) .exv__tabs { display: flex; }
    .exv.is-peek .exv__list, .exv.is-peek .exv__one, .exv.is-peek .exv__foot, .exv.is-peek .exv__plist--sheet { display: none; }
    .exv.is-half .exv__help { max-height: 60%; }
    .exv.is-full .exv__help { max-height: 88%; }
    .exv__list { flex-direction: column; gap: 0; overflow: visible; }
    .exv__task { display: flex; min-height: 64px; padding: 10px 0; border-top: 1px solid var(--ex-line); border-radius: 0; background: transparent; }
    .exv__task.is-mine { box-shadow: none; }
    .exv__task-title { font-size: 16px; white-space: normal; }
    .exv__claim { padding: 8px 16px; font-size: 15px; }
    .exv__one { max-width: none; padding-top: 4px; }
    .exv__one-title { font-size: 18px; }
    .exv__spots { font-size: 14px; white-space: normal; }
    .exv__person { min-height: 56px; }
    .exv__person-text b { font-size: 15px; }
    .exv__foot { display: block; }
    .exv__fig-head { width: 24px; height: 24px; left: -12px; top: -30px; font-size: 9px; line-height: 19px; }
    .exv__fig-body { width: 16px; height: 20px; left: -8px; }
    .exv__fig-tip { display: none; }
}

.exv button:focus-visible, .exv a:focus-visible { outline: 2px solid var(--ex-ring); outline-offset: 2px; }

@keyframes exv-rise {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
    .exv__card, .exv__fig { animation: none; transition: none; }
}
</style>
