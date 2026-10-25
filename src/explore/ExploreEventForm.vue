<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useEventStore } from '@/stores';
import { START_TIMES, endTimesAfter, localParts, parseTimeLabel, snapToQuarter, timeLabel } from './time-options';

// Add or edit one workday from the Explore island sheet. Everything else
// (SMS, interests, tasks, photos) stays in the full editor.

const props = defineProps({
    gardenId: { type: Number, required: true },
    /** The workday to edit, or null to add one. */
    event: { type: Object, default: null }
});
const emit = defineEmits(['saved', 'cancel']);

const eventStore = useEventStore();
const titleEl = ref(null);

const today = localParts(new Date().toISOString()).date;
const start = props.event?.startDatetime ? localParts(props.event.startDatetime) : null;
const form = ref({
    title: props.event?.title || '',
    date: start?.date || today,
    time: start ? snapToQuarter(start.time) : '09:00',
    end: parseTimeLabel(props.event?.endText) || (props.event ? '' : '11:00'),
    blurb: props.event?.blurb || '',
    canceled: !!props.event?.canceled
});
// An end time that isn't one of our labels ("Noon-ish") is kept as typed unless the manager changes it.
const customEnd = props.event?.endText && !parseTimeLabel(props.event.endText) ? props.event.endText : '';
const showDetails = ref(!!form.value.blurb);
const saving = ref(false);
const error = ref('');

const endOptions = computed(() => endTimesAfter(form.value.time));

// The end follows the start when it moves, keeping the same length.
watch(() => form.value.time, (next, prev) => {
    if (!form.value.end || !prev) return;
    const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const length = toMin(form.value.end) - toMin(prev);
    const end = toMin(next) + Math.max(15, length);
    const value = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
    form.value.end = endOptions.value.some(o => o.value === value) ? value : '';
});

async function save() {
    error.value = '';
    if (!form.value.title.trim()) {
        error.value = 'Give the workday a name.';
        return;
    }
    const startDatetime = new Date(`${form.value.date}T${form.value.time}`);
    if (Number.isNaN(startDatetime.getTime())) {
        error.value = 'Pick a date.';
        return;
    }
    const data = {
        title: form.value.title.trim(),
        startDatetime: startDatetime.toISOString(),
        endText: form.value.end ? timeLabel(form.value.end) : customEnd || null,
        blurb: form.value.blurb.trim() || null,
        garden: props.gardenId
    };
    if (props.event) data.canceled = form.value.canceled;
    saving.value = true;
    try {
        if (props.event) await eventStore.update(props.event.documentId ?? props.event.id, data);
        else await eventStore.register(data);
        emit('saved');
    } catch (e) {
        // The store already raised an alert; keep the form open with what was typed.
        error.value = "Couldn't save the workday. Try again in a moment.";
    } finally {
        saving.value = false;
    }
}

onMounted(() => titleEl.value?.focus());
</script>

<template>
    <form class="ex-form" @submit.prevent="save" @keydown.esc.stop="emit('cancel')">
        <p class="ex-form__title">{{ event ? 'Edit workday' : 'New workday' }}</p>
        <label>
            <span>What</span>
            <input ref="titleEl" v-model="form.title" type="text" maxlength="120" placeholder="Work day, harvest, workshop…" required />
        </label>
        <label>
            <span>Date</span>
            <input v-model="form.date" type="date" required />
        </label>
        <div class="ex-form__row">
            <label>
                <span>From</span>
                <select v-model="form.time">
                    <option v-for="t in START_TIMES" :key="t.value" :value="t.value">{{ t.label }}</option>
                </select>
            </label>
            <label>
                <span>To</span>
                <select v-model="form.end">
                    <option value="">{{ customEnd || 'Any time' }}</option>
                    <option v-for="t in endOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
                </select>
            </label>
        </div>
        <button v-if="!showDetails" type="button" class="ex-form__more" @click="showDetails = true">+ Add details</button>
        <label v-else>
            <span>Details</span>
            <textarea v-model="form.blurb" rows="3" maxlength="500" placeholder="What to bring, where to meet…"></textarea>
        </label>
        <label v-if="event" class="ex-form__check">
            <input v-model="form.canceled" type="checkbox" />
            <span>Canceled — keep it listed, tagged so people know not to come</span>
        </label>
        <p v-if="error" class="ex-form__error" role="alert">{{ error }}</p>
        <div class="ex-form__actions">
            <button type="submit" class="ex-form__save" :disabled="saving">{{ saving ? 'Saving…' : event ? 'Save changes' : 'Add workday' }}</button>
            <button type="button" class="ex-form__cancel" @click="emit('cancel')">Cancel</button>
            <router-link v-if="event" :to="{ name: 'manage-event-edit', params: { id: event.id } }" class="ex-form__full">Full editor →</router-link>
        </div>
    </form>
</template>

<style src="./explore-form.css"></style>
