import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { findPassesAsync, type Pass } from '../../core';
import { settingsStore } from '../settings/settingsStore';
import { useSelectedSatellite } from '../tracking/SelectedSatelliteContext';
import { trackingStore } from '../tracking/trackingStore';

export const PASS_WINDOW_HOURS = 72;
const RECOMPUTE_MS = 10 * 60_000;

interface PassesState {
  passes: Pass[];
  computing: boolean;
  computedAt: number | null;
  computeMs: number;
}

interface Computed {
  key: string;
  passes: Pass[];
  computedAt: number;
  computeMs: number;
}

const PassesContext = createContext<PassesState>({ passes: [], computing: false, computedAt: null, computeMs: 0 });

/**
 * Prediction service: AOS/TCA/LOS for the next 72 h, computed cooperatively
 * (coarse → fine) so the map keeps rendering while it runs.
 */
export function PassesProvider({ children }: { children: ReactNode }) {
  const { satellite } = useSelectedSatellite();
  const observer = trackingStore.use((s) => s.observer);
  const minElevation = settingsStore.use((s) => s.minElevation);
  const [computed, setComputed] = useState<Computed | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), RECOMPUTE_MS);
    return () => clearInterval(id);
  }, []);

  // Identifies the inputs of a computation; results for older inputs are ignored.
  const key = satellite
    ? `${satellite.noradId}:${satellite.epoch}:${observer.latitude}:${observer.longitude}:${minElevation}:${tick}`
    : null;

  useEffect(() => {
    if (!satellite || !key) return;
    const signal = { cancelled: false };
    const started = Date.now();
    findPassesAsync(
      satellite,
      observer,
      { start: started, hours: PASS_WINDOW_HOURS, minElevation, maxPasses: 25 },
      signal,
    ).then((passes) => {
      if (!signal.cancelled) {
        setComputed({ key, passes, computedAt: Date.now(), computeMs: Date.now() - started });
      }
    });
    return () => {
      signal.cancelled = true;
    };
    // `key` captures every input that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const fresh = computed !== null && computed.key === key;
  // While recomputing for the same satellite, keep showing the previous passes.
  const sameSatellite = computed !== null && satellite !== null && computed.key.startsWith(`${satellite.noradId}:`);
  const value: PassesState = {
    passes: sameSatellite ? computed.passes : [],
    computing: key !== null && !fresh,
    computedAt: sameSatellite ? computed.computedAt : null,
    computeMs: sameSatellite ? computed.computeMs : 0,
  };

  return <PassesContext.Provider value={value}>{children}</PassesContext.Provider>;
}

export function usePasses(): PassesState {
  return useContext(PassesContext);
}

/** First pass whose LOS is still in the future. */
export function nextPass(passes: Pass[], now: number): Pass | undefined {
  return passes.find((p) => p.los > now);
}
