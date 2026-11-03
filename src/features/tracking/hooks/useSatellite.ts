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

/**
 * Loads orbital elements through the orchestrator (cache → providers → stale cache)
 * and re-checks the TTL every minute so data refreshes automatically (RF-09).
 */
export function useSatellite(noradId: number): SatelliteData {
  const [satellite, setSatellite] = useState<Satellite | null>(null);
  const [meta, setMeta] = useState<SatelliteData['meta']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      try {
        const result = await getOrchestrator().getOrbitalData(noradId, { force });
        setSatellite(createSatellite(result.data));
        setMeta({ source: result.source, fetchedAt: result.fetchedAt, stale: result.stale });
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [noradId],
  );

  useEffect(() => {
    setSatellite(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!meta) return;
    const id = setInterval(() => {
      if (!getOrchestrator().isFresh(meta.fetchedAt)) void load(true);
    }, TTL_CHECK_MS);
    return () => clearInterval(id);
  }, [meta, load]);

  return { satellite, meta, loading, error, refresh: (force) => void load(force) };
}
