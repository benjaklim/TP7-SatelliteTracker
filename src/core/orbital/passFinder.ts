import { eciToEcf, type GeodeticLocation } from 'satellite.js';

import {
  lookAnglesAt,
  lookAnglesFromEcf,
  propagateEci,
  toObserverGeodetic,
  type Satellite,
} from './satellite';
import { DARK_SKY_SUN_ELEVATION, isSunlit, sunElevation } from './sun';
import type { Observer, Pass, SkyPoint } from './types';

export interface PassSearchOptions {
  /** Search window start (ms epoch). */
  start: number;
  /** Search window length in hours. */
  hours: number;
  /** Minimum elevation (degrees) that defines AOS/LOS. */
  minElevation: number;
  /** Coarse scan step in seconds (default 60 s). */
  coarseStepSec?: number;
  /** Refinement tolerance in seconds (default 1 s). */
  toleranceSec?: number;
  maxPasses?: number;
}

/** Margin below the threshold in which a local maximum is refined to catch short grazing passes. */
const GRAZE_MARGIN_DEG = 6;
const SAMPLES_PER_YIELD = 400;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

type ElevationFn = (t: number) => number;

function elevationFn(sat: Satellite, observer: GeodeticLocation): ElevationFn {
  return (t) => lookAnglesAt(sat, observer, t)?.elevation ?? -90;
}

/** Bisection on a threshold crossing. Rising edges return the first instant at/above `min`. */
function bisectCrossing(el: ElevationFn, a: number, b: number, min: number, tol: number): number {
  const rising = el(a) < min;
  while (b - a > tol) {
    const mid = (a + b) / 2;
    const above = el(mid) >= min;
    if (above === rising) b = mid;
    else a = mid;
  }
  return rising ? b : a;
}

/** Golden-section search for the elevation maximum in [a, b]. */
function goldenMax(el: ElevationFn, a: number, b: number, tol: number): number {
  let c = b - GOLDEN * (b - a);
  let d = a + GOLDEN * (b - a);
  let fc = el(c);
  let fd = el(d);
  while (b - a > tol) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - GOLDEN * (b - a);
      fc = el(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + GOLDEN * (b - a);
      fd = el(d);
    }
  }
  return (a + b) / 2;
}

function isOptical(sat: Satellite, observer: GeodeticLocation, aos: number, los: number): boolean {
  for (let i = 0; i <= 4; i++) {
    const t = aos + ((los - aos) * i) / 4;
    const sample = propagateEci(sat, t);
    if (
      sample &&
      isSunlit(sample.position, t) &&
      sunElevation(observer, t) < DARK_SKY_SUN_ELEVATION
    ) {
      return true;
    }
  }
  return false;
}

function buildPass(
  sat: Satellite,
  observer: GeodeticLocation,
  el: ElevationFn,
  aos: number,
  los: number,
  tol: number,
  flags: { inProgress: boolean; truncated: boolean },
): Pass {
  const tca = goldenMax(el, aos, los, tol);
  const az = (t: number) => lookAnglesAt(sat, observer, t)?.azimuth ?? 0;
  return {
    aos,
    tca,
    los,
    maxElevation: el(tca),
    aosAzimuth: az(aos),
    tcaAzimuth: az(tca),
    losAzimuth: az(los),
    optical: isOptical(sat, observer, aos, los),
    ...flags,
  };
}

/**
 * Coarse-to-fine AOS/LOS search.
 * 1. Coarse scan of the elevation every `coarseStepSec`.
 * 2. Threshold crossings refined by bisection down to `toleranceSec`.
 * 3. TCA (max elevation) refined by golden-section search.
 * 4. Local maxima just below the threshold are refined too, so passes shorter
 *    than the coarse step are not lost.
 * Yields `null` periodically so callers can hand control back to the UI thread.
 */
export function* scanPasses(
  sat: Satellite,
  observer: Observer,
  options: PassSearchOptions,
): Generator<Pass | null, void, void> {
  const min = options.minElevation;
  const step = (options.coarseStepSec ?? 60) * 1000;
  const tol = (options.toleranceSec ?? 1) * 1000;
  const maxPasses = options.maxPasses ?? Infinity;
  const start = options.start;
  const end = start + options.hours * 3_600_000;
  const geo = toObserverGeodetic(observer);
  const el = elevationFn(sat, geo);

  let found = 0;
  let prev2 = Number.NaN;
  let prev = el(start);
  let inPass = prev >= min;
  let aos = start;
  let inProgress = inPass;
  let samples = 0;

  for (let t = start + step; t <= end; t += step) {
    const cur = el(t);
    if (!inPass) {
      if (prev < min && cur >= min) {
        aos = bisectCrossing(el, t - step, t, min, tol);
        inPass = true;
        inProgress = false;
      } else if (prev > prev2 && prev >= cur && prev < min && prev > min - GRAZE_MARGIN_DEG) {
        const peak = goldenMax(el, t - 2 * step, t, tol);
        if (el(peak) >= min) {
          yield buildPass(
            sat,
            geo,
            el,
            bisectCrossing(el, t - 2 * step, peak, min, tol),
            bisectCrossing(el, peak, t, min, tol),
            tol,
            { inProgress: false, truncated: false },
          );
          if (++found >= maxPasses) return;
        }
      }
    } else if (cur < min) {
      const los = bisectCrossing(el, t - step, t, min, tol);
      yield buildPass(sat, geo, el, aos, los, tol, { inProgress, truncated: false });
      inPass = false;
      if (++found >= maxPasses) return;
    }
    prev2 = prev;
    prev = cur;
    if (++samples % SAMPLES_PER_YIELD === 0) yield null;
  }

  if (inPass && found < maxPasses) {
    yield buildPass(sat, geo, el, aos, end, tol, { inProgress, truncated: true });
  }
}

export function findPasses(sat: Satellite, observer: Observer, options: PassSearchOptions): Pass[] {
  const passes: Pass[] = [];
  for (const item of scanPasses(sat, observer, options)) if (item) passes.push(item);
  return passes;
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Same as `findPasses` but cooperatively yields so the JS thread stays responsive. */
export async function findPassesAsync(
  sat: Satellite,
  observer: Observer,
  options: PassSearchOptions,
  signal?: { cancelled: boolean },
): Promise<Pass[]> {
  const passes: Pass[] = [];
  for (const item of scanPasses(sat, observer, options)) {
    if (signal?.cancelled) break;
    if (item) passes.push(item);
    else await yieldToEventLoop();
  }
  return passes;
}

/** Sky-chart samples (az/el) between AOS and LOS. */
export function passTrack(sat: Satellite, observer: Observer, pass: Pass, stepSec = 10): SkyPoint[] {
  const geo = toObserverGeodetic(observer);
  const points: SkyPoint[] = [];
  const stepMs = stepSec * 1000;
  for (let t = pass.aos; t < pass.los + stepMs; t += stepMs) {
    const ts = Math.min(t, pass.los);
    const sample = propagateEci(sat, ts);
    if (!sample) continue;
    points.push({
      timestamp: ts,
      ...lookAnglesFromEcf(geo, eciToEcf(sample.position, sample.gmst)),
    });
  }
  return points;
}
