import type { CameraRef } from '@maplibre/maplibre-react-native';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  footprintPolygon,
  footprintRadiusKm,
  groundTrack,
  lookAnglesAt,
  stateAt,
} from '../../core';
import { useNow } from '../../shared/hooks';
import { colors } from '../../shared/theme';
import { Badge, Button, Chip, styles as ui } from '../../shared/ui';
import { nextPass, usePasses } from '../passes/PassesContext';
import { settingsStore } from '../settings/settingsStore';
import { SatelliteMap } from './components/SatelliteMap';
import { TelemetryPanel } from './components/TelemetryPanel';
import { useConstellation } from './hooks/useConstellation';
import { useSelectedSatellite } from './SelectedSatelliteContext';
import { trackingStore } from './trackingStore';

const TICK_MS = 1000;
const GROUND_TRACK_REFRESH_MS = 60_000;

/** RF-02/03/10/11/12/13: real-time position, ground track, footprint and constellation. */
export function TrackingScreen() {
  const now = useNow(TICK_MS);
  const { satellite, meta, loading, error, refresh } = useSelectedSatellite();
  const observer = trackingStore.use((s) => s.observer);
  const observerSource = trackingStore.use((s) => s.observerSource);
  const name = trackingStore.use((s) => s.selectedName);
  const minElevation = settingsStore.use((s) => s.minElevation);
  const showConstellation = settingsStore.use((s) => s.showConstellation);
  const showGroundTrack = settingsStore.use((s) => s.showGroundTrack);
  const showFootprint = settingsStore.use((s) => s.showFootprint);
  const constellationLimit = settingsStore.use((s) => s.constellationLimit);
  const { passes } = usePasses();
  const constellation = useConstellation(showConstellation, constellationLimit);
  const camera = useRef<CameraRef>(null);
  const [follow, setFollow] = useState(false);

  const state = satellite ? stateAt(satellite, now) : null;
  const look = satellite ? lookAnglesAt(satellite, observer, now) : null;
  const trackBucket = Math.floor(now / GROUND_TRACK_REFRESH_MS);
  const track = useMemo(
    () => (satellite && showGroundTrack ? groundTrack(satellite, trackBucket * GROUND_TRACK_REFRESH_MS) : null),
    [satellite, showGroundTrack, trackBucket],
  );
  const footprint =
    state && showFootprint ? footprintPolygon(state.latitude, state.longitude, state.altitudeKm, minElevation) : null;

  const lng = state?.longitude;
  const lat = state?.latitude;
  useEffect(() => {
    if (follow && lng !== undefined && lat !== undefined) {
      camera.current?.easeTo({ center: [lng, lat], duration: 900 });
    }
  }, [follow, lng, lat]);

  return (
    <View style={ui.screen}>
      <SatelliteMap
        ref={camera}
        position={state ? [state.longitude, state.latitude] : null}
        groundTrack={track}
        footprint={footprint}
        constellation={showConstellation ? constellation.geojson : null}
        observer={observer}
        satelliteName={satellite?.name ?? name}
      />
      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <View style={[ui.wrap, styles.controls]}>
          <Chip label={follow ? 'Following' : 'Follow'} active={follow} onPress={() => setFollow((f) => !f)} />
          <Chip
            label="Starlink"
            active={showConstellation}
            onPress={() => settingsStore.set({ showConstellation: !showConstellation })}
          />
          <Chip
            label="Track"
            active={showGroundTrack}
            onPress={() => settingsStore.set({ showGroundTrack: !showGroundTrack })}
          />
          <Chip
            label="Footprint"
            active={showFootprint}
            onPress={() => settingsStore.set({ showFootprint: !showFootprint })}
          />
          <Chip label="🧭 Compass" onPress={() => router.push('/compass')} />
        </View>
        <View style={[ui.wrap, styles.controls]}>
          <Badge
            label={`Observer: ${observerSource === 'gps' ? 'GPS' : observerSource === 'manual' ? 'manual' : 'default (Buenos Aires)'}`}
            tone={observerSource === 'gps' ? 'success' : 'neutral'}
          />
          {showConstellation && (
            <Badge
              tone={constellation.error ? 'danger' : 'accent'}
              label={
                constellation.error
                  ? 'Starlink unavailable'
                  : `Starlink SupGP: ${constellation.count} sats · ${constellation.computeMs} ms/batch`
              }
            />
          )}
        </View>
      </SafeAreaView>

      <View style={styles.bottom} pointerEvents="box-none">
        {satellite && state ? (
          <TelemetryPanel
            satellite={satellite}
            state={state}
            look={look}
            pass={nextPass(passes, now)}
            now={now}
            stale={Boolean(meta?.stale)}
            source={meta?.source ?? '—'}
            footprintKm={footprintRadiusKm(state.altitudeKm, minElevation)}
          />
        ) : (
          <View style={styles.status}>
            {loading ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <>
                <Text style={ui.text}>Could not load orbital data.</Text>
                {error && <Text style={ui.muted}>{error}</Text>}
                <Button label="Retry" onPress={() => refresh(true)} compact />
              </>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  controls: { paddingHorizontal: 12, paddingTop: 8 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  status: {
    margin: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.surface,
    gap: 8,
    alignItems: 'center',
  },
});
