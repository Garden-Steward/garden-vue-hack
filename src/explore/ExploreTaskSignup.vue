<script setup>
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore, useGardenTaskStore } from '@/stores';
import { isFull } from '@/explore/volunteer';

// The sign-up for one task: its overview, a phone field and the SMS request
// the task page's phone modal makes. The manager's task row, the volunteer
// tray and the phone sheet all render this one form.

const props = defineProps({
    task: { type: Object, required: true },
    gardenSlug: { type: String, required: true },
    /** Only tasks the public can see take sign-ups; a manager sees why a hidden one doesn't. */
    signable: { type: Boolean, default: true },
    /** Focus the phone field when the form appears. */
    autofocus: { type: Boolean, default: true },
    /** Stack the field over a full-width button (phone sheet) instead of side by side. */
    stacked: { type: Boolean, default: false }
});
const emit = defineEmits(['signed-up']);

const taskStore = useGardenTaskStore();
const { user } = storeToRefs(useAuthStore());

const full = computed(() => isFull(props.task));

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

onMounted(() => {
    if (props.autofocus) phoneEl.value?.focus({ preventScroll: true });
});

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

defineExpose({ focus: () => phoneEl.value?.focus({ preventScroll: true }) });
</script>

<template>
    <div class="ex-signup" :class="{ 'is-stacked': stacked }">
        <p v-if="task.overview" class="ex-signup__overview">{{ task.overview }}</p>

        <p v-if="done" class="ex-signup__done" role="status">✓ {{ done }}</p>
        <p v-else-if="!signable" class="ex-signup__note">Hidden from volunteers until it has a status. Edit it to open sign-ups.</p>
        <p v-else-if="full" class="ex-signup__note">This task is full.</p>
        <form v-else class="ex-signup__form" @submit.prevent="signUp">
            <label class="ex-signup__label" :for="`ex-phone-${task.id}`">Your phone number</label>
            <div class="ex-signup__row">
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
            <p class="ex-signup__fine">We'll text you to confirm. Reply STOP any time.</p>
            <p v-if="error" class="ex-signup__error" role="alert">{{ error }}</p>
        </form>

        <router-link :to="{ name: 'task-detail-public', params: { slug: gardenSlug, taskId: task.id } }" class="ex-signup__more">
            Task details →
        </router-link>
    </div>
</template>

<style scoped>
.ex-signup {
    display: grid;
    gap: 8px;
}
.ex-signup__overview {
    margin: 0;
    font-size: 14px;
    color: var(--ex-fg);
}
.ex-signup__label {
    font-size: 12px;
    font-weight: 600;
    color: var(--ex-muted);
}
.ex-signup__form {
    display: grid;
    gap: 4px;
}
.ex-signup__row {
    display: flex;
    gap: 6px;
}
.ex-signup__row input {
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
.ex-signup__row button {
    flex: none;
    padding: 8px 14px;
    border: 0;
    border-radius: 10px;
    background: var(--ex-accent);
    color: var(--ex-on-accent, var(--ex-surface));
    font-weight: 700;
    font-size: 14px;
    cursor: pointer;
}
.ex-signup__row button:disabled {
    opacity: 0.7;
    cursor: progress;
}
/* Phone sheet: a tall field over a full-width button, 44px+ targets. */
.ex-signup.is-stacked .ex-signup__label {
    font-size: 13px;
}
.ex-signup.is-stacked .ex-signup__row {
    flex-direction: column;
    gap: 10px;
}
.ex-signup.is-stacked .ex-signup__row input {
    min-height: 48px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--ex-sunken);
    font-size: 18px;
}
.ex-signup.is-stacked .ex-signup__row button {
    min-height: 48px;
    border-radius: 14px;
    font-size: 16px;
}
.ex-signup__fine,
.ex-signup__note {
    margin: 0;
    font-size: 12px;
    color: var(--ex-muted);
}
.ex-signup__done {
    margin: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgb(127 176 90 / 0.25);
    font-size: 14px;
    font-weight: 600;
}
.ex-signup__error {
    margin: 0;
    font-size: 13px;
    color: #c0392b;
}
:root.dark .ex-signup__error {
    color: #ff8a80;
}
.ex-signup__more {
    justify-self: start;
    font-size: 12px;
    font-weight: 600;
    color: var(--ex-accent);
    text-decoration: none;
}
.ex-signup__more:hover {
    text-decoration: underline;
}
.ex-signup button:focus-visible,
.ex-signup input:focus-visible,
.ex-signup a:focus-visible {
    outline: 3px solid var(--ex-pick);
    outline-offset: 1px;
}
</style>
