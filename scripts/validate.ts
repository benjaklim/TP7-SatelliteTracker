/**
 * Validation report generator (deliverable "Informe de validación").
 *
 * Uses exactly the same orbital engine and comparison code as the app, fetches
 * fresh OMM elements from CelesTrak and compares our SGP4 positions against
 * N2YO (through the proxy, which holds the API key) and Where the ISS at?.
 *
 *   npx tsx scripts/validate.ts [--proxy http://localhost:8787] [--samples 5]
 */
import { writeFileSync } from 'node:fs';

import { createSatellite, type OrbitalRecord } from '../src/core';
import { compareWithSample, toMarkdownTable, type ValidationRow } from '../src/features/validation/validation';
import type { ValidationSample } from '../src/data/types';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const PROXY = args.get('proxy') ?? 'http://localhost:8787';
const SAMPLES = Number(args.get('samples') ?? 5);
const SPACING_MS = 15_000;

/** LEO, sun-synchronous, MEO and GEO cases, plus one Starlink from the SupGP set. */
const TARGETS: { norad: number; label: string; supgp?: boolean }[] = [
  { norad: 25544, label: 'ISS (LEO 51.6°)' },
  { norad: 20580, label: 'Hubble (LEO 28.5°)' },
  { norad: 33591, label: 'NOAA 19 (LEO SSO)' },
  { norad: 43013, label: 'NOAA 20 (LEO SSO)' },
  { norad: 28874, label: 'GPS BIIR-13 (MEO)' },
  { norad: 41866, label: 'GOES 16 (GEO)' },
];

const OBSERVER = { latitude: -34.6037, longitude: -58.3816, altitudeKm: 0.025 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url.replace(/apiKey=[^&]+/, 'apiKey=***')}`);
  return (await res.json()) as T;
}

async function celestrak(norad: number): Promise<OrbitalRecord> {
  const [record] = await json<OrbitalRecord[]>(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${norad}&FORMAT=json`);
  if (!record) throw new Error(`No GP data for ${norad}`);
  return record;
}

async function starlinkSupGp(): Promise<OrbitalRecord> {
  // Prefer the proxy cache: CelesTrak only allows one SupGP download every 2 h.
  const all = await json<OrbitalRecord[]>(`${PROXY}/v1/celestrak/supgp/starlink?limit=200`).catch(() =>
    json<OrbitalRecord[]>('https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=json'),
  );
  // Use an object that also exists in the public catalog (5-digit NORAD) so N2YO knows it.
  const pick = all.find((r) => Number(r.NORAD_CAT_ID) < 90000);
  if (!pick) throw new Error('No Starlink SupGP object with a public NORAD id');
  return pick;
}

async function n2yo(norad: number): Promise<ValidationSample | null> {
  try {
    const data = await json<{ positions: { satlatitude: number; satlongitude: number; sataltitude: number; timestamp: number }[] }>(
      `${PROXY}/v1/n2yo/positions/${norad}?lat=${OBSERVER.latitude}&lon=${OBSERVER.longitude}&alt=25`,
    );
    const p = data.positions[0];
    return { provider: 'n2yo', noradId: norad, timestamp: p.timestamp * 1000, latitude: p.satlatitude, longitude: p.satlongitude, altitudeKm: p.sataltitude };
  } catch (e) {
    console.warn(`N2YO unavailable for ${norad}: ${(e as Error).message}`);
    return null;
  }
}

async function wtia(): Promise<ValidationSample | null> {
  try {
    const p = await json<{ latitude: number; longitude: number; altitude: number; timestamp: number }>(
      'https://api.wheretheiss.at/v1/satellites/25544?units=kilometers',
    );
    return { provider: 'wtia', noradId: 25544, timestamp: p.timestamp * 1000, latitude: p.latitude, longitude: p.longitude, altitudeKm: p.altitude };
  } catch (e) {
    console.warn(`Where the ISS at? unavailable: ${(e as Error).message}`);
    return null;
  }
}

const stats = (values: number[]) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { mean, max: Math.max(...values), min: Math.min(...values), sd };
};

async function main() {
  const records = new Map<number, { record: OrbitalRecord; label: string }>();
  for (const t of TARGETS) records.set(t.norad, { record: await celestrak(t.norad), label: t.label });
  try {
    const starlink = await starlinkSupGp();
    records.set(Number(starlink.NORAD_CAT_ID), { record: starlink, label: `${starlink.OBJECT_NAME} (SupGP)` });
  } catch (e) {
    console.warn(`Starlink SupGP skipped: ${(e as Error).message}`);
  }

  const rows: (ValidationRow & { label: string })[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    for (const [norad, { record, label }] of records) {
      const sat = createSatellite(record);
      const samples = [await n2yo(norad), norad === 25544 ? await wtia() : null].filter(
        (s): s is ValidationSample => s !== null,
      );
      for (const s of samples) {
        const row = compareWithSample(sat, s.provider === 'n2yo' ? 'N2YO' : 'Where the ISS at?', s);
        if (row) rows.push({ ...row, label });
      }
      await sleep(1100); // Where the ISS at? asks for ~1 req/s
    }
    console.log(`sample ${i + 1}/${SAMPLES}: ${rows.length} rows`);
    if (i < SAMPLES - 1) await sleep(SPACING_MS);
  }

  if (rows.length === 0) throw new Error('No validation samples collected (is the proxy running with an N2YO key?)');

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.label}|${r.provider}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const summary = [...groups.entries()].map(([key, list]) => {
    const [label, provider] = key.split('|');
    const e = stats(list.map((r) => r.error3dKm));
    const g = stats(list.map((r) => r.groundErrorKm));
    return `| ${label} | ${provider} | ${list.length} | ${e.mean.toFixed(2)} | ${e.sd.toFixed(2)} | ${e.max.toFixed(2)} | ${g.mean.toFixed(2)} | ${list[0].epochAgeHours.toFixed(1)} |`;
  });

  const md = `<!-- generated by scripts/validate.ts on ${new Date().toISOString()} -->
### Resumen por satélite y fuente

| Satélite | Fuente | n | Error 3D medio (km) | σ (km) | Error 3D máx (km) | Error suelo medio (km) | Antigüedad elementos (h) |
|---|---|---|---|---|---|---|---|
${summary.join('\n')}

### Muestras

${toMarkdownTable(rows)}
`;
  writeFileSync('docs/validation-results.md', md);
  writeFileSync('docs/validation-results.json', JSON.stringify(rows, null, 2));
  console.log(md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
