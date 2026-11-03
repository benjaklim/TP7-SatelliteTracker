import Constants from 'expo-constants';

import type { Observer } from '../../core';
import { loadJson, saveJson } from '../../shared/persistence';
import { createStore } from '../../shared/store';

export interface Settings {
  /** Minimum elevation (deg) used for AOS/LOS and the footprint (ITU-R style operating mask). */
  minElevation: number;
  /** Minutes before AOS to fire the pass reminder. */
  leadMinutes: number;
  /** Max Starlink objects in the constellation layer. */
  constellationLimit: number;
  showConstellation: boolean;
  showGroundTrack: boolean;
  showFootprint: boolean;
  /** Only remind passes reaching at least this elevation. */
  reminderMinElevation: number;
  proxyUrl: string;
  manualObserver: Observer | null;
}

const KEY = 'settings.v1';

export const DEFAULT_PROXY_URL: string =
  (Constants.expoConfig?.extra?.proxyUrl as string | undefined) ?? 'http://10.0.2.2:8787';

export const DEFAULT_SETTINGS: Settings = {
  minElevation: 10,
  leadMinutes: 10,
  constellationLimit: 300,
  showConstellation: false,
  showGroundTrack: true,
  showFootprint: true,
  reminderMinElevation: 20,
  proxyUrl: DEFAULT_PROXY_URL,
  manualObserver: null,
};

export const settingsStore = createStore<Settings>(loadJson(KEY, DEFAULT_SETTINGS), (s) => saveJson(KEY, s));
