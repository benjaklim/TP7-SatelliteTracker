import { DEG, EARTH_MEAN_RADIUS_KM } from '../orbital/constants';
import type { LngLat } from '../orbital/types';
import { splitPolygonAtAntimeridian, unwrapLongitudes } from './antimeridian';

/**
 * Earth central angle (radians) of the coverage circle of a satellite at `altitudeKm`
 * seen at or above `minElevationDeg`:  λ = acos(R / (R + h) · cos ε) − ε
 */
export function footprintCentralAngle(altitudeKm: number, minElevationDeg: number): number {
  const eps = minElevationDeg * DEG;
  const ratio = EARTH_MEAN_RADIUS_KM / (EARTH_MEAN_RADIUS_KM + altitudeKm);
  return Math.max(0, Math.acos(ratio * Math.cos(eps)) - eps);
}

/** Ground radius (km, along the surface) of the coverage circle. */
export function footprintRadiusKm(altitudeKm: number, minElevationDeg: number): number {
  return EARTH_MEAN_RADIUS_KM * footprintCentralAngle(altitudeKm, minElevationDeg);
}

/** Spherical destination point given a start point, bearing and angular distance (radians). */
export function destination(latDeg: number, lonDeg: number, bearingDeg: number, angle: number): LngLat {
  const phi1 = latDeg * DEG;
  const lambda1 = lonDeg * DEG;
  const theta = bearingDeg * DEG;
  const sinPhi2 =
    Math.sin(phi1) * Math.cos(angle) + Math.cos(phi1) * Math.sin(angle) * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(angle) * Math.cos(phi1),
      Math.cos(angle) - Math.sin(phi1) * sinPhi2,
    );
  return [lambda2 / DEG, phi2 / DEG];
}

/**
 * Coverage footprint as GeoJSON MultiPolygon coordinates, split at the antimeridian
 * and closed over the pole when the coverage circle contains it.
 */
export function footprintPolygon(
  latitude: number,
  longitude: number,
  altitudeKm: number,
  minElevationDeg: number,
  segments = 96,
): LngLat[][][] {
  const angle = footprintCentralAngle(altitudeKm, minElevationDeg);
  if (angle <= 0) return [];
  const raw: LngLat[] = [];
  for (let i = 0; i < segments; i++) {
    raw.push(destination(latitude, longitude, (360 * i) / segments, angle));
  }
  let ring = unwrapLongitudes(raw);
  const closingJump = ring[ring.length - 1][0] - ring[0][0];
  if (Math.abs(closingJump) > 180) {
    // The circle encloses a pole: walk the ring eastwards and close it along the pole.
    const pole = latitude >= 0 ? 90 : -90;
    const eastward = closingJump > 0 ? ring : [...ring].reverse();
    const first = eastward[0];
    ring = [...eastward, [first[0] + 360, first[1]], [first[0] + 360, pole], [first[0], pole]];
  }
  return splitPolygonAtAntimeridian(ring);
}
