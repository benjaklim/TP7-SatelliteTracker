import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useState } from 'react';

export interface DeviceOrientation {
  /** Heading (deg from true north, falling back to magnetic) of the phone's top edge. */
  heading: number | null;
  /** Elevation (deg above the horizon) of the phone's top edge: 0 flat, 90 upright. */
  pitch: number | null;
  available: boolean;
}

/** Observer layer: magnetometer/rotation-vector heading + device-motion pitch. */
export function useDeviceOrientation(): DeviceOrientation {
  const [heading, setHeading] = useState<number | null>(null);
  const [pitch, setPitch] = useState<number | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let headingSub: Location.LocationSubscription | undefined;
    let cancelled = false;
    Location.watchHeadingAsync((h) => setHeading(h.trueHeading >= 0 ? h.trueHeading : h.magHeading))
      .then((sub) => {
        if (cancelled) sub.remove();
        else headingSub = sub;
      })
      .catch(() => setAvailable(false));

    DeviceMotion.setUpdateInterval(100);
    const motionSub = DeviceMotion.addListener(({ rotation }) => {
      if (rotation) setPitch((rotation.beta * 180) / Math.PI);
    });
    DeviceMotion.isAvailableAsync().then((ok) => !ok && setAvailable(false));

    return () => {
      cancelled = true;
      headingSub?.remove();
      motionSub.remove();
    };
  }, []);

  return { heading, pitch, available };
}

/** Signed smallest angle from `from` to `to`, in (-180, 180]. */
export function angleDelta(from: number, to: number): number {
  const d = (((to - from) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}
