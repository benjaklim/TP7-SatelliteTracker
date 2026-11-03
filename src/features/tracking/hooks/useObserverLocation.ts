import * as Location from 'expo-location';
import { useEffect } from 'react';

import { settingsStore } from '../../settings/settingsStore';
import { DEFAULT_OBSERVER, trackingStore } from '../trackingStore';

/**
 * Observer layer: resolves the user position once (manual override > GPS > default)
 * and keeps it in the tracking store. Passes don't need sub-km accuracy, so a
 * balanced fix refreshed on significant movement is enough.
 */
export function useObserverLocation() {
  const manual = settingsStore.use((s) => s.manualObserver);

  useEffect(() => {
    if (manual) {
      trackingStore.set({ observer: manual, observerSource: 'manual' });
      return;
    }
    let subscription: Location.LocationSubscription | undefined;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) {
        trackingStore.set({ observer: DEFAULT_OBSERVER, observerSource: 'default' });
        return;
      }
      const apply = (pos: Location.LocationObject) =>
        trackingStore.set({
          observer: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            altitudeKm: (pos.coords.altitude ?? 0) / 1000,
          },
          observerSource: 'gps',
        });
      const last = await Location.getLastKnownPositionAsync();
      if (last && !cancelled) apply(last);
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 500, timeInterval: 30_000 },
        apply,
      );
      if (cancelled) subscription.remove();
    })().catch(() => trackingStore.set({ observer: DEFAULT_OBSERVER, observerSource: 'default' }));
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [manual]);
}
