import { eciToEcf, gstime, jday, sunPos } from 'satellite.js';

import { AU_KM, EARTH_RADIUS_KM } from './constants';
import { lookAnglesFromEcf } from './satellite';
import type { GeodeticLocation, EciVec3 } from 'satellite.js';

export function sunEciKm(timestamp: number): EciVec3<number> {
  const { rsun } = sunPos(jday(new Date(timestamp)));
  return { x: rsun[0] * AU_KM, y: rsun[1] * AU_KM, z: rsun[2] * AU_KM };
}

/** Sun elevation (degrees) as seen from the observer. */
export function sunElevation(observer: GeodeticLocation, timestamp: number): number {
  const ecf = eciToEcf(sunEciKm(timestamp), gstime(new Date(timestamp)));
  return lookAnglesFromEcf(observer, ecf).elevation;
}

/** Cylindrical Earth-shadow model: good enough for naked-eye visibility. */
export function isSunlit(satEci: EciVec3<number>, timestamp: number): boolean {
  const sun = sunEciKm(timestamp);
  const norm = Math.hypot(sun.x, sun.y, sun.z);
  const s = { x: sun.x / norm, y: sun.y / norm, z: sun.z / norm };
  const along = satEci.x * s.x + satEci.y * s.y + satEci.z * s.z;
  if (along >= 0) return true;
  const px = satEci.x - along * s.x;
  const py = satEci.y - along * s.y;
  const pz = satEci.z - along * s.z;
  return Math.hypot(px, py, pz) > EARTH_RADIUS_KM;
}

/** Civil twilight threshold used for optical pass visibility. */
export const DARK_SKY_SUN_ELEVATION = -6;
