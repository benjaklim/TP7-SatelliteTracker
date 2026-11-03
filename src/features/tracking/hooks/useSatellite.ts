import { useCallback, useEffect, useState } from 'react';

import { createSatellite, type Satellite } from '../../../core';
import type { FetchResult } from '../../../data/types';
import { getOrchestrator } from '../../../services/container';

export interface SatelliteData {
  satellite: Satellite | null;
  meta: Omit<FetchResult<unknown>, 'data'> | null;
  loading: boolean;
  error: string | null;
  refresh: (force?: boolean) => void;
}

/** Elements older than this make SGP4 errors grow past a few km: warn the user (RF-16). */
export const STALE_EPOCH_HOURS = 72;
const TTL_CHECK_MS = 60_000;

interface Loaded {
  noradId: number;
  satellite: Satellite | null;
  meta: SatelliteData['meta'];
  error: string | null;
}

/**
 * Loads orbital elements through the orchestrator (cache → providers → stale cache)
 * and re-checks the TTL every minute so data refreshes automatically (RF-09).
 */
export function useSatellite(noradId: number): SatelliteData {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (force: boolean) => {
      try {
        const result = await getOrchestrator().getOrbitalData(noradId, { force });
        setLoaded({
          noradId,
          satellite: createSatellite(result.data),
          meta: { source: result.source, fetchedAt: result.fetchedAt, stale: result.stale },
          error: null,
        });
      } catch (e) {
        setLoaded((prev) => ({
          noradId,
          satellite: prev?.noradId === noradId ? prev.satellite : null,
          meta: prev?.noradId === noradId ? prev.meta : null,
          error: e instanceof Error ? e.message : String(e),
        }));
      } finally {
        setRefreshing(false);
      }
    },
    [noradId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // Only data for the currently selected satellite is exposed.
  const current = loaded?.noradId === noradId ? loaded : null;
  const fetchedAt = current?.meta?.fetchedAt;

  useEffect(() => {
    if (fetchedAt === undefined) return;
    const id = setInterval(() => {
      if (!getOrchestrator().isFresh(fetchedAt)) void load(true);
    }, TTL_CHECK_MS);
    return () => clearInterval(id);
  }, [fetchedAt, load]);

  return {
    satellite: current?.satellite ?? null,
    meta: current?.meta ?? null,
    loading: !current || refreshing,
    error: current?.error ?? null,
    refresh: (force = false) => {
      setRefreshing(true);
      void load(force);
    },
  };
}
