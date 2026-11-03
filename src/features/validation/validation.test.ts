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
});
