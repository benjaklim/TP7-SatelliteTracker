import { StyleSheet, Text, View } from 'react-native';

import { classifyOrbit, type LookAngles, type Pass, type Satellite, type SatelliteState } from '../../../core';
import { azimuthToCardinal, formatDuration, formatLat, formatLon } from '../../../shared/format';
import { colors } from '../../../shared/theme';
import { Badge, Card, Stat, styles as ui } from '../../../shared/ui';
import { DataAgeBadge } from './DataAgeBadge';

interface Props {
  satellite: Satellite;
  state: SatelliteState;
  look: LookAngles | null;
  pass: Pass | undefined;
  now: number;
  stale: boolean;
  source: string;
  footprintKm: number;
}

export function TelemetryPanel({ satellite, state, look, pass, now, stale, source, footprintKm }: Props) {
  const visible = (look?.elevation ?? -90) > 0;
  const inPass = pass && pass.aos <= now && now <= pass.los;
  return (
    <Card style={styles.panel}>
      <View style={[ui.row, { justifyContent: 'space-between' }]}>
        <Text style={ui.title} numberOfLines={1}>
          {satellite.name}
        </Text>
        <Badge label={`${classifyOrbit(satellite)} · #${satellite.noradId}`} tone="accent" />
      </View>
      <View style={ui.wrap}>
        <DataAgeBadge satellite={satellite} now={now} stale={stale} />
        <Badge label={`via ${source}`} />
        <Badge label={visible ? 'Above horizon' : 'Below horizon'} tone={visible ? 'success' : 'neutral'} />
      </View>
      <View style={ui.wrap}>
        <Stat label="Latitude" value={formatLat(state.latitude)} />
        <Stat label="Longitude" value={formatLon(state.longitude)} />
        <Stat label="Altitude" value={`${state.altitudeKm.toFixed(1)} km`} />
        <Stat label="Velocity" value={`${state.velocityKmS.toFixed(2)} km/s`} />
        {look && (
          <>
            <Stat
              label="Azimuth"
              value={`${look.azimuth.toFixed(1)}° ${azimuthToCardinal(look.azimuth)}`}
            />
            <Stat label="Elevation" value={`${look.elevation.toFixed(1)}°`} />
            <Stat label="Range" value={`${look.rangeKm.toFixed(0)} km`} />
          </>
        )}
        <Stat label="Footprint radius" value={`${footprintKm.toFixed(0)} km`} />
      </View>
      {pass && (
        <Text style={[ui.text, { color: inPass ? colors.success : colors.accent }]}>
          {inPass
            ? `Pass in progress · LOS in ${formatDuration(pass.los - now)} · max ${pass.maxElevation.toFixed(0)}°`
            : `Next pass in ${formatDuration(pass.aos - now)} · max ${pass.maxElevation.toFixed(0)}°${pass.optical ? ' · visible to the eye' : ''}`}
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  panel: { margin: 12, backgroundColor: 'rgba(17,26,46,0.94)' },
});
