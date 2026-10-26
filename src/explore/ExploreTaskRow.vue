<script setup>
import { computed } from 'vue';
import ExploreTaskSignup from '@/explore/ExploreTaskSignup.vue';
import { countOf, isFull, maxOf } from '@/explore/volunteer';

// One task on the manager's Explore sheet. Tapping it opens the details and a
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

const max = computed(() => maxOf(props.task));
const count = computed(() => countOf(props.task));
const full = computed(() => isFull(props.task));
// Only tasks the public can see take sign-ups (hidden ones show up for managers only).
const signable = computed(() => !props.statusTag || props.statusTag === 'In progress');
</script>

<template>
    <div class="ex-task" :class="{ 'is-open': open }">
        <div class="ex-task__head">
            <button type="button" class="ex-task__toggle" :aria-expanded="open" @click="emit('toggle')">
                <span class="ex-task__title">{{ task.title }}</span>
                <span class="ex-task__meta" :class="{ 'is-open': signable && !full }">
                    <span v-if="statusTag" class="ex-task__tag">{{ statusTag }}</span>
                    {{ count }} of {{ max }} {{ max === 1 ? 'volunteer' : 'volunteers' }}
                </span>
            </button>
            <button v-if="canEdit" type="button" class="ex-task__edit" :aria-label="`Edit ${task.title}`" @click="emit('edit')">Edit</button>
        </div>

        <div v-if="open" class="ex-task__body">
            <ExploreTaskSignup :task="task" :garden-slug="gardenSlug" :signable="signable" @signed-up="emit('signed-up')" />
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
    padding: 2px 10px 12px;
}
.ex-task button:focus-visible {
    outline: 3px solid var(--ex-pick);
    outline-offset: 1px;
}
</style>
