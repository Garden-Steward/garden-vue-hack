import { tileToBbox3857 } from './mercator.js';

// Keyless, public-domain USGS NAIP Plus imagery (CORS: *).
export const NAIP_URL = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer';
export const NAIP_ATTRIBUTION = 'USGS, USDA, The National Map: Orthoimagery';

export function exportImageUrl(bbox3857, widthPx, heightPx) {
  const params = new URLSearchParams();
  params.set('bbox', bbox3857.join(','));
  params.set('bboxSR', '3857');
  params.set('imageSR', '3857');
  params.set('size', `${widthPx},${heightPx}`);
  params.set('format', 'jpg');
  params.set('f', 'image');
  return `${NAIP_URL}/exportImage?${params.toString()}`;
}

// `L` is passed in so this module needs no Leaflet import (and tests need no DOM).
export function createNaipLayer(L, options = {}) {
  const Layer = L.TileLayer.extend({
    getTileUrl(coords) {
      return exportImageUrl(tileToBbox3857(coords.z, coords.x, coords.y), 256, 256);
    },
  });
  return new Layer(NAIP_URL, {
    attribution: NAIP_ATTRIBUTION,
    crossOrigin: 'anonymous',
    maxZoom: 21,
    maxNativeZoom: 20,
    tileSize: 256,
    ...options,
  });
}
