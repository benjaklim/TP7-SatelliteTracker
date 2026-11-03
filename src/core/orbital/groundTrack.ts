import { splitLineAtAntimeridian } from '../geo/antimeridian';
import { orbitalPeriodMinutes, stateAt, type Satellite } from './satellite';
import type { LngLat } from './types';

export interface GroundTrack {
  past: LngLat[][];
  future: LngLat[][];
  stepSec: number;
}

export interface GroundTrackOptions {
  /** How many orbits to draw on each side of `center` (default 1). */
  orbits?: number;
  /** Override the automatic sampling step. */
  stepSec?: number;
}

/**
 * Sampling step adapted to the orbit: ~150 samples per revolution, clamped to
 * 30–600 s (≈37 s for the ISS, ≈575 s for GEO).
 */
export function groundTrackStepSec(periodMinutes: number): number {
  return Math.min(600, Math.max(30, Math.round((periodMinutes * 60) / 150)));
}

function sample(sat: Satellite, from: number, to: number, stepMs: number): LngLat[] {
  const points: LngLat[] = [];
  for (let t = from; t <= to; t += stepMs) {
    const s = stateAt(sat, t);
    if (s) points.push([s.longitude, s.latitude]);
  }
  return points;
}

/** Past and future ground track around `center`, split at the antimeridian. */
export function groundTrack(
  sat: Satellite,
  center: number,
  options: GroundTrackOptions = {},
): GroundTrack {
  const period = orbitalPeriodMinutes(sat);
  const stepSec = options.stepSec ?? groundTrackStepSec(period);
  const span = period * 60_000 * (options.orbits ?? 1);
  const stepMs = stepSec * 1000;
  return {
    past: splitLineAtAntimeridian(sample(sat, center - span, center, stepMs)),
    future: splitLineAtAntimeridian(sample(sat, center, center + span, stepMs)),
    stepSec,
  };
}
