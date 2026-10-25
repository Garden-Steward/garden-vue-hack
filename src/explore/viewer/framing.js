import * as THREE from 'three';
import { islandShape } from './island';

export const CAMERA_FOV_DEG = 40;
export const CAMERA_ELEVATION_DEG = 22;

const PLANT_TOP_Y = 2.2;
const MARGIN = 0.92; // leave room for the bob and the screen edge
const AZIMUTHS = 16;

/** Conservative outline of the island: grass rim, plant tops over the rim, and the rock tip. */
function outline(layout) {
  const { sx, sz, bottomY } = islandShape(layout);
  const points = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const x = Math.cos(a) * sx;
    const z = Math.sin(a) * sz;
    points.push(
      new THREE.Vector3(x, 0, z),
      new THREE.Vector3(x, -0.75, z),
      new THREE.Vector3(x * 0.8, PLANT_TOP_Y, z * 0.8),
    );
  }
  // Rock tip, allowing for its sideways jitter.
  for (const [x, z] of [[0.09, 0], [-0.09, 0], [0, 0.09], [0, -0.09]]) points.push(new THREE.Vector3(x * sx, bottomY, z * sz));
  return points;
}

function fits(points, target, distance, camera) {
  const elev = THREE.MathUtils.degToRad(CAMERA_ELEVATION_DEG);
  const p = new THREE.Vector3();
  for (let k = 0; k < AZIMUTHS; k++) {
    const az = (k / AZIMUTHS) * Math.PI * 2;
    camera.position.set(
      target.x + distance * Math.cos(elev) * Math.sin(az),
      target.y + distance * Math.sin(elev),
      target.z + distance * Math.cos(elev) * Math.cos(az),
    );
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    for (const q of points) {
      p.copy(q).project(camera);
      if (Math.abs(p.x) > MARGIN || Math.abs(p.y) > MARGIN) return false;
    }
  }
  return true;
}

/** Smallest orbit distance (and its target) that keeps the whole island on screen at every rotation. */
export function fitCamera(layout, aspect) {
  const { bottomY } = islandShape(layout);
  const target = new THREE.Vector3(0, (PLANT_TOP_Y * 0.5 + bottomY) / 2, 0);
  const points = outline(layout);
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, aspect, 0.1, 1000);
  let lo = 1;
  let hi = 400;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(points, target, mid, camera)) hi = mid;
    else lo = mid;
  }
  return { distance: hi, target };
}
