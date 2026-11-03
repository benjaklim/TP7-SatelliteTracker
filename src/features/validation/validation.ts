import { degreesLat, degreesLong, eciToGeodetic, gstime, propagate } from 'satellite.js';

import { dataAgeHours, distance3dKm, haversineKm, stateAt, type GeoPosition, type Satellite } from '../../core';
import type { ValidationSample } from '../../data/types';

export interface ValidationRow {
  provider: string;
  noradId: number;
  name: string;
  timestamp: number;
  ours: GeoPosition;
  theirs: GeoPosition;
  /** Straight-line distance between both positions (includes altitude). */
  error3dKm: number;
  /** Distance between sub-satellite points along the surface. */
  groundErrorKm: number;
  altitudeDiffKm: number;
  epochAgeHours: number;
  /**
   * N2YO only: error after accounting for its timing convention (state propagated
   * 1 s after the reported timestamp, Earth rotation at the timestamp). See docs/informe-validacion.md.
   */
  clockCorrectedErrorKm?: number;
}

export const N2YO_PROPAGATION_LAG_MS = 1000;

function positionPropagatedAt(sat: Satellite, propagateAt: number, rotateAt: number): GeoPosition | null {
  const pv = propagate(sat.satrec, new Date(propagateAt));
  if (!pv || typeof pv.position !== 'object') return null;
  const g = eciToGeodetic(pv.position, gstime(new Date(rotateAt)));
  return { latitude: degreesLat(g.latitude), longitude: degreesLong(g.longitude), altitudeKm: g.height };
}

/** RF-15: compares our SGP4 position against an independent source at the source's own timestamp. */
export function compareWithSample(sat: Satellite, provider: string, sample: ValidationSample): ValidationRow | null {
  const ours = stateAt(sat, sample.timestamp);
  if (!ours) return null;
  const theirs = { latitude: sample.latitude, longitude: sample.longitude, altitudeKm: sample.altitudeKm };
  const corrected =
    sample.provider === 'n2yo'
      ? positionPropagatedAt(sat, sample.timestamp + N2YO_PROPAGATION_LAG_MS, sample.timestamp)
      : null;
  return {
    provider,
    noradId: sat.noradId,
    name: sat.name,
    timestamp: sample.timestamp,
    ours: { latitude: ours.latitude, longitude: ours.longitude, altitudeKm: ours.altitudeKm },
    theirs,
    error3dKm: distance3dKm(ours, theirs),
    groundErrorKm: haversineKm(ours, theirs),
    altitudeDiffKm: ours.altitudeKm - theirs.altitudeKm,
    epochAgeHours: dataAgeHours(sat, sample.timestamp),
    clockCorrectedErrorKm: corrected ? distance3dKm(corrected, theirs) : undefined,
  };
}

export function toMarkdownTable(rows: ValidationRow[]): string {
  const header =
    '| UTC | Satellite | Source | Error 3D (km) | Ground (km) | Δalt (km) | Elements age (h) |\n|---|---|---|---|---|---|---|';
  const lines = rows.map(
    (r) =>
      `| ${new Date(r.timestamp).toISOString().slice(0, 19)} | ${r.name} | ${r.provider} | ${r.error3dKm.toFixed(2)} | ${r.groundErrorKm.toFixed(2)} | ${r.altitudeDiffKm.toFixed(2)} | ${r.epochAgeHours.toFixed(1)} |`,
  );
  return [header, ...lines].join('\n');
}
