<!-- eslint-disable vue/multi-word-component-names -->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { layoutSchematic } from './layout.js';

const props = defineProps({
  pieces: { type: Array, default: null },
  beds: { type: Array, default: () => [] },
  options: { type: Object, default: () => ({}) },
  selected: { type: Number, default: null },
  seed: { type: String, required: true },
  emptyText: { type: String, default: 'No beds laid out yet' },
});
const emit = defineEmits(['select', 'deselect']);

const FALLBACK_BOX = { width: 800, height: 600 };
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const DRAG_PX = 4;

const root = ref(null);
const box = ref({ ...FALLBACK_BOX });
let observer = null;

function measure() {
  const el = root.value;
  const w = el?.clientWidth || 0;
  const h = el?.clientHeight || 0;
  box.value = w > 0 && h > 0 ? { width: w, height: h } : { ...FALLBACK_BOX };
}

onMounted(() => {
  measure();
  if (typeof ResizeObserver !== 'undefined' && root.value) {
    observer = new ResizeObserver(measure);
    observer.observe(root.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());

const layout = computed(() =>
  layoutSchematic({
    pieces: props.pieces,
    beds: props.beds,
    options: props.options,
    stage: box.value,
    seed: props.seed,
  }),
);

// ---- pan / zoom -----------------------------------------------------------
const view = ref({ x: 0, y: 0, k: 1 });
const fitK = ref(1);

function fitView() {
  const { width, height } = layout.value.size;
  const k = width <= box.value.width && height <= box.value.height
    ? 1
    : Math.min(box.value.width / width, box.value.height / height);
  fitK.value = k;
  view.value = {
    k,
    x: (box.value.width - width * k) / 2,
    y: (box.value.height - height * k) / 2,
  };
}
watch(layout, fitView, { immediate: true });

const viewTransform = computed(
  () => `translate(${view.value.x} ${view.value.y}) scale(${view.value.k})`,
);

function zoomAbout(px, py, factor) {
  const { x, y, k } = view.value;
  const nk = Math.min(fitK.value * MAX_ZOOM, Math.max(fitK.value * MIN_ZOOM, k * factor));
  const r = nk / k;
  view.value = { k: nk, x: px - (px - x) * r, y: py - (py - y) * r };
}

function localPoint(event) {
  const rect = root.value?.getBoundingClientRect();
  return [event.clientX - (rect?.left || 0), event.clientY - (rect?.top || 0)];
}

function onWheel(event) {
  const [px, py] = localPoint(event);
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.value.height : 1;
  zoomAbout(px, py, Math.exp(-event.deltaY * unit * 0.001));
}

const pointers = new Map();
let moved = 0;
let dragged = false;
let pinchDist = 0;

function pinchDistance() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function onPointerDown(event) {
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) {
    moved = 0;
    dragged = false;
  } else if (pointers.size === 2) {
    pinchDist = pinchDistance();
    dragged = true;
    for (const id of pointers.keys()) event.currentTarget.setPointerCapture?.(id);
  }
}

function onPointerMove(event) {
  const prev = pointers.get(event.pointerId);
  if (!prev) return;
  const cur = { x: event.clientX, y: event.clientY };
  pointers.set(event.pointerId, cur);
  if (pointers.size === 1) {
    moved += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (moved > DRAG_PX && !dragged) {
      dragged = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    if (dragged) {
      view.value = {
        ...view.value,
        x: view.value.x + (cur.x - prev.x),
        y: view.value.y + (cur.y - prev.y),
      };
    }
  } else if (pointers.size === 2) {
    const d = pinchDistance();
    if (pinchDist > 0 && d > 0) {
      const [a, b] = [...pointers.values()];
      const rect = root.value?.getBoundingClientRect();
      zoomAbout((a.x + b.x) / 2 - (rect?.left || 0), (a.y + b.y) / 2 - (rect?.top || 0), d / pinchDist);
    }
    pinchDist = d;
  }
}

function onPointerEnd(event) {
  pointers.delete(event.pointerId);
  if (pointers.size === 1) pinchDist = 0;
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }
}

/** True (and clears the flag) when this click is the tail of a drag. */
function consumeDrag() {
  const was = dragged;
  dragged = false;
  return was;
}

function onStageClick() {
  if (consumeDrag()) return;
  emit('deselect');
}

function onBedClick(index) {
  if (consumeDrag()) return;
  emit('select', index);
}

function onBedKey(event, index) {
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    emit('select', index);
  }
}

function onKeydown(event) {
  if (event.key === 'Escape') emit('deselect');
}

// ---- drawing helpers ------------------------------------------------------
const polygon = (points) => points.map((p) => p.join(',')).join(' ');

const bedMeta = computed(() => {
  const byIndex = new Map(props.beds.map((b, i) => [i, b]));
  return layout.value.beds.map((b) => {
    const plantTitle = byIndex.get(b.index)?.plant?.title || 'empty bed';
    const a = ((b.angle % 360) + 540) % 360 - 180; // normalise to [-180, 180)
    return {
      ...b,
      aria: `${b.label}, bed ${b.index + 1}, ${plantTitle}`,
      flip: Math.abs(a) > 90 ? 180 : 0,
      chipW: Math.min(b.w - 4, Math.max(24, b.label.length * 6.2 + 10)),
    };
  });
});

const firstPiece = computed(() => layout.value.pieces[0] || null);
</script>

<template>
  <div ref="root" class="sc-root">
    <svg
      class="sc-svg"
      role="group"
      aria-label="Garden plan"
      @click="onStageClick"
      @keydown="onKeydown"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerEnd"
      @pointercancel="onPointerEnd"
    >
      <g class="sc-view" :transform="viewTransform">
        <polygon
          v-for="p in layout.paths"
          :key="'path-' + p.points.join(';')"
          class="sc-path"
          :points="polygon(p.points)"
          fill="#e7e5de"
        />
        <polygon
          v-for="p in layout.pieces"
          :key="'piece-' + p.index"
          class="sc-piece"
          :points="polygon(p.points)"
          fill="none"
          stroke="#8a8a80"
          stroke-width="1.5"
          stroke-dasharray="6 4"
          vector-effect="non-scaling-stroke"
        />
        <g v-for="(t, i) in layout.trees" :key="'tree-' + i" class="sc-tree">
          <circle :cx="t.x" :cy="t.y" :r="t.r" fill="#c9d8bf" />
          <circle :cx="t.x" :cy="t.y" :r="t.r * 0.18" fill="#6c8a5e" />
        </g>
        <text
          v-for="p in layout.pieces.filter((q) => q.letter)"
          :key="'letter-' + p.index"
          class="sc-letter"
          :x="p.centre[0]"
          :y="Math.min(...p.points.map((q) => q[1])) + 18"
          text-anchor="middle"
        >{{ p.letter }}</text>

        <g
          v-for="b in bedMeta"
          :key="b.key ?? b.index"
          class="sc-bed"
          role="button"
          tabindex="0"
          :aria-pressed="b.index === selected"
          :aria-label="b.aria"
          :transform="`translate(${b.x} ${b.y}) rotate(${b.angle})`"
          @click.stop="onBedClick(b.index)"
          @keydown="onBedKey($event, b.index)"
        >
          <rect
            class="sc-bed-rect"
            :x="-b.w / 2"
            :y="-b.h / 2"
            :width="b.w"
            :height="b.h"
            rx="3"
            :fill="b.color.fill"
            :stroke="b.index === selected ? '#2b2b2b' : b.color.stroke"
            :stroke-width="b.index === selected ? 2 : 1"
            vector-effect="non-scaling-stroke"
          />
          <g :transform="`rotate(${b.flip})`" class="sc-bed-text">
            <rect
              :x="-b.chipW / 2"
              y="-13"
              :width="b.chipW"
              height="16"
              rx="4"
              :fill="b.color.chip"
            />
            <text class="sc-label" x="0" y="-1.5" text-anchor="middle" font-size="11">{{ b.label }}</text>
            <text class="sc-sub" x="0" y="12" text-anchor="middle" font-size="9">{{ b.sub }}</text>
          </g>
        </g>

        <text
          v-if="!beds.length && firstPiece"
          class="sc-empty"
          :x="firstPiece.centre[0]"
          :y="firstPiece.centre[1]"
          text-anchor="middle"
        >{{ emptyText }}</text>
      </g>
      <text v-if="layout.notToScale" class="sc-caption" x="12" :y="box.height - 12">not to scale</text>
    </svg>
  </div>
</template>

<style scoped>
.sc-root {
  width: 100%;
  height: 100%;
  display: block;
  background: #f6f6f0;
  overflow: hidden;
}
.sc-svg {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
  cursor: grab;
  user-select: none;
}
.sc-svg:active {
  cursor: grabbing;
}
.sc-bed {
  cursor: pointer;
}
.sc-bed:focus {
  outline: none;
}
.sc-bed:focus-visible .sc-bed-rect {
  stroke: #2b2b2b;
  stroke-width: 3;
}
.sc-label,
.sc-sub {
  fill: #2b2b2b;
  pointer-events: none;
}
.sc-sub {
  fill: #5a5a52;
}
.sc-bed-text rect {
  pointer-events: none;
}
.sc-letter {
  font-size: 14px;
  font-weight: 600;
  fill: #8a8a80;
  pointer-events: none;
}
.sc-empty {
  font-size: 14px;
  fill: #8a8a80;
  pointer-events: none;
}
.sc-caption {
  font-size: 11px;
  fill: #8a8a80;
  pointer-events: none;
}
</style>
