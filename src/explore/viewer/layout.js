export const PLOT_SIZE = 1.2;
export const PLOT_GAP = 0.5;
export const ISLAND_MARGIN = 1.0;

/** Near-square grid, filled row by row in input order, centred on the origin. */
export function layoutPlots(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`layoutPlots needs at least one plot, got ${n}`);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const step = PLOT_SIZE + PLOT_GAP;
  const span = (count) => count * PLOT_SIZE + (count - 1) * PLOT_GAP;

  const positions = Array.from({ length: n }, (_, i) => ({
    x: (i % cols) * step - (span(cols) - PLOT_SIZE) / 2,
    z: Math.floor(i / cols) * step - (span(rows) - PLOT_SIZE) / 2,
  }));

  return {
    positions,
    cols,
    rows,
    islandWidth: span(cols) + 2 * ISLAND_MARGIN,
    islandDepth: span(rows) + 2 * ISLAND_MARGIN,
  };
}
