<script setup>
import { computed, nextTick, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore, useGardenTaskStore } from '@/stores';

// One task on the Explore island sheet. Tapping it opens the details and a
// phone sign-up right there, the same request the task page's phone modal makes.

const props = defineProps({
    task: { type: Object, required: true },
    gardenSlug: { type: String, required: true },
    /** Managers get an Edit button and see why a task is hidden. */
    canEdit: { type: Boolean, default: false },
    statusTag: { type: String, default: '' },
    open: { type: Boolean, default: false }
});
const emit = defineEmits(['toggle', 'edit', 'signed-up']);

const taskStore = useGardenTaskStore();
const { user } = storeToRefs(useAuthStore());

const max = computed(() => props.task.max_volunteers || 1);
const count = computed(() => (Array.isArray(props.task.volunteers) ? props.task.volunteers.length : 0));
const full = computed(() => count.value >= max.value);
// Only tasks the public can see take sign-ups (hidden ones show up for managers only).
const signable = computed(() => !props.statusTag || props.statusTag === 'In progress');

const formatPhone = (value) => {
    const d = String(value || '').replace(/\D/g, '').slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

const phone = ref(formatPhone(user.value?.phoneNumber));
const phoneEl = ref(null);
const sending = ref(false);
const error = ref('');
const done = ref(''); // confirmation text once the request went through

async function toggle() {
    emit('toggle');
    await nextTick();
    if (!props.open) return;
    phoneEl.value?.focus({ preventScroll: true });
}

async function signUp() {
    error.value = '';
    const digits = phone.value.replace(/\D/g, '');
    if (digits.length !== 10) {
        error.value = 'Enter a 10-digit phone number.';
        return;
    }
    sending.value = true;
    try {
        const res = await taskStore.assignTaskViaSMS(props.task.id, digits);
        done.value = res?.success === true
            ? "Found your account — we'll text you to confirm."
            : 'Check your phone for a text to confirm your spot.';
        emit('signed-up');
    } catch (e) {
        // The store already raised an alert.
        error.value = "Couldn't sign you up. Try again in a moment.";
    } finally {
        sending.value = false;
    }
}
</script>

<template>
    <div class="ex-task" :class="{ 'is-open': open }">
        <div class="ex-task__head">
            <button type="button" class="ex-task__toggle" :aria-expanded="open" @click="toggle">
                <span class="ex-task__title">{{ task.title }}</span>
                <span class="ex-task__meta" :class="{ 'is-open': signable && !full }">
                    <span v-if="statusTag" class="ex-task__tag">{{ statusTag }}</span>
                    {{ count }} of {{ max }} {{ max === 1 ? 'volunteer' : 'volunteers' }}
                </span>
            </button>
            <button v-if="canEdit" type="button" class="ex-task__edit" :aria-label="`Edit ${task.title}`" @click="emit('edit')">Edit</button>
        </div>

        <div v-if="open" class="ex-task__body">
            <p v-if="task.overview" class="ex-task__overview">{{ task.overview }}</p>

            <p v-if="done" class="ex-task__done" role="status">✓ {{ done }}</p>
            <p v-else-if="!signable" class="ex-task__note">Hidden from volunteers until it has a status. Edit it to open sign-ups.</p>
            <p v-else-if="full" class="ex-task__note">This task is full.</p>
            <form v-else class="ex-task__signup" @submit.prevent="signUp">
                <label class="ex-task__label" :for="`ex-phone-${task.id}`">Your phone number</label>
                <div class="ex-task__row">
                    <input
                        :id="`ex-phone-${task.id}`"
                        ref="phoneEl"
                        :value="phone"
                        type="tel"
                        inputmode="tel"
                        autocomplete="tel-national"
                        placeholder="(555) 123-4567"
                        @input="phone = formatPhone($event.target.value)"
                    />
                    <button type="submit" :disabled="sending">{{ sending ? 'Signing up…' : 'Sign up' }}</button>
                </div>
                <p class="ex-task__fine">We'll text you to confirm. Reply STOP any time.</p>
                <p v-if="error" class="ex-task__error" role="alert">{{ error }}</p>
            </form>

            <router-link :to="{ name: 'task-detail-public', params: { slug: gardenSlug, taskId: task.id } }" class="ex-task__more">
                Task details →
            </router-link>
        </div>
    </div>
</template>

<style scoped>
.ex-task {
    border-radius: 12px;
    transition: background 160ms ease;
}
.ex-task.is-open {
    background: rgb(127 176 90 / 0.12);
}
.ex-task__head {
    display: flex;
    align-items: center;
    gap: 4px;
}
.ex-task__toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap; /* the count (and a manager's status tag) drops below a long name instead of squeezing it */
    justify-content: space-between;
    align-items: baseline;
    gap: 2px 10px;
    padding: 7px 10px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--ex-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.ex-task__toggle:hover {
    background: rgb(127 176 90 / 0.18);
}
.ex-task__title {
    flex: 1 1 8em;
    min-width: 0;
}
.ex-task__meta {
    flex: none;
    margin-left: auto;
    white-space: nowrap;
    font-size: 12px;
    color: var(--ex-muted);
}
.ex-task__meta.is-open {
    padding: 1px 8px;
    border-radius: 999px;
    background: rgb(255 207 63 / 0.4);
    color: var(--ex-fg);
    font-weight: 600;
}
.ex-task__tag {
    margin-right: 6px;
    padding: 1px 6px;
    border-radius: 6px;
    background: var(--ex-line);
    color: var(--ex-muted);
    font-weight: 600;
}
.ex-task__edit {
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
.ex-task__edit:hover {
    background: rgb(127 176 90 / 0.18);
}
.ex-task__body {
    display: grid;
    gap: 8px;
    padding: 2px 10px 12px;
}
.ex-task__overview {
    margin: 0;
    font-size: 14px;
    color: var(--ex-fg);
}
.ex-task__label {
    font-size: 12px;
    font-weight: 600;
    color: var(--ex-muted);
}
.ex-task__signup {
    display: grid;
    gap: 4px;
}
.ex-task__row {
    display: flex;
    gap: 6px;
}
.ex-task__row input {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--ex-line);
    border-radius: 10px;
    background: var(--ex-surface);
    color: var(--ex-fg);
    font: inherit;
    font-size: 14px;
}
.ex-task__row button {
    flex: none;
    padding: 8px 14px;
    border: 0;
    border-radius: 10px;
    background: var(--ex-accent);
    color: var(--ex-surface);
    font-weight: 700;
    font-size: 14px;
    cursor: pointer;
}
.ex-task__row button:disabled {
    opacity: 0.7;
    cursor: progress;
}
.ex-task__fine,
.ex-task__note {
    margin: 0;
    font-size: 12px;
    color: var(--ex-muted);
}
.ex-task__done {
    margin: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgb(127 176 90 / 0.25);
    font-size: 14px;
    font-weight: 600;
}
.ex-task__error {
    margin: 0;
    font-size: 13px;
    color: #c0392b;
}
:root.dark .ex-task__error {
    color: #ff8a80;
}
.ex-task__more {
    justify-self: start;
    font-size: 12px;
    font-weight: 600;
    color: var(--ex-accent);
    text-decoration: none;
}
.ex-task__more:hover {
    text-decoration: underline;
}
.ex-task button:focus-visible,
.ex-task input:focus-visible,
.ex-task a:focus-visible {
    outline: 3px solid var(--ex-pick);
    outline-offset: 1px;
}
</style>
