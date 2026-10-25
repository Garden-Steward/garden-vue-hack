/** A pointer that travelled further than `threshold` px between down and up was a drag. */
export function isClick(down, up, threshold = 5) {
  return Math.hypot(up.x - down.x, up.y - down.y) <= threshold;
}

/** Tracks pointers by id so a pinch or any multi-pointer gesture never counts as a tap. */
export function createTapTracker(threshold = 5) {
  const downs = new Map();
  let multi = false;
  const release = (id) => {
    downs.delete(id);
    const wasMulti = multi;
    if (downs.size === 0) multi = false;
    return wasMulti;
  };
  return {
    down(id, x, y) {
      downs.set(id, { x, y });
      if (downs.size > 1) multi = true;
    },
    /** True when this pointer-up ends a single-pointer gesture that barely moved. */
    up(id, x, y) {
      const start = downs.get(id);
      const wasMulti = release(id);
      return !!start && !wasMulti && isClick(start, { x, y }, threshold);
    },
    cancel(id) {
      release(id);
    },
  };
}
