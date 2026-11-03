import { degreesLat, degreesLong, eciToGeodetic, gstime, propagate } from 'satellite.js';

import { createSatellite, stateAt } from '../../core';
import { ISS, T0 } from '../../core/orbital/__fixtures__/omm';
import { compareWithSample, toMarkdownTable } from './validation';

describe('validation', () => {
  const iss = createSatellite(ISS);

  it('reports zero error against itself and the elements age', () => {
    const s = stateAt(iss, T0)!;
    const row = compareWithSample(iss, 'self', {
      provider: 'wtia',
      noradId: 25544,
      timestamp: T0,
      latitude: s.latitude,
      longitude: s.longitude,
      altitudeKm: s.altitudeKm,
    })!;
    expect(row.error3dKm).toBeCloseTo(0, 6);
    expect(row.epochAgeHours).toBeCloseTo((T0 - iss.epoch) / 3_600_000);
  });

  it('measures a 1° longitude offset at the equator as ~111 km on the ground', () => {
    const s = stateAt(iss, T0)!;
    const row = compareWithSample(iss, 'shifted', {
      provider: 'n2yo',
      noradId: 25544,
      timestamp: T0,
      latitude: s.latitude,
      longitude: s.longitude + 1,
      altitudeKm: s.altitudeKm,
    })!;
    const expected = 111.2 * Math.cos((s.latitude * Math.PI) / 180);
    expect(row.groundErrorKm).toBeCloseTo(expected, -1);
    expect(toMarkdownTable([row])).toContain('| ISS (ZARYA) | shifted |');
  });

  it('reproduces the N2YO timing convention (propagated 1 s later, rotated at the timestamp)', () => {
    // Synthetic N2YO sample: TEME state at T0 + 1 s, rotated with GMST at T0.
    const pv = propagate(iss.satrec, new Date(T0 + 1000))!;
    const g = eciToGeodetic(pv.position, gstime(new Date(T0)));
    const row = compareWithSample(iss, 'N2YO', {
      provider: 'n2yo',
      noradId: 25544,
      timestamp: T0,
      latitude: degreesLat(g.latitude),
      longitude: degreesLong(g.longitude),
      altitudeKm: g.height,
    })!;
    expect(row.error3dKm).toBeCloseTo(7.66, 0);
    expect(row.clockCorrectedErrorKm!).toBeLessThan(1e-6);
  });
});
