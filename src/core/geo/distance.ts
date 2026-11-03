import { geodeticToEcf } from 'satellite.js';

import { DEG, EARTH_MEAN_RADIUS_KM } from '../orbital/constants';
import type { GeoPosition } from '../orbital/types';

/** Great-circle distance between the ground projections of two points (km). */
export function haversineKm(
  a: Pick<GeoPosition, 'latitude' | 'longitude'>,
  b: Pick<GeoPosition, 'latitude' | 'longitude'>,
): number {
  const dLat = (b.latitude - a.latitude) * DEG;
  const dLon = (b.longitude - a.longitude) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * DEG) * Math.cos(b.latitude * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MEAN_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Straight-line (3D, ECEF) distance between two geodetic positions including altitude (km). */
export function distance3dKm(a: GeoPosition, b: GeoPosition): number {
  const toEcf = (p: GeoPosition) =>
    geodeticToEcf({ latitude: p.latitude * DEG, longitude: p.longitude * DEG, height: p.altitudeKm });
  const pa = toEcf(a);
  const pb = toEcf(b);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
}
