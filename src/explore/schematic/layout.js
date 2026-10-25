import { colorFor, pieceLetter } from './colors.js';

export const BED_W = 2.4;
export const BED_D = 1.2;
export const BED_GAP = 1.0;
export const PATH_W = 1.5;
export const MARGIN = 2.0;
export const TREE_R = 2.5;
export const MIN_BED_PX = 60;
export const DEFAULT_OPTIONS = { rows: null, path: 'centre', trees: 2 };

const TIGHT_GAP = 0.4;
const MIN_BED_SCALE = 0.25; // beds never shrink below this fraction of BED_W x BED_D
const SHRINK_STEP = 0.95;
const MAX_SHRINK_STEPS = 400;
const PIECE_GAP = 4;
const EPS = 1e-9;

/** FNV-1a, unsigned 32-bit. */
function hash(seed) {
  let h = 0x811c9dc5;
  const s = String(seed ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function validRing(ring) {
  return (
    Array.isArray(ring) &&
    ring.length >= 3 &&
    ring.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  );
}

function resolveOptions(options) {
  const given = options || {};
  const o = {
    rows: given.rows ?? DEFAULT_OPTIONS.rows,
    path: given.path ?? DEFAULT_OPTIONS.path,
    trees: given.trees ?? DEFAULT_OPTIONS.trees,
  };
  const rows = Number.isFinite(o.rows) && o.rows >= 1 ? Math.floor(o.rows) : null;
  const path = ['centre', 'left', 'right', 'none'].includes(o.path) ? o.path : 'centre';
  const trees = Number.isFinite(o.trees) && o.trees > 0 ? Math.floor(o.trees) : 0;
  return { rows, path, trees };
}

/** Default rectangle (metres, centred on the origin) with a long axis along x. */
function defaultRing(count, opts) {
  const n = Math.max(count, 4); // an empty garden still shows a plausible plot
  const sides = opts.path === 'centre' ? 2 : 1;
  const r = opts.rows ?? Math.max(1, Math.round(Math.sqrt(n / 2)));
  const c = Math.max(1, Math.ceil(n / (sides * r)));
  const depth =
    2 * MARGIN + sides * (r * BED_D + (r - 1) * BED_GAP) + (opts.path === 'none' ? 0 : PATH_W);
  const length = Math.max(2 * MARGIN + c * BED_W + (c - 1) * BED_GAP, depth);
  const hx = length / 2;
  const hy = depth / 2;
  return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
}

/** Oriented bounding box from the longest edge; u is the long axis. */
function orientedBox(ring) {
  let best = -1;
  let u = [1, 0];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len > best) {
      best = len;
      u = len > 0 ? [(q[0] - p[0]) / len, (q[1] - p[1]) / len] : [1, 0];
    }
  }
  const measure = (ux, uy) => {
    const vx = -uy;
    const vy = ux;
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const [x, y] of ring) {
      const a = x * ux + y * uy;
      const b = x * vx + y * vy;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a);
      b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    return { u: [ux, uy], v: [vx, vy], a0, a1, b0, b1, L: a1 - a0, D: b1 - b0 };
  };
  const canon = (p) => (p[0] < -EPS || (Math.abs(p[0]) <= EPS && p[1] < 0) ? [-p[0], -p[1]] : p);
  let m = measure(...canon(u));
  if (m.D > m.L) m = measure(...canon([m.v[0], m.v[1]]));
  const midA = (m.a0 + m.a1) / 2;
  const midB = (m.b0 + m.b1) / 2;
  return {
    u: m.u,
    v: m.v,
    L: m.L,
    D: m.D,
    centre: [m.u[0] * midA + m.v[0] * midB, m.u[1] * midA + m.v[1] * midB],
  };
}

/**
 * Strips across the short axis (local b range) that hold beds, plus the path strip.
 * 'left' is +v and 'right' is -v when facing along the canonical long axis u.
 * A piece too shallow for a path plus a minimum-size bed row on each bed side drops its path.
 */
function strips(D, pathKind) {
  const h = Math.max(D - 2 * MARGIN, 0.5) / 2;
  const sides = pathKind === 'centre' ? 2 : 1;
  if (pathKind !== 'none' && (2 * h - PATH_W) / sides < BED_D * MIN_BED_SCALE) pathKind = 'none';
  switch (pathKind) {
    case 'none': return { blocks: [[-h, h]], path: null };
    case 'left': return { blocks: [[-h, h - PATH_W]], path: [h - PATH_W, h] };
    case 'right': return { blocks: [[-h + PATH_W, h]], path: [-h, -h + PATH_W] };
    default: return { blocks: [[-h, -PATH_W / 2], [PATH_W / 2, h]], path: [-PATH_W / 2, PATH_W / 2] };
  }
}

function capacityOf(f, g, innerL, blocks, rowsOpt) {
  const w = BED_W * f;
  const d = BED_D * f;
  const cols = Math.max(0, Math.floor((innerL + g + EPS) / (w + g)));
  let rowsTotal = 0;
  const rows = blocks.map(([b0, b1]) => {
    const fit = Math.max(0, Math.floor((b1 - b0 + g + EPS) / (d + g)));
    const r = Math.min(rowsOpt ?? Infinity, fit);
    rowsTotal += r;
    return r;
  });
  return { w, d, g, cols, rows, capacity: cols * rowsTotal };
}

/** Grid for `count` beds in one piece's box; shrinks gap, then beds, if they do not fit. */
function planGrid(count, innerL, blocks, rowsOpt) {
  let plan = capacityOf(1, BED_GAP, innerL, blocks, rowsOpt);
  if (plan.capacity >= count) return { ...plan, f: 1 };
  plan = capacityOf(1, TIGHT_GAP, innerL, blocks, rowsOpt);
  if (plan.capacity >= count) return { ...plan, f: 1 };
  // The sqrt estimate ignores the floor() in rows/cols, so it can still be too big;
  // step down until the grid really holds every bed, but never below MIN_BED_SCALE
  // (best effort: beds may then overlap rather than shrink without bound).
  let f = Math.max(Math.sqrt(Math.max(plan.capacity, 1) / count), MIN_BED_SCALE);
  for (let i = 0; i < MAX_SHRINK_STEPS; i++) {
    plan = capacityOf(f, TIGHT_GAP * f, innerL, blocks, rowsOpt);
    if (plan.capacity >= count || f <= MIN_BED_SCALE) break;
    f = Math.max(f * SHRINK_STEP, MIN_BED_SCALE);
  }
  return { ...plan, f };
}

/** Everything about one piece in metres, in its own frame. */
function buildPiece(ring, bedsHere, opts) {
  const box = orientedBox(ring);
  const { u, v, L, D, centre } = box;
  const innerL = Math.max(L - 2 * MARGIN, 0.5);
  const { blocks, path } = strips(D, opts.path);
  const plan = planGrid(bedsHere.length, innerL, blocks, opts.rows);
  const toWorld = (a, b) => [centre[0] + u[0] * a + v[0] * b, centre[1] + u[1] * a + v[1] * b];

  const B = blocks.length;
  const rowsUsed = Math.max(1, Math.min(plan.rows[0] || 1, Math.ceil(bedsHere.length / B)));
  const perCol = rowsUsed * B;
  const ncols = Math.max(1, Math.ceil(bedsHere.length / perCol));
  const placed = bedsHere.map((entry, i) => {
    const col = Math.floor(i / perCol);
    const k = i % perCol;
    const blk = k % B;
    const row = Math.floor(k / B);
    const mid = (blocks[blk][0] + blocks[blk][1]) / 2;
    const a = (col - (ncols - 1) / 2) * (plan.w + plan.g);
    const b = mid + (row - (rowsUsed - 1) / 2) * (plan.d + plan.g);
    return { entry, at: toWorld(a, b) };
  });

  const pathPoly = path
    ? [
        toWorld(-innerL / 2, path[0]),
        toWorld(innerL / 2, path[0]),
        toWorld(innerL / 2, path[1]),
        toWorld(-innerL / 2, path[1]),
      ]
    : null;

  const ia = Math.max(L / 2 - MARGIN - TREE_R, 0);
  const ib = Math.max(D / 2 - MARGIN - TREE_R, 0);
  // Too small for the inset corners to be distinct: no trees on this piece.
  const roomy = L / 2 > MARGIN + TREE_R && D / 2 > MARGIN + TREE_R;
  const corners = roomy
    ? [[-ia, -ib], [ia, -ib], [ia, ib], [-ia, ib]].map(([a, b]) => toWorld(a, b))
    : null;

  return {
    ring,
    placed,
    pathPoly,
    corners,
    bedW: plan.w,
    bedD: plan.d,
    angle: (Math.atan2(-u[1], u[0]) * 180) / Math.PI,
  };
}

function bounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function shiftPiece(p, dx, dy) {
  const mv = ([x, y]) => [x + dx, y + dy];
  return {
    ...p,
    ring: p.ring.map(mv),
    placed: p.placed.map((s) => ({ ...s, at: mv(s.at) })),
    pathPoly: p.pathPoly ? p.pathPoly.map(mv) : null,
    corners: p.corners.map(mv),
  };
}

export function layoutSchematic({ pieces, beds, options, stage, seed } = {}) {
  const opts = resolveOptions(options);
  const allBeds = Array.isArray(beds) ? beds : [];
  const sw = Math.max(1, stage?.width || 1);
  const sh = Math.max(1, stage?.height || 1);

  let rings = (Array.isArray(pieces) ? pieces : [])
    .map((p) => p && p.ring)
    .filter(validRing);
  if (!rings.length) rings = [defaultRing(allBeds.length, opts)];

  const buckets = rings.map(() => []);
  allBeds.forEach((b, i) => {
    const pi = Number.isInteger(b?.piece) && b.piece >= 0 && b.piece < rings.length ? b.piece : 0;
    buckets[pi].push({ bed: b, index: i, piece: pi });
  });

  let built = rings.map((ring, i) => buildPiece(ring, buckets[i], opts));
  const bedW = Math.min(...built.map((p) => p.bedW));

  const worldBounds = (list) => bounds(list.flatMap((p) => p.ring));
  const fitScale = (bb) => 0.9 * Math.min(sw / Math.max(bb.w, EPS), sh / Math.max(bb.h, EPS));

  let notToScale = false;
  let bb = worldBounds(built);
  let scale = fitScale(bb);
  if (scale * bedW < MIN_BED_PX) {
    if (built.length > 1) {
      let cursor = 0;
      built = built.map((p) => {
        const pb = bounds(p.ring);
        const moved = shiftPiece(p, cursor - pb.minX, -(pb.minY + pb.maxY) / 2);
        cursor += pb.w + PIECE_GAP;
        return moved;
      });
      notToScale = true;
      bb = worldBounds(built);
      scale = fitScale(bb);
    }
    if (scale * bedW < MIN_BED_PX) {
      scale = (MIN_BED_PX / bedW) * (1 + 1e-9); // guard against float rounding below 60
      notToScale = true;
    }
  }

  const toPx = ([x, y]) => [(x - bb.minX) * scale, (bb.maxY - y) * scale];

  const outPieces = built.map((p, index) => {
    const points = p.ring.map(toPx);
    const centre = [
      points.reduce((s, q) => s + q[0], 0) / points.length,
      points.reduce((s, q) => s + q[1], 0) / points.length,
    ];
    return { index, points, letter: pieceLetter(index, built.length), centre };
  });

  const outBeds = [];
  built.forEach((p, pi) => {
    for (const { entry, at } of p.placed) {
      const { bed, index } = entry;
      const [x, y] = toPx(at);
      outBeds.push({
        index,
        key: bed.key,
        piece: pi,
        x,
        y,
        w: p.bedW * scale,
        h: p.bedD * scale,
        angle: p.angle,
        label: bed.label || bed.plant?.title || `Bed ${index + 1}`,
        sub: `Bed ${index + 1}`,
        color: colorFor(bed.plant),
      });
    }
  });
  outBeds.sort((a, b) => a.index - b.index);

  const paths = built.filter((p) => p.pathPoly).map((p) => ({ points: p.pathPoly.map(toPx) }));

  const start = hash(seed) % 4;
  const trees = [];
  const treePieces = built.filter((p) => p.corners);
  for (let i = 0; i < opts.trees && treePieces.length; i++) {
    const P = treePieces.length;
    const [x, y] = toPx(treePieces[i % P].corners[(start + Math.floor(i / P)) % 4]);
    trees.push({ x, y, r: TREE_R * scale });
  }

  // Shift to a positive origin, centred in the stage when everything fits.
  const extent = [
    ...outPieces.flatMap((p) => p.points),
    ...trees.flatMap((t) => [[t.x - t.r, t.y - t.r], [t.x + t.r, t.y + t.r]]),
    ...outBeds.flatMap((b) => {
      const rad = (b.angle * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
        const lx = (i * b.w) / 2;
        const ly = (j * b.h) / 2;
        return [b.x + lx * c - ly * s, b.y + lx * s + ly * c];
      });
    }),
  ];
  const eb = bounds(extent);
  const offX = Math.max(0, (sw - eb.w) / 2);
  const offY = Math.max(0, (sh - eb.h) / 2);
  const dx = offX - eb.minX;
  const dy = offY - eb.minY;
  const mv = ([x, y]) => [x + dx, y + dy];

  for (const p of outPieces) {
    p.points = p.points.map(mv);
    p.centre = mv(p.centre);
  }
  for (const b of outBeds) { b.x += dx; b.y += dy; }
  for (const t of trees) { t.x += dx; t.y += dy; }
  for (const p of paths) p.points = p.points.map(mv);

  return {
    scale,
    notToScale,
    pieces: outPieces,
    beds: outBeds,
    paths,
    trees,
    size: { width: eb.w + 2 * offX, height: eb.h + 2 * offY },
  };
}
