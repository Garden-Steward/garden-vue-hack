import * as THREE from 'three';
import { makeRand } from './rand';

// Matches the Strapi `plant.type` enum.
export const PLANT_TYPES = ['annual', 'perennial', 'herb', 'tree', 'shrub', 'wildflower', 'fungi'];

export const DEFAULT_COLORS = {
  annual: '#d9443a',
  perennial: '#9b7fd1',
  herb: '#5fa04a',
  tree: '#f5d33d',
  shrub: '#4a5fb8',
  wildflower: '#f39a1e',
  fungi: '#c9b8a3',
};

const LEAF_GREENS = ['#4f8a3c', '#5e9a45', '#437a33', '#6aa64e'];
const STEM = '#3f6b32';
const BARK = '#6d4f35';

// Shared across every plant and every mount; never disposed (small and reused).
const materials = new Map();
function mat(color) {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1 });
    materials.set(color, m);
  }
  return m;
}

const geo = {
  blob: new THREE.IcosahedronGeometry(1, 0),
  cone: new THREE.ConeGeometry(1, 1, 5),
  stem: new THREE.CylinderGeometry(1, 1, 1, 5),
  cap: new THREE.SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2),
};

const between = (rand, lo, hi) => lo + rand() * (hi - lo);
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
/** A point within `radius` of the plot centre. */
const around = (rand, radius) => {
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(rand()) * radius;
  return [Math.cos(a) * r, Math.sin(a) * r];
};

// Each builder keeps every part within ~0.5 of the centre and at or above y = 0.
const builders = {
  annual(part, rand, color) {
    for (let i = 0; i < 4; i++) {
      const r = between(rand, 0.17, 0.23);
      const [x, z] = around(rand, 0.14);
      part(geo.blob, pick(rand, LEAF_GREENS), [x, between(rand, r, r + 0.15), z], [r, r, r]);
    }
    for (let i = 0; i < 4; i++) {
      const [x, z] = around(rand, 0.25);
      part(geo.blob, color, [x, between(rand, 0.15, 0.45), z], [0.06, 0.06, 0.06]);
    }
  },
  perennial(part, rand, color) {
    for (let i = 0; i < 5; i++) {
      const r = between(rand, 0.16, 0.21);
      const [x, z] = around(rand, 0.18);
      part(geo.blob, pick(rand, LEAF_GREENS), [x, between(rand, r, 0.45), z], [r, r * 1.2, r]);
    }
    for (let i = 0; i < 6; i++) {
      const [x, z] = around(rand, 0.22);
      part(geo.blob, color, [x, between(rand, 0.55, 0.75), z], [0.07, 0.07, 0.07]);
    }
  },
  herb(part, rand, color) {
    for (let i = 0; i < 7; i++) {
      const h = between(rand, 0.3, 0.5);
      const [x, z] = around(rand, 0.2);
      part(geo.cone, i % 3 === 0 ? color : pick(rand, LEAF_GREENS), [x, h / 2, z], [0.06, h, 0.06]);
    }
  },
  tree(part, rand, color) {
    part(geo.stem, BARK, [0, 0.45, 0], [0.07, 0.9, 0.07]);
    part(geo.blob, pick(rand, LEAF_GREENS), [0, 1.2, 0], [0.42, 0.38, 0.42]);
    part(geo.blob, pick(rand, LEAF_GREENS), [0.12, 1.5, -0.08], [0.28, 0.26, 0.28]);
    for (let i = 0; i < 5; i++) {
      const [x, z] = around(rand, 0.3);
      part(geo.blob, color, [x, between(rand, 1.0, 1.4), z], [0.06, 0.06, 0.06]);
    }
  },
  shrub(part, rand, color) {
    for (let i = 0; i < 6; i++) {
      const r = between(rand, 0.19, 0.24);
      const [x, z] = around(rand, 0.24);
      part(geo.blob, pick(rand, LEAF_GREENS), [x, r * 0.8, z], [r, r * 0.8, r]);
    }
    for (let i = 0; i < 7; i++) {
      const [x, z] = around(rand, 0.32);
      part(geo.blob, color, [x, between(rand, 0.15, 0.32), z], [0.05, 0.05, 0.05]);
    }
  },
  wildflower(part, rand, color) {
    part(geo.blob, pick(rand, LEAF_GREENS), [0, 0.1, 0], [0.18, 0.1, 0.18]);
    for (let i = 0; i < 6; i++) {
      const h = between(rand, 0.35, 0.6);
      const [x, z] = around(rand, 0.28);
      part(geo.stem, STEM, [x, h / 2, z], [0.012, h, 0.012]);
      part(geo.blob, color, [x, h, z], [0.07, 0.05, 0.07]);
    }
  },
  fungi(part, rand, color) {
    for (let i = 0; i < 3; i++) {
      const h = between(rand, 0.12, 0.25);
      const r = between(rand, 0.11, 0.17);
      const [x, z] = around(rand, 0.25);
      part(geo.stem, '#efe6d6', [x, h / 2, z], [0.04, h, 0.04]);
      part(geo.cap, color, [x, h, z], [r, r * 0.7, r]);
    }
  },
};

/** Strapi plants can have no type; draw those as an annual. */
export const archetypeOf = (type) => (PLANT_TYPES.includes(type) ? type : 'annual');

/** One low-poly plant for a plot, base at y = 0, varied deterministically by `seed`. */
export function buildPlant(plant, seed) {
  const rand = makeRand(seed);
  const group = new THREE.Group();
  const part = (geometry, color, pos, scale) => {
    const mesh = new THREE.Mesh(geometry, mat(color));
    mesh.position.set(...pos);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  const type = archetypeOf(plant.type);
  builders[type](part, rand, plant.color ?? DEFAULT_COLORS[type]);
  group.rotation.y = rand() * Math.PI * 2;
  group.scale.setScalar(between(rand, 0.9, 1.08));
  return group;
}
