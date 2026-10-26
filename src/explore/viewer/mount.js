import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createTapTracker } from './click';
import { CAMERA_ELEVATION_DEG, CAMERA_FOV_DEG, fitCamera } from './framing';
import { buildIsland, islandShape } from './island';
import { layoutPlots } from './layout';
import { buildPlant } from './plants';
import { makeRand } from './rand';

const SKY = '#cfe3ec';
// Soft white-green: on Explore, yellow means "volunteers needed", so selection uses its own colour.
const HIGHLIGHT = '#c9f2b0';
// How the island wears the garden's health: sky tint, grass colour, how full
// the plants are, and little flowers or dry patches on the grass.
const HEALTH = {
  thriving: { sky: '#cfe3ec', grass: '#7fb05a', plantScale: 1, flowers: 10, patches: 0 },
  steady: { sky: '#cbdde6', grass: '#84ac5a', plantScale: 0.95, flowers: 3, patches: 0 },
  needs: { sky: '#d6dde0', grass: '#a6ad63', plantScale: 0.82, flowers: 0, patches: 5 },
  quiet: { sky: '#cfe3ec', grass: '#7fb05a', plantScale: 1, flowers: 0, patches: 0 },
};
const FLOWER_COLORS = ['#f0d55a', '#fbfcf8', '#f39a1e'];
const PATCH = '#a08a5a';
// Figures (one per committed volunteer) stand on a ring of grass outside the beds.
const RING_INNER = 0.8;
const RING_OUTER = 0.92;
const BOB_HEIGHT = 0.15;
const BOB_PERIOD_S = 6;
const EASE_MS = 600;

const defaultRenderer = (canvas) => new THREE.WebGLRenderer({ canvas, antialias: true });
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * Mounts a floating low-poly island into `el`.
 *
 * - `island.seed`: stable string (the garden slug) so the rock shape never changes.
 * - `island.plots`: one entry per dirt plot, `{ key, plant }`; `plant` may be null for a bare plot.
 * - `options.onSelect(index)` / `options.onDeselect()` report taps on plots.
 *
 * Returns `{ destroy, clearSelection, selectPlot, setInset, setHealth, setFigures }`.
 * `setInset({ left, bottom })` frames the island in the part of the screen page
 * content leaves free (CSS px). `setHealth(level)` dresses the island for
 * 'thriving' | 'steady' | 'needs' | 'quiet'. `setFigures(n)` places n anchor
 * points on the grass; each frame `options.onFigures(points)` gets their screen
 * positions as `[{ x, y, visible, depth }]` in CSS px from the canvas's top left.
 */
export function mount(el, island, options) {
  const canvas = document.createElement('canvas');
  let renderer;
  try {
    renderer = (options.createRenderer ?? defaultRenderer)(canvas);
  } catch {
    const msg = document.createElement('div');
    msg.className = 'webgl-error';
    msg.textContent = "This garden needs WebGL, which isn't available in this browser.";
    el.appendChild(msg);
    return { destroy: () => msg.remove(), clearSelection: () => {}, selectPlot: () => {}, setInset: () => {}, setHealth: () => {}, setFigures: () => {} };
  }

  const reducedMotion = options.reducedMotion ?? prefersReducedMotion();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(canvas);

  const { plots, seed } = island;
  const layout = layoutPlots(plots.length);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);

  scene.add(new THREE.HemisphereLight('#f4fff0', '#6d7f52', 1.6));
  const sun = new THREE.DirectionalLight('#fff4dc', 2.2);
  const reach = Math.max(layout.islandWidth, layout.islandDepth);
  sun.position.set(reach * 0.6, reach * 1.4, reach * 0.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 0.1, far: reach * 4 });
  scene.add(sun);

  // Everything that bobs lives in `world`.
  const world = new THREE.Group();
  scene.add(world);
  const built = buildIsland(layout, seed);
  world.add(built.group);
  const plantGroups = [];
  plots.forEach((plot, i) => {
    if (!plot.plant) return;
    const plant = buildPlant(plot.plant, `${seed}:${plot.key}`);
    const { x, z } = layout.positions[i];
    plant.position.set(x, built.topY, z);
    plant.userData.plotIndex = i;
    plant.userData.baseScale = plant.scale.x;
    world.add(plant);
    plantGroups.push(plant);
  });

  // ── Health dressing: grass colour, sky, plant fullness, flowers or dry patches ──
  const shape = islandShape(layout);
  const grassMesh = built.group.getObjectByName('grass');
  const dressing = new THREE.Group();
  world.add(dressing);
  /** A seeded point on the grass ring, outside the beds. `t` in [0, 1) is the angle. */
  const ringPoint = (rand, t) => {
    const a = t * Math.PI * 2;
    const r = RING_INNER + rand() * (RING_OUTER - RING_INNER);
    return { x: Math.cos(a) * shape.sx * r, z: Math.sin(a) * shape.sz * r };
  };
  const clearDressing = () => {
    for (const m of dressing.children) m.geometry.dispose?.();
    dressing.clear();
  };
  let health = 'quiet';
  const setHealth = (level) => {
    const h = HEALTH[level] || HEALTH.quiet;
    health = level in HEALTH ? level : 'quiet';
    scene.background.set(h.sky);
    if (grassMesh) grassMesh.material.color.set(h.grass);
    for (const p of plantGroups) p.scale.setScalar(p.userData.baseScale * h.plantScale);
    clearDressing();
    const rand = makeRand(`${seed}:dressing:${health}`);
    for (let i = 0; i < h.flowers; i++) {
      const { x, z } = ringPoint(rand, (i + rand() * 0.6) / h.flowers);
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055, 0), new THREE.MeshStandardMaterial({ color: FLOWER_COLORS[i % FLOWER_COLORS.length], flatShading: true, roughness: 1 }));
      m.position.set(x, 0.05, z);
      dressing.add(m);
    }
    for (let i = 0; i < h.patches; i++) {
      const { x, z } = ringPoint(rand, (i + 0.5) / h.patches);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3 + rand() * 0.2, 0.3 + rand() * 0.2, 0.02, 7), new THREE.MeshStandardMaterial({ color: PATCH, flatShading: true, roughness: 1 }));
      m.position.set(x * 0.9, 0.01, z * 0.9);
      m.rotation.y = rand() * Math.PI;
      dressing.add(m);
    }
  };

  // ── Figure anchors: n seeded spots on the grass ring, same spots every visit ──
  let anchors = [];
  const setFigures = (n) => {
    const count = Math.max(0, Math.min(12, n | 0));
    const rand = makeRand(`${seed}:figures`);
    const order = Array.from({ length: 12 }, (_, i) => i).sort(() => rand() - 0.5); // seeded shuffle of 12 slots
    anchors = order.slice(0, count).map((slot) => {
      const { x, z } = ringPoint(rand, (slot + 0.5) / 12);
      return new THREE.Vector3(x, 0, z);
    });
  };
  const projected = new THREE.Vector3();
  const reportFigures = () => {
    if (!anchors.length || !options.onFigures) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const camDir = camera.position.clone().sub(controls.target).normalize();
    options.onFigures(anchors.map((a) => {
      projected.copy(a).add(world.position).project(camera);
      // A figure on the far side of the island, below the eye line, is behind the plants.
      const away = a.clone().normalize().dot(camDir) < -0.35;
      return { x: ((projected.x + 1) / 2) * w, y: ((1 - projected.y) / 2) * h, visible: projected.z < 1, back: away, depth: projected.z };
    }));
  };

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 16 / 9, 0.1, 1000);
  let fit = fitCamera(layout, camera.aspect);
  // Start on the 45° diagonal, CAMERA_ELEVATION_DEG above the horizon.
  const elev = THREE.MathUtils.degToRad(CAMERA_ELEVATION_DEG);
  const startDir = new THREE.Vector3(Math.cos(elev) * Math.SQRT1_2, Math.sin(elev), Math.cos(elev) * Math.SQRT1_2);
  camera.position.copy(fit.target).addScaledVector(startDir, fit.distance);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(fit.target);
  controls.enableDamping = true;
  controls.maxPolarAngle = 1.35;
  controls.minDistance = 4;
  controls.maxDistance = fit.distance * 2;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.6;
  // Until the visitor moves the camera, resizes re-frame the whole island.
  let touched = false;
  const stopAutoRotate = () => {
    touched = true;
    controls.autoRotate = false;
  };
  controls.addEventListener('start', stopAutoRotate);
  controls.update();

  let selected = null;
  const paint = (i) => {
    if (i === null) return;
    const m = built.plotMeshes[i].material;
    m.emissive.set(i === selected ? HIGHLIGHT : '#000000');
    m.emissiveIntensity = 0.5;
  };
  const setHighlight = (i) => {
    const prev = selected;
    selected = i;
    paint(prev);
    paint(i);
  };

  let tween = null;
  const focusPlot = (i) => {
    const { x, z } = layout.positions[i];
    const toTarget = new THREE.Vector3(x, built.topY + 0.3, z);
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(Math.max(controls.minDistance + 1, Math.min(offset.length(), fit.distance * 0.6)));
    const toCam = toTarget.clone().add(offset);
    if (reducedMotion) {
      controls.target.copy(toTarget);
      camera.position.copy(toCam);
      return;
    }
    tween = { start: performance.now(), fromTarget: controls.target.clone(), toTarget, fromCam: camera.position.clone(), toCam };
  };

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const select = (index) => {
    if (index === null) {
      setHighlight(null);
      options.onDeselect();
      return;
    }
    stopAutoRotate();
    setHighlight(index);
    focusPlot(index);
    options.onSelect(index);
  };

  const taps = createTapTracker();
  const onPointerDown = (e) => taps.down(e.pointerId, e.clientX, e.clientY);
  const onPointerCancel = (e) => taps.cancel(e.pointerId);
  const onPointerUp = (e) => {
    if (!taps.up(e.pointerId, e.clientX, e.clientY)) return;
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    let index = null;
    for (const hit of raycaster.intersectObjects(world.children, true)) {
      let o = hit.object;
      while (o && o.userData.plotIndex === undefined) o = o.parent;
      if (o) {
        index = o.userData.plotIndex;
        break;
      }
    }
    // Bare plots have nothing to show.
    select(index !== null && plots[index].plant ? index : null);
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);

  let inset = { left: 0, bottom: 0 };
  const resize = () => {
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Shift the picture so its centre sits in the uncovered part of the screen,
    // then fit the island to that part.
    const left = Math.min(inset.left, w * 0.6);
    const bottom = Math.min(inset.bottom, h * 0.6);
    camera.setViewOffset(w, h, -left / 2, bottom / 2, w, h);
    camera.updateProjectionMatrix();
    const free = fitCamera(layout, (w - left) / (h - bottom));
    fit = { target: free.target, distance: (free.distance * h) / (h - bottom) };
    controls.maxDistance = fit.distance * 2;
    if (!touched) {
      const dir = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(fit.target);
      camera.position.copy(fit.target).addScaledVector(dir, fit.distance);
    }
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  observer?.observe(el);
  resize();

  let frameId = 0;
  const tick = (now) => {
    if (!reducedMotion) world.position.y = BOB_HEIGHT * Math.sin((now / 1000) * ((2 * Math.PI) / BOB_PERIOD_S));
    if (tween) {
      const t = Math.min(1, (now - tween.start) / EASE_MS);
      const k = easeInOut(t);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
      camera.position.lerpVectors(tween.fromCam, tween.toCam, k);
      if (t === 1) tween = null;
    }
    controls.update();
    renderer.render(scene, camera);
    reportFigures();
    frameId = requestAnimationFrame(tick);
  };
  frameId = requestAnimationFrame(tick);

  return {
    clearSelection: () => setHighlight(null),
    selectPlot: (index) => select(index),
    setInset(next) {
      inset = next;
      resize();
    },
    setHealth,
    setFigures,
    destroy() {
      cancelAnimationFrame(frameId);
      clearDressing();
      observer?.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      controls.removeEventListener('start', stopAutoRotate);
      controls.dispose();
      // Island resources are per mount; plant geometries/materials are shared caches (see plants.js).
      const disposed = new Set();
      built.group.traverse((o) => {
        if (!o.isMesh) return;
        disposed.add(o.geometry);
        disposed.add(o.material);
      });
      disposed.forEach((r) => r.dispose());
      renderer.dispose();
      // Give the GL context back now rather than at garbage collection; browsers cap
      // live contexts per page, and each visit (or dev hot reload) mounts a new one.
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
