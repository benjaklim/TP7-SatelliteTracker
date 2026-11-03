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

const PassesContext = createContext<PassesState>({ passes: [], computing: false, computedAt: null, computeMs: 0 });

/**
 * Prediction service: AOS/TCA/LOS for the next 72 h, computed cooperatively
 * (coarse → fine) so the map keeps rendering while it runs.
 */
export function PassesProvider({ children }: { children: ReactNode }) {
  const { satellite } = useSelectedSatellite();
  const observer = trackingStore.use((s) => s.observer);
  const minElevation = settingsStore.use((s) => s.minElevation);
  const [state, setState] = useState<PassesState>({ passes: [], computing: false, computedAt: null, computeMs: 0 });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), RECOMPUTE_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!satellite) {
      setState({ passes: [], computing: false, computedAt: null, computeMs: 0 });
      return;
    }
    const signal = { cancelled: false };
    const started = Date.now();
    setState((s) => ({ ...s, computing: true }));
    findPassesAsync(
      satellite,
      observer,
      { start: started, hours: PASS_WINDOW_HOURS, minElevation, maxPasses: 25 },
      signal,
    ).then((passes) => {
      if (!signal.cancelled) {
        setState({ passes, computing: false, computedAt: Date.now(), computeMs: Date.now() - started });
      }
    });
    return () => {
      signal.cancelled = true;
    };
  }, [satellite, observer, minElevation, tick]);

  return <PassesContext.Provider value={state}>{children}</PassesContext.Provider>;
}

export function usePasses(): PassesState {
  return useContext(PassesContext);
}

/** First pass whose LOS is still in the future. */
export function nextPass(passes: Pass[], now: number): Pass | undefined {
  return passes.find((p) => p.los > now);
}
