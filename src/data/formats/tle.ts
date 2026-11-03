import type { OrbitalRecord } from '../../core';

/** Parses TLE "assumed decimal" fields such as " 10620-3" → 0.10620e-3. */
function parseExponential(field: string): number {
  const s = field.trim();
  if (!s) return 0;
  const match = /^([+-]?)(\d+)([+-]\d)$/.exec(s);
  if (!match) return Number(s);
  const [, sign, mantissa, exponent] = match;
  return Number(`${sign}0.${mantissa}e${exponent}`);
}

function epochToIso(field: string): string {
  const yy = Number(field.slice(0, 2));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const dayOfYear = Number(field.slice(2));
  const ms = Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000;
  return new Date(ms).toISOString().replace('Z', '');
}

function intlDesignator(field: string): string {
  const s = field.trim();
  if (s.length < 5) return s;
  const yy = Number(s.slice(0, 2));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return `${year}-${s.slice(2)}`;
}

/**
 * Converts a Two-Line Element set into the OMM/JSON shape used across the app,
 * so TLE-only sources (N2YO, Where the ISS at?) can feed the same SGP4 pipeline.
 */
export function tleToOmm(name: string, line1: string, line2: string): OrbitalRecord {
  if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) throw new Error('Invalid TLE lines');
  return {
    OBJECT_NAME: name.trim(),
    OBJECT_ID: intlDesignator(line1.slice(9, 17)),
    EPOCH: epochToIso(line1.slice(18, 32)),
    MEAN_MOTION: Number(line2.slice(52, 63)),
    ECCENTRICITY: Number(`0.${line2.slice(26, 33).trim()}`),
    INCLINATION: Number(line2.slice(8, 16)),
    RA_OF_ASC_NODE: Number(line2.slice(17, 25)),
    ARG_OF_PERICENTER: Number(line2.slice(34, 42)),
    MEAN_ANOMALY: Number(line2.slice(43, 51)),
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: line1[7] === 'C' ? 'C' : 'U',
    NORAD_CAT_ID: Number(line1.slice(2, 7)),
    ELEMENT_SET_NO: Number(line1.slice(64, 68)),
    REV_AT_EPOCH: Number(line2.slice(63, 68)),
    BSTAR: parseExponential(line1.slice(53, 61)),
    MEAN_MOTION_DOT: Number(line1.slice(33, 43)),
    MEAN_MOTION_DDOT: parseExponential(line1.slice(44, 52)),
  };
}
