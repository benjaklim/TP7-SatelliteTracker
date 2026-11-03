import { ISS, T0 } from '../orbital/__fixtures__/omm';
import { groundTrack, groundTrackStepSec } from '../orbital/groundTrack';
import { createSatellite } from '../orbital/satellite';
import type { LngLat } from '../orbital/types';
import { normalizeLongitude, splitLineAtAntimeridian, splitPolygonAtAntimeridian } from './antimeridian';
import { distance3dKm, haversineKm } from './distance';
import { footprintCentralAngle, footprintPolygon, footprintRadiusKm } from './footprint';

const maxJump = (line: LngLat[]) =>
  line.slice(1).reduce((m, p, i) => Math.max(m, Math.abs(p[0] - line[i][0])), 0);

describe('antimeridian', () => {
  it('normalizes longitudes', () => {
    expect(normalizeLongitude(190)).toBe(-170);
    expect(normalizeLongitude(-190)).toBe(170);
    expect(normalizeLongitude(45)).toBe(45);
  });

  it('splits a line crossing 180° with interpolated edge points', () => {
    const segments = splitLineAtAntimeridian([
      [170, 0],
      [-170, 10],
    ]);
    expect(segments).toEqual([
      [
        [170, 0],
        [180, 5],
      ],
      [
        [-180, 5],
        [-170, 10],
      ],
    ]);
  });

  it('leaves lines that do not cross untouched', () => {
    const line: LngLat[] = [
      [0, 0],
      [10, 10],
      [20, 15],
    ];
    expect(splitLineAtAntimeridian(line)).toEqual([line]);
  });

  it('splits a polygon straddling the antimeridian into two pieces', () => {
    const polygons = splitPolygonAtAntimeridian([
      [170, -10],
      [190, -10],
      [190, 10],
      [170, 10],
    ]);
    expect(polygons).toHaveLength(2);
    for (const [ring] of polygons) {
      for (const [lon] of ring) expect(Math.abs(lon)).toBeLessThanOrEqual(180);
    }
  });
});

describe('footprint', () => {
  it('matches the analytic coverage radius for the ISS at 0° elevation', () => {
    // λ = acos(R / (R + h)) for ε = 0 → ~2,250 km for h = 420 km
    expect(footprintRadiusKm(420, 0)).toBeGreaterThan(2200);
    expect(footprintRadiusKm(420, 0)).toBeLessThan(2300);
  });

  it('shrinks as the minimum elevation grows', () => {
    expect(footprintCentralAngle(420, 10)).toBeLessThan(footprintCentralAngle(420, 0));
    expect(footprintCentralAngle(420, 90)).toBe(0);
  });

  it('covers ~81° of central angle for GEO', () => {
    expect((footprintCentralAngle(35786, 0) * 180) / Math.PI).toBeCloseTo(81.3, 0);
  });

  it('splits a footprint centred near the antimeridian', () => {
    const polygons = footprintPolygon(0, 179, 420, 10);
    expect(polygons).toHaveLength(2);
  });

  it('closes a footprint that contains the pole', () => {
    const polygons = footprintPolygon(85, 30, 800, 0);
    const lats = polygons.flatMap(([ring]) => ring.map(([, lat]) => lat));
    expect(Math.max(...lats)).toBe(90);
    for (const [ring] of polygons) {
      for (const [lon] of ring) expect(Math.abs(lon)).toBeLessThanOrEqual(180);
    }
  });
});

describe('groundTrack', () => {
  const iss = createSatellite(ISS);

  it('uses a 30-60 s step for LEO', () => {
    expect(groundTrackStepSec(92.9)).toBeGreaterThanOrEqual(30);
    expect(groundTrackStepSec(92.9)).toBeLessThanOrEqual(60);
    expect(groundTrackStepSec(1436)).toBe(574);
  });

  it('never draws a segment across the whole map', () => {
    const track = groundTrack(iss, T0);
    expect(track.future.length).toBeGreaterThanOrEqual(1);
    for (const segment of [...track.past, ...track.future]) {
      expect(maxJump(segment)).toBeLessThan(180);
    }
  });

  it('covers at least one full orbit forward', () => {
    const track = groundTrack(iss, T0);
    const samples = track.future.reduce((n, s) => n + s.length, 0);
    expect(samples * track.stepSec).toBeGreaterThanOrEqual(92 * 60);
  });
});

describe('distance', () => {
  it('computes great-circle distance', () => {
    const km = haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
    expect(km).toBeCloseTo(111.2, 0);
  });

  it('includes altitude in the 3D distance', () => {
    const a = { latitude: 10, longitude: 10, altitudeKm: 400 };
    expect(distance3dKm(a, { ...a, altitudeKm: 410 })).toBeCloseTo(10, 3);
  });
});
