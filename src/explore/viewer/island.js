import * as THREE from 'three';
import { PLOT_SIZE } from './layout';
import { makeRand } from './rand';

const PLOT_HEIGHT = 0.18;
const SEGMENTS = 10;
// The grass ellipse is scaled so the plot rectangle fits inside the 10-sided outline.
const ELLIPSE_SCALE = 1.25;

const lowPoly = (color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1 });

/** A downward cone whose vertices (except the top ring) are jittered, so the underside reads as rock. */
function rockGeometry(height, seed) {
  const g = new THREE.ConeGeometry(0.85, height, SEGMENTS, 3);
  g.rotateX(Math.PI);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y >= height / 2 - 1e-6) continue;
    // Seed by position so duplicated seam vertices move together and the mesh stays closed.
    const key = [pos.getX(i), y, pos.getZ(i)].map((v) => Math.round(v * 1000)).join(',');
    const rand = makeRand(`${seed}:${key}`);
    pos.setXYZ(i, pos.getX(i) + (rand() - 0.5) * 0.18, y + (rand() - 0.5) * height * 0.12, pos.getZ(i) + (rand() - 0.5) * 0.18);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Island dimensions shared by the mesh and the camera framing: grass ellipse
 * radii, rock depth, and the lowest point including rock jitter.
 */
export function islandShape(layout) {
  const rockHeight = Math.max(layout.islandWidth, layout.islandDepth) * 0.55;
  return {
    sx: (layout.islandWidth / 2) * ELLIPSE_SCALE,
    sz: (layout.islandDepth / 2) * ELLIPSE_SCALE,
    rockHeight,
    bottomY: -0.75 - rockHeight * 1.06,
  };
}

/** Returns `{ group, plotMeshes, topY }`. */
export function buildIsland(layout, seed) {
  const group = new THREE.Group();
  const { sx, sz, rockHeight } = islandShape(layout);

  const grass = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.96, 0.3, SEGMENTS), lowPoly('#7fb05a'));
  grass.name = 'grass';
  grass.scale.set(sx, 1, sz);
  grass.position.y = -0.15;
  grass.receiveShadow = true;

  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.96, 0.85, 0.45, SEGMENTS), lowPoly('#8a6446'));
  soil.scale.set(sx, 1, sz);
  soil.position.y = -0.3 - 0.225;
  soil.castShadow = true;

  const rock = new THREE.Mesh(rockGeometry(rockHeight, seed), lowPoly('#7d7468'));
  rock.scale.set(sx, 1, sz);
  rock.position.y = -0.75 - rockHeight / 2;
  rock.castShadow = true;

  group.add(grass, soil, rock);

  const plotGeometry = new THREE.BoxGeometry(PLOT_SIZE, PLOT_HEIGHT, PLOT_SIZE);
  const plotMeshes = layout.positions.map(({ x, z }, i) => {
    const plot = new THREE.Mesh(plotGeometry, lowPoly('#5c4331'));
    plot.position.set(x, PLOT_HEIGHT / 2, z);
    plot.castShadow = true;
    plot.receiveShadow = true;
    plot.userData.plotIndex = i;
    group.add(plot);
    return plot;
  });

  return { group, plotMeshes, topY: PLOT_HEIGHT };
}
