import { test, expect } from 'vitest';
import { parseCoordinates, formatDecimal, isInUS } from '../coords.js';

test.each([
  ['37.802306, -122.241417', 37.802306, -122.241417],
  ['37.802306 -122.241417', 37.802306, -122.241417],
  [`37°48'08.3"N 122°14'29.1"W`, 37.802306, -122.241417],
  ['37°48′08.3″N 122°14′29.1″W', 37.802306, -122.241417],
  ['37.8023 N, 122.2414 W', 37.8023, -122.2414],
  ['https://maps/@37.80231,-122.24142,19z', 37.80231, -122.24142],
  ['37.802306, -122.241417.', 37.802306, -122.241417],
])('parses %s', (text, lat, lng) => {
  const r = parseCoordinates(text);
  expect(r.latitude).toBeCloseTo(lat, 5);
  expect(r.longitude).toBeCloseTo(lng, 5);
});

test.each(['hello', '', '95, 10', '-122.24, 37.80', '37.8', '37.8, 200'])('rejects %s', (t) =>
  expect(parseCoordinates(t)).toBeNull(),
);

test('formatDecimal', () =>
  expect(formatDecimal({ latitude: 37.8023061, longitude: -122.2414171 })).toBe('37.802306, -122.241417'));

test('isInUS', () => {
  expect(isInUS(37.8, -122.24)).toBe(true);
  expect(isInUS(51.5, -0.1)).toBe(false);
  expect(isInUS(21.3, -157.8)).toBe(true);
  expect(isInUS(64.2, -149.5)).toBe(true);
  expect(isInUS(24.4, -125.0)).toBe(true);
});
