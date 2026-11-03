import { GOES16, ISS, BUENOS_AIRES, T0 } from './__fixtures__/omm';
import {
  classifyOrbit,
  createSatellite,
  dataAgeHours,
  lookAnglesAt,
  orbitalPeriodMinutes,
  parseEpoch,
  stateAt,
} from './satellite';

describe('satellite', () => {
  const iss = createSatellite(ISS);
  const goes = createSatellite(GOES16);

  it('parses OMM epochs as UTC', () => {
    expect(parseEpoch('2026-11-02T18:09:49.393152')).toBe(Date.parse('2026-11-02T18:09:49.393Z'));
    expect(parseEpoch('2026-11-02T18:09:49Z')).toBe(Date.parse('2026-11-02T18:09:49Z'));
  });

  it('propagates the ISS to a realistic LEO state', () => {
    const s = stateAt(iss, T0)!;
    expect(s.altitudeKm).toBeGreaterThan(370);
    expect(s.altitudeKm).toBeLessThan(450);
    expect(Math.abs(s.latitude)).toBeLessThanOrEqual(51.7);
    expect(s.longitude).toBeGreaterThanOrEqual(-180);
    expect(s.longitude).toBeLessThanOrEqual(180);
    expect(s.velocityKmS).toBeCloseTo(7.66, 1);
  });

  it('computes orbital period and orbit class', () => {
    expect(orbitalPeriodMinutes(iss)).toBeCloseTo(1440 / 15.49154261, 1);
    expect(classifyOrbit(iss)).toBe('LEO');
    expect(classifyOrbit(goes)).toBe('GEO');
  });

  it('keeps GEO satellites nearly fixed over the equator', () => {
    const a = stateAt(goes, T0)!;
    const b = stateAt(goes, T0 + 6 * 3_600_000)!;
    expect(a.altitudeKm).toBeCloseTo(35786, -2);
    expect(Math.abs(a.latitude)).toBeLessThan(1);
    expect(Math.abs(a.longitude - b.longitude)).toBeLessThan(0.5);
  });

  it('computes look angles in range', () => {
    const look = lookAnglesAt(iss, BUENOS_AIRES, T0)!;
    expect(look.azimuth).toBeGreaterThanOrEqual(0);
    expect(look.azimuth).toBeLessThan(360);
    expect(look.elevation).toBeGreaterThanOrEqual(-90);
    expect(look.elevation).toBeLessThanOrEqual(90);
    expect(look.rangeKm).toBeGreaterThan(300);
  });

  it('reports data age relative to the epoch', () => {
    expect(dataAgeHours(iss, iss.epoch + 5 * 3_600_000)).toBeCloseTo(5);
  });
});
