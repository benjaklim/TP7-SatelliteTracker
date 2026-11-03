import {
  degreesLat,
  degreesLong,
  degreesToRadians,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  gstime,
  json2satrec,
  propagate,
  type EcfVec3,
  type EciVec3,
  type GeodeticLocation,
  type SatRec,
} from 'satellite.js';

import { EARTH_RADIUS_KM, MINUTES_PER_DAY } from './constants';
import type { LookAngles, Observer, OrbitClass, OrbitalRecord, SatelliteState } from './types';

/** SGP4-ready satellite built from an OMM/JSON record (no TLE needed, supports 6-digit NORAD IDs). */
export interface Satellite {
  readonly noradId: number;
  readonly name: string;
  readonly epoch: number;
  readonly record: OrbitalRecord;
  readonly satrec: SatRec;
}

export class PropagationError extends Error {
  constructor(
    readonly noradId: number,
    readonly code: number,
  ) {
    super(`SGP4 propagation failed for ${noradId} (error ${code})`);
  }
}

export function createSatellite(record: OrbitalRecord): Satellite {
  const satrec = json2satrec(record);
  if (satrec.error) throw new PropagationError(record.NORAD_CAT_ID, satrec.error);
  return {
    noradId: Number(record.NORAD_CAT_ID),
    name: record.OBJECT_NAME,
    epoch: parseEpoch(record.EPOCH),
    record,
    satrec,
  };
}

/** OMM epochs are UTC but omit the "Z" suffix. */
export function parseEpoch(epoch: string): number {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(epoch) ? epoch : `${epoch}Z`);
}

export interface EciSample {
  position: EciVec3<number>;
  velocity: EciVec3<number>;
  gmst: number;
}

export function propagateEci(sat: Satellite, timestamp: number): EciSample | null {
  const date = new Date(timestamp);
  const pv = propagate(sat.satrec, date);
  if (!pv || typeof pv.position !== 'object' || typeof pv.velocity !== 'object') return null;
  return { position: pv.position, velocity: pv.velocity, gmst: gstime(date) };
}

export function stateFromEci(sample: EciSample, timestamp: number): SatelliteState {
  const geo = eciToGeodetic(sample.position, sample.gmst);
  const { x, y, z } = sample.velocity;
  return {
    timestamp,
    latitude: degreesLat(geo.latitude),
    longitude: degreesLong(geo.longitude),
    altitudeKm: geo.height,
    velocityKmS: Math.sqrt(x * x + y * y + z * z),
  };
}

/** Sub-satellite point (geodetic lat/lon/alt) at the given time. */
export function stateAt(sat: Satellite, timestamp: number): SatelliteState | null {
  const sample = propagateEci(sat, timestamp);
  return sample ? stateFromEci(sample, timestamp) : null;
}

export function toObserverGeodetic(observer: Observer): GeodeticLocation {
  return {
    latitude: degreesToRadians(observer.latitude),
    longitude: degreesToRadians(observer.longitude),
    height: observer.altitudeKm,
  };
}

export function lookAnglesFromEcf(observer: GeodeticLocation, ecf: EcfVec3<number>): LookAngles {
  const look = ecfToLookAngles(observer, ecf);
  return {
    azimuth: (look.azimuth * 180) / Math.PI,
    elevation: (look.elevation * 180) / Math.PI,
    rangeKm: look.rangeSat,
  };
}

/** Topocentric azimuth/elevation of the satellite as seen from the observer. */
export function lookAnglesAt(
  sat: Satellite,
  observer: Observer | GeodeticLocation,
  timestamp: number,
): LookAngles | null {
  const sample = propagateEci(sat, timestamp);
  if (!sample) return null;
  const geodetic = 'height' in observer ? observer : toObserverGeodetic(observer);
  return lookAnglesFromEcf(geodetic, eciToEcf(sample.position, sample.gmst));
}

/** Orbital period in minutes, from the SGP4 mean motion (rad/min). */
export function orbitalPeriodMinutes(sat: Satellite): number {
  return (2 * Math.PI) / sat.satrec.no;
}

export function classifyOrbit(sat: Satellite): OrbitClass {
  const period = orbitalPeriodMinutes(sat);
  if (sat.satrec.ecco > 0.25) return 'HEO';
  if (period < 128) return 'LEO';
  if (Math.abs(period - MINUTES_PER_DAY) < 60) return 'GEO';
  return 'MEO';
}

/** Age of the orbital data relative to `now`, in hours. */
export function dataAgeHours(sat: Satellite, now: number): number {
  return (now - sat.epoch) / 3_600_000;
}

export { EARTH_RADIUS_KM };
