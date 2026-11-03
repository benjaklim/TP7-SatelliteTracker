import { useEffect, useRef, useState } from 'react';

import { createSatellite, stateAt, type Satellite } from '../../../core';
import { DATASET_KEY } from '../../../data/providers/CelesTrakProvider';
import { getOrchestrator } from '../../../services/container';

export interface ConstellationState {
  geojson: GeoJSON.FeatureCollection<GeoJSON.Point>;
  count: number;
  computeMs: number;
  fetchedAt: number | null;
  /** 'SupGP' (operator ephemerides) or 'GP' fallback, null when unknown (e.g. Space-Track). */
  dataset: string | null;
  error: string | null;
}

const EMPTY: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: 'FeatureCollection', features: [] };
const REFRESH_MS = 2000;
const CHUNK = 100;

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Constellation layer (RF-13): a single GeoJSON source rendered by one CircleLayer,
 * propagated in chunks that yield to the UI thread, throttled to one batch every 2 s.
 */
export function useConstellation(enabled: boolean, limit: number): ConstellationState {
  const [state, setState] = useState<ConstellationState>({
    geojson: EMPTY,
    count: 0,
    computeMs: 0,
    fetchedAt: null,
    dataset: null,
    error: null,
  });
  const satellites = useRef<Satellite[]>([]);

  useEffect(() => {
    if (!enabled) {
      satellites.current = [];
      setState((s) => ({ ...s, geojson: EMPTY, count: 0 }));
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const started = Date.now();
      const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
      const list = satellites.current;
      for (let i = 0; i < list.length; i += CHUNK) {
        for (const sat of list.slice(i, i + CHUNK)) {
          const s = stateAt(sat, started);
          if (!s) continue;
          features.push({
            type: 'Feature',
            properties: { id: sat.noradId, name: sat.name },
            geometry: { type: 'Point', coordinates: [s.longitude, s.latitude] },
          });
        }
        await yieldToUi();
        if (cancelled) return;
      }
      setState((prev) => ({
        ...prev,
        geojson: { type: 'FeatureCollection', features },
        count: features.length,
        computeMs: Date.now() - started,
      }));
      timer = setTimeout(tick, REFRESH_MS);
    };

    (async () => {
      try {
        const result = await getOrchestrator().getCatalog('starlink', { limit });
        if (cancelled) return;
        satellites.current = result.data.flatMap((record) => {
          try {
            return [createSatellite(record)];
          } catch {
            return [];
          }
        });
        const dataset = result.data[0]?.[DATASET_KEY];
        setState((s) => ({
          ...s,
          fetchedAt: result.fetchedAt,
          dataset: typeof dataset === 'string' ? dataset : null,
          error: null,
        }));
        void tick();
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, limit]);

  return state;
}
