import { BUENOS_AIRES, GOES16, ISS, T0 } from './__fixtures__/omm';
import { findPasses, findPassesAsync, passTrack } from './passFinder';
import { lookAnglesAt, createSatellite } from './satellite';

const MIN_EL = 10;

/** Brute-force reference: elevation sampled every second. */
function bruteForcePasses(start: number, hours: number) {
  const iss = createSatellite(ISS);
  const passes: { aos: number; los: number; max: number }[] = [];
  let current: { aos: number; los: number; max: number } | null = null;
  for (let t = start; t <= start + hours * 3_600_000; t += 1000) {
    const el = lookAnglesAt(iss, BUENOS_AIRES, t)!.elevation;
    if (el >= MIN_EL) {
      if (!current) current = { aos: t, los: t, max: el };
      current.los = t;
      current.max = Math.max(current.max, el);
    } else if (current) {
      passes.push(current);
      current = null;
    }
  }
  return passes;
}

describe('passFinder', () => {
  const iss = createSatellite(ISS);
  const options = { start: T0, hours: 24, minElevation: MIN_EL };

  it('matches a 1-second brute-force scan', () => {
    const passes = findPasses(iss, BUENOS_AIRES, options);
    const reference = bruteForcePasses(T0, 24);
    expect(passes.length).toBe(reference.length);
    passes.forEach((p, i) => {
      expect(Math.abs(p.aos - reference[i].aos)).toBeLessThanOrEqual(2000);
      expect(Math.abs(p.los - reference[i].los)).toBeLessThanOrEqual(2000);
      expect(p.maxElevation).toBeCloseTo(reference[i].max, 1);
    });
  });

  it('orders AOS < TCA < LOS with elevations consistent with the threshold', () => {
    const passes = findPasses(iss, BUENOS_AIRES, { ...options, hours: 72 });
    expect(passes.length).toBeGreaterThan(0);
    for (const p of passes) {
      expect(p.aos).toBeLessThan(p.tca);
      expect(p.tca).toBeLessThan(p.los);
      expect(p.maxElevation).toBeGreaterThanOrEqual(MIN_EL);
      expect(lookAnglesAt(iss, BUENOS_AIRES, p.aos)!.elevation).toBeCloseTo(MIN_EL, 0);
      expect(p.los - p.aos).toBeLessThan(15 * 60_000);
    }
  });

  it('honours maxPasses and the async variant returns the same result', async () => {
    const sync = findPasses(iss, BUENOS_AIRES, { ...options, maxPasses: 2 });
    const async = await findPassesAsync(iss, BUENOS_AIRES, { ...options, maxPasses: 2 });
    expect(sync).toHaveLength(2);
    expect(async).toEqual(sync);
  });

  it('flags a geostationary satellite as a single truncated in-progress pass', () => {
    const goes = createSatellite(GOES16);
    const passes = findPasses(goes, BUENOS_AIRES, options);
    expect(passes).toHaveLength(1);
    expect(passes[0].inProgress).toBe(true);
    expect(passes[0].truncated).toBe(true);
  });

  it('finds no passes for a GEO satellite below the horizon', () => {
    const goes = createSatellite(GOES16);
    const tokyo = { latitude: 35.68, longitude: 139.69, altitudeKm: 0 };
    expect(findPasses(goes, tokyo, options)).toHaveLength(0);
  });

  it('builds a sky track that starts at AOS and ends at LOS', () => {
    const [pass] = findPasses(iss, BUENOS_AIRES, options);
    const track = passTrack(iss, BUENOS_AIRES, pass);
    expect(track[0].timestamp).toBe(pass.aos);
    expect(track[track.length - 1].timestamp).toBe(pass.los);
    expect(Math.max(...track.map((p) => p.elevation))).toBeCloseTo(pass.maxElevation, 0);
  });
});
