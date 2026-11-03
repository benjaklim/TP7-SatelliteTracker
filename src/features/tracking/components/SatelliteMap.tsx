import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { forwardRef, useEffect } from 'react';
import { Animated, Easing, StyleSheet, Text, useAnimatedValue, View } from 'react-native';

import type { GroundTrack, LngLat, Observer } from '../../../core';
import { colors, MAP_STYLE_URL } from '../../../shared/theme';
import { EMPTY_COLLECTION, footprintFeature, groundTrackFeatures, outlineFeature } from '../mapGeometry';

export interface SatelliteMapProps {
  position: LngLat | null;
  groundTrack: GroundTrack | null;
  /** Fill polygons and seam-free outline, both split at the antimeridian. */
  footprint: { fill: LngLat[][][]; outline: LngLat[][] } | null;
  constellation: GeoJSON.FeatureCollection<GeoJSON.Point> | null;
  observer: Observer;
  satelliteName: string;
}

function PulsingSatellite({ name }: { name: string }) {
  const pulse = useAnimatedValue(0);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={styles.markerWrap} pointerEvents="none">
      <Animated.View
        style={[
          styles.pulse,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.2] }) }],
          },
        ]}
      />
      <View style={styles.dot}>
        <Text style={styles.dotIcon}>🛰</Text>
      </View>
      <Text style={styles.markerLabel} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

/** Geo/Map layer: marker, ground track (antimeridian-safe), footprint and constellation. */
export const SatelliteMap = forwardRef<CameraRef, SatelliteMapProps>(function SatelliteMap(
  { position, groundTrack, footprint, constellation, observer, satelliteName },
  cameraRef,
) {
  return (
    <Map style={StyleSheet.absoluteFill} mapStyle={MAP_STYLE_URL} attribution logo={false} compass={false}>
      <Camera ref={cameraRef} initialViewState={{ center: position ?? [observer.longitude, observer.latitude], zoom: 0.4 }} />

      <GeoJSONSource id="constellation" data={constellation ?? EMPTY_COLLECTION}>
        <Layer
          type="circle"
          id="constellation-points"
          paint={{
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 1.6, 5, 3.5],
            'circle-color': colors.constellation,
            'circle-opacity': 0.85,
          }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="footprint" data={footprint ? footprintFeature(footprint.fill) : EMPTY_COLLECTION}>
        <Layer type="fill" id="footprint-fill" paint={{ 'fill-color': colors.footprint, 'fill-opacity': 0.14 }} />
      </GeoJSONSource>
      <GeoJSONSource id="footprint-edge" data={footprint ? outlineFeature(footprint.outline) : EMPTY_COLLECTION}>
        <Layer
          type="line"
          id="footprint-outline"
          paint={{ 'line-color': colors.footprint, 'line-width': 1.5, 'line-opacity': 0.8 }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="ground-track" data={groundTrack ? groundTrackFeatures(groundTrack) : EMPTY_COLLECTION}>
        <Layer
          type="line"
          id="ground-track-past"
          filter={['==', ['get', 'kind'], 'past']}
          paint={{ 'line-color': colors.trackPast, 'line-width': 2, 'line-dasharray': [2, 2] }}
        />
        <Layer
          type="line"
          id="ground-track-future"
          filter={['==', ['get', 'kind'], 'future']}
          paint={{ 'line-color': colors.track, 'line-width': 2.5 }}
        />
      </GeoJSONSource>

      <Marker id="observer" lngLat={[observer.longitude, observer.latitude]} anchor="center">
        <View style={styles.observer} />
      </Marker>

      {position && (
        <Marker id="satellite" lngLat={position} anchor="center">
          <PulsingSatellite name={satelliteName} />
        </Marker>
      )}
    </Map>
  );
});

const styles = StyleSheet.create({
  markerWrap: { alignItems: 'center', justifyContent: 'center', width: 120, height: 70 },
  pulse: {
    position: 'absolute',
    top: 11,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
  },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  dotIcon: { fontSize: 16 },
  markerLabel: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
    textShadowColor: '#000',
    textShadowRadius: 3,
  },
  observer: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: '#fff',
  },
});
