import { test, expect } from 'vitest';
import { NAIP_URL, NAIP_ATTRIBUTION, exportImageUrl, createNaipLayer } from '../naip-layer.js';
import { tileToBbox3857 } from '../mercator.js';

test('exportImageUrl', () => {
  const u = new URL(exportImageUrl([1, 2, 3, 4], 256, 256));
  expect(u.origin + u.pathname).toBe(`${NAIP_URL}/exportImage`);
  expect(u.searchParams.get('bbox')).toBe('1,2,3,4'); expect(u.searchParams.get('bboxSR')).toBe('3857'); expect(u.searchParams.get('imageSR')).toBe('3857');
  expect(u.searchParams.get('size')).toBe('256,256'); expect(u.searchParams.get('f')).toBe('image');
});

test('createNaipLayer tile URLs are exportImage requests for the tile bbox', () => {
  // Fixture corrected from the brief: real Leaflet constructs (url, options).
  const fakeL = { TileLayer: { extend: (proto) => function (url, opts) { Object.assign(this, proto); this.options = opts; } } };
  const layer = createNaipLayer(fakeL);
  const url = new URL(layer.getTileUrl({ z: 19, x: 84117, y: 202597 }));
  expect(url.searchParams.get('bbox')).toBe(tileToBbox3857(19, 84117, 202597).join(','));
  expect(layer.options.crossOrigin).toBe('anonymous');
  expect(layer.options.attribution).toBe(NAIP_ATTRIBUTION);
});
