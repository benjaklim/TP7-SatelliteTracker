import type { LngLat } from '../orbital/types';

/** Normalizes a longitude to [-180, 180). */
export function normalizeLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Splits a polyline whenever consecutive samples jump more than 180° in longitude,
 * interpolating the crossing latitude so each segment ends exactly on ±180°.
 */
export function splitLineAtAntimeridian(points: LngLat[]): LngLat[][] {
  if (points.length === 0) return [];
  const segments: LngLat[][] = [];
  let current: LngLat[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [lonA, latA] = points[i - 1];
    const [lonB, latB] = points[i];
    if (Math.abs(lonB - lonA) > 180) {
      const edge = lonA > 0 ? 180 : -180;
      const unwrappedB = lonB + (lonA > 0 ? 360 : -360);
      const frac = (edge - lonA) / (unwrappedB - lonA);
      const lat = latA + frac * (latB - latA);
      current.push([edge, lat]);
      segments.push(current);
      current = [[-edge, lat]];
    }
    current.push(points[i]);
  }
  segments.push(current);
  return segments.filter((s) => s.length > 1);
}

/** Makes longitudes continuous (no jumps > 180°) by adding multiples of 360°. */
export function unwrapLongitudes(points: LngLat[]): LngLat[] {
  if (points.length === 0) return [];
  const out: LngLat[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    let lon = points[i][0];
    const prev = out[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, points[i][1]]);
  }
  return out;
}

/** Sutherland–Hodgman clip of a ring against the vertical line `lon = x`. */
function clipHalfPlane(ring: LngLat[], x: number, keepGreater: boolean): LngLat[] {
  const inside = (p: LngLat) => (keepGreater ? p[0] >= x : p[0] <= x);
  const intersect = (a: LngLat, b: LngLat): LngLat => {
    const t = (x - a[0]) / (b[0] - a[0]);
    return [x, a[1] + t * (b[1] - a[1])];
  };
  const out: LngLat[] = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i];
    const prev = ring[(i + ring.length - 1) % ring.length];
    if (inside(cur)) {
      if (!inside(prev)) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (inside(prev)) {
      out.push(intersect(prev, cur));
    }
  }
  return out;
}

/**
 * Splits an unwrapped, open polygon ring into pieces that fit in [-180, 180],
 * returning GeoJSON MultiPolygon coordinates.
 */
export function splitPolygonAtAntimeridian(unwrappedRing: LngLat[]): LngLat[][][] {
  const polygons: LngLat[][][] = [];
  for (let k = -2; k <= 2; k++) {
    const lo = -180 + 360 * k;
    const hi = 180 + 360 * k;
    const piece = clipHalfPlane(clipHalfPlane(unwrappedRing, lo, true), hi, false);
    if (piece.length < 3) continue;
    const shifted = piece.map(([lon, lat]): LngLat => [lon - 360 * k, lat]);
    shifted.push(shifted[0]);
    polygons.push([shifted]);
  }
  return polygons;
}
