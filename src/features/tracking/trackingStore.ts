import type { Observer } from '../../core';
import { loadJson, saveJson } from '../../shared/persistence';
import { createStore } from '../../shared/store';

export type ObserverSource = 'gps' | 'manual' | 'default';

export interface TrackingState {
  selectedNoradId: number;
  selectedName: string;
  observer: Observer;
  observerSource: ObserverSource;
}

/** Fallback observer when location is unavailable: Buenos Aires. */
export const DEFAULT_OBSERVER: Observer = { latitude: -34.6037, longitude: -58.3816, altitudeKm: 0.025 };

const KEY = 'tracking.v1';

export const trackingStore = createStore<TrackingState>(
  loadJson(KEY, {
    selectedNoradId: 25544,
    selectedName: 'ISS (ZARYA)',
    observer: DEFAULT_OBSERVER,
    observerSource: 'default' as ObserverSource,
  }),
  (s) => saveJson(KEY, { selectedNoradId: s.selectedNoradId, selectedName: s.selectedName }),
);

export function selectSatellite(noradId: number, name: string) {
  trackingStore.set({ selectedNoradId: noradId, selectedName: name });
}
