<script setup>
import { computed, onMounted, ref } from 'vue';
import { useGardenTaskStore } from '@/stores';
import { FREQUENCIES, TYPE_NAMES, WEEKDAYS, isDueOn, repeatSummary, usesDays, usesStart } from './repeat';
import { localParts } from './time-options';

// Add or edit garden tasks from the Explore island sheet.
//
// A NEW task is a repeating one: pick its type, how often and on which days,
// and how many volunteers. It's saved as a recurring task, which the backend's
// daily cron turns into that day's task on the days it repeats; if it's due
// today, today's task is made right away so it shows up now.
//
// EDITING changes one existing task (name, type, volunteers, what to do,
// status). Photos, instructions and schedulers stay in the full editor.

const TASK_TYPES = ['Water', 'Weeding', 'Planting', 'Harvest', 'General']; // as in the GardenTask modal
const STATUSES = [
    { value: 'INITIALIZED', label: 'Ready — open for sign-ups' },
    { value: 'IN_PROGRESS', label: 'In progress' },
    { value: 'FINISHED', label: 'Done' }
];

const props = defineProps({
    gardenId: { type: Number, required: true },
    gardenSlug: { type: String, required: true },
    /** The task to edit, or null to add a repeating one. */
    task: { type: Object, default: null }
});
const emit = defineEmits(['saved', 'cancel']);

const taskStore = useGardenTaskStore();
const firstEl = ref(null);
const saving = ref(false);
const error = ref('');

// ── New repeating task ──
const today = localParts(new Date().toISOString()).date;
const repeat = ref({
    type: 'Water',
    frequency: 'weekly',
    days: [],
    start: today,
    volunteers: 1
});
const summary = computed(() => repeatSummary({
    repeat_frequency: repeat.value.frequency,
    repeat_days: repeat.value.days,
    repeat_start: repeat.value.start
}));

function toggleDay(day) {
    const days = repeat.value.days;
    repeat.value.days = days.includes(day) ? days.filter(d => d !== day) : [...days, day];
}

async function saveRepeat() {
    error.value = '';
    const r = repeat.value;
    if (usesDays(r.frequency) && !r.days.length) {
        error.value = 'Pick at least one day.';
        return;
    }
    if (usesStart(r.frequency) && !r.start) {
        error.value = 'Pick a start date.';
        return;
    }
    const volunteers = Math.round(Number(r.volunteers));
    if (!(volunteers >= 1 && volunteers <= 20)) {
        error.value = 'Volunteers needed is between 1 and 20.';
        return;
    }
    const schedule = {
        repeat_frequency: r.frequency,
        repeat_days: usesDays(r.frequency) ? WEEKDAYS.filter(d => r.days.includes(d)) : null,
        repeat_start: usesStart(r.frequency) ? r.start : null
    };
    const title = TYPE_NAMES[r.type] || r.type;
    saving.value = true;
    // The store raises its own alert and resolves empty on failure.
    const template = await taskStore.registerRecurring({
        title,
        type: r.type,
        max_volunteers: volunteers,
        complete_once: true,
        scheduler_type: 'No Schedule',
        garden: props.gardenId,
        ...schedule
    });
    if (template && isDueOn(schedule)) {
        // The cron would make today's task at its next run; make it now so it shows up.
        await taskStore.register({
            title,
            type: r.type,
            max_volunteers: volunteers,
            task_status: 'INITIALIZED',
            priority: 'Normal',
            complete_once: true,
            garden: props.gardenId,
            recurring_task: template.documentId ?? template.id
        });
    }
    saving.value = false;
    if (template) emit('saved');
    else error.value = "Couldn't save the task. Try again in a moment.";
}

// ── Editing an existing task ──
const form = ref({
    title: props.task?.title || '',
    type: props.task?.type || 'General',
    overview: props.task?.overview || '',
    max_volunteers: props.task?.max_volunteers || 1,
    // A task with no status isn't shown to the public; editing it here makes it Ready unless changed.
    task_status: STATUSES.some(s => s.value === props.task?.task_status) ? props.task.task_status : 'INITIALIZED'
});

async function saveEdit() {
    error.value = '';
    if (!form.value.title.trim()) {
        error.value = 'A task needs a name.';
        return;
    }
    const volunteers = Math.round(Number(form.value.max_volunteers));
    if (!(volunteers >= 1 && volunteers <= 20)) {
        error.value = 'Volunteers needed is between 1 and 20.';
        return;
    }
    saving.value = true;
    const saved = await taskStore.update(props.task.documentId ?? props.task.id, {
        title: form.value.title.trim(),
        type: form.value.type,
        overview: form.value.overview.trim() || null,
        max_volunteers: volunteers,
        task_status: form.value.task_status
    });
    saving.value = false;
    if (saved) emit('saved');
    else error.value = "Couldn't save the task. Try again in a moment.";
}

onMounted(() => firstEl.value?.focus());
</script>

<template>
    <form v-if="!task" class="ex-form" @submit.prevent="saveRepeat" @keydown.esc.stop="emit('cancel')">
        <p class="ex-form__title">New task</p>
        <div class="ex-form__row">
            <label>
                <span>Type</span>
                <select ref="firstEl" v-model="repeat.type">
                    <option v-for="t in TASK_TYPES" :key="t" :value="t">{{ t }}</option>
                </select>
            </label>
            <label>
                <span>How often</span>
                <select v-model="repeat.frequency">
                    <option v-for="f in FREQUENCIES" :key="f.value" :value="f.value">{{ f.label }}</option>
                </select>
            </label>
        </div>

        <fieldset v-if="usesDays(repeat.frequency)" class="ex-days">
            <legend>Days</legend>
            <button
                v-for="d in WEEKDAYS"
                :key="d"
                type="button"
                class="ex-days__day"
                :aria-pressed="repeat.days.includes(d)"
                :aria-label="d"
                @click="toggleDay(d)"
            >{{ d.slice(0, 1) }}</button>
        </fieldset>

        <div class="ex-form__row">
            <label v-if="usesStart(repeat.frequency)">
                <span>{{ repeat.frequency === 'biweekly' ? 'Starting the week of' : 'Starting' }}</span>
                <input v-model="repeat.start" type="date" :min="today" required />
            </label>
            <label>
                <span>Volunteers needed</span>
                <input v-model.number="repeat.volunteers" type="number" min="1" max="20" step="1" required />
            </label>
        </div>

        <p class="ex-form__summary">
            <strong>{{ TYPE_NAMES[repeat.type] }}</strong> · {{ summary }}
        </p>
        <p v-if="error" class="ex-form__error" role="alert">{{ error }}</p>
        <div class="ex-form__actions">
            <button type="submit" class="ex-form__save" :disabled="saving">{{ saving ? 'Saving…' : 'Add task' }}</button>
            <button type="button" class="ex-form__cancel" @click="emit('cancel')">Cancel</button>
        </div>
    </form>

    <form v-else class="ex-form" @submit.prevent="saveEdit" @keydown.esc.stop="emit('cancel')">
        <p class="ex-form__title">Edit task</p>
        <label>
            <span>Name</span>
            <input ref="firstEl" v-model="form.title" type="text" maxlength="120" required />
        </label>
        <div class="ex-form__row">
            <label>
                <span>Type</span>
                <select v-model="form.type">
                    <option v-for="t in TASK_TYPES" :key="t" :value="t">{{ t }}</option>
                </select>
            </label>
            <label>
                <span>Volunteers needed</span>
                <input v-model.number="form.max_volunteers" type="number" min="1" max="20" step="1" required />
            </label>
        </div>
        <label>
            <span>What to do</span>
            <textarea v-model="form.overview" rows="3" maxlength="1000" placeholder="Optional: a sentence or two volunteers will see"></textarea>
        </label>
        <label>
            <span>Status</span>
            <select v-model="form.task_status">
                <option v-for="s in STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>
        </label>
        <p v-if="error" class="ex-form__error" role="alert">{{ error }}</p>
        <div class="ex-form__actions">
            <button type="submit" class="ex-form__save" :disabled="saving">{{ saving ? 'Saving…' : 'Save changes' }}</button>
            <button type="button" class="ex-form__cancel" @click="emit('cancel')">Cancel</button>
            <router-link
                :to="{ name: 'manage-garden-detail', params: { slug: gardenSlug }, hash: '#tasks' }"
                class="ex-form__full"
            >Full editor →</router-link>
        </div>
    </form>
</template>

<style src="./explore-form.css"></style>

<style scoped>
.ex-days {
    display: flex;
    gap: 4px;
    margin: 0;
    padding: 0;
    border: 0;
}
.ex-days legend {
    width: 100%;
    margin-bottom: 4px;
    padding: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--ex-muted);
}
.ex-days__day {
    flex: 1;
    min-width: 0;
    height: 36px;
    border: 1px solid var(--ex-line);
    border-radius: 10px;
    background: transparent;
    color: var(--ex-fg);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
}
.ex-days__day:hover {
    background: var(--ex-sunken, rgb(127 176 90 / 0.12));
}
.ex-days__day[aria-pressed='true'] {
    border-color: var(--ex-accent);
    background: var(--ex-accent);
    color: var(--ex-on-accent, #fbfcf8);
}
.ex-form__summary {
    margin: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--ex-sunken, rgb(127 176 90 / 0.12));
    font-size: 13px;
}
</style>
