import { router } from 'expo-router';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, G, Line, Polygon, Text as SvgText } from 'react-native-svg';

import { lookAnglesAt } from '../../core';
import { azimuthToCardinal, formatDuration } from '../../shared/format';
import { useNow } from '../../shared/hooks';
import { colors, spacing } from '../../shared/theme';
import { Badge, Button, Card, styles as ui } from '../../shared/ui';
import { nextPass, usePasses } from '../passes/PassesContext';
import { useSelectedSatellite } from '../tracking/SelectedSatelliteContext';
import { trackingStore } from '../tracking/trackingStore';
import { angleDelta, useDeviceOrientation } from './useDeviceOrientation';

const ON_TARGET_DEG = 5;

/** RF-07: overlay telling the user where to point the phone (top edge) to find the satellite. */
export function CompassScreen() {
  const now = useNow(250);
  const { width } = useWindowDimensions();
  const { satellite } = useSelectedSatellite();
  const observer = trackingStore.use((s) => s.observer);
  const { passes } = usePasses();
  const { heading, pitch, available } = useDeviceOrientation();

  const look = satellite ? lookAnglesAt(satellite, observer, now) : null;
  const aboveHorizon = (look?.elevation ?? -1) > 0;
  const upcoming = nextPass(passes, now);
  // Below the horizon we point at where the next pass will rise.
  const target = aboveHorizon
    ? { azimuth: look!.azimuth, elevation: look!.elevation }
    : upcoming
      ? { azimuth: upcoming.aosAzimuth, elevation: 0 }
      : null;

  const size = Math.min(width - 2 * spacing.lg, 340);
  const c = size / 2;
  const r = c - 24;
  const h = heading ?? 0;
  const turn = target && heading !== null ? angleDelta(heading, target.azimuth) : null;
  const tilt = target && pitch !== null ? target.elevation - pitch : null;
  const onTarget = turn !== null && tilt !== null && Math.abs(turn) < ON_TARGET_DEG && Math.abs(tilt) < ON_TARGET_DEG;

  const targetAngle = target ? ((target.azimuth - h) * Math.PI) / 180 : 0;
  const tx = c + r * 0.78 * Math.sin(targetAngle);
  const ty = c - r * 0.78 * Math.cos(targetAngle);

  return (
    <SafeAreaView style={ui.screen}>
      <View style={styles.content}>
        <View style={[ui.row, { justifyContent: 'space-between' }]}>
          <Text style={ui.title}>Point to {satellite?.name ?? '…'}</Text>
          <Button label="Close" onPress={() => router.back()} compact tone="neutral" />
        </View>
        {!available && <Badge label="Orientation sensors unavailable on this device" tone="danger" />}
        <View style={{ alignItems: 'center' }}>
          <Svg width={size} height={size}>
            <Circle cx={c} cy={c} r={r} fill={colors.surface} stroke={onTarget ? colors.success : colors.border} strokeWidth={3} />
            <G rotation={-h} origin={`${c}, ${c}`}>
              {Array.from({ length: 36 }, (_, i) => i * 10).map((deg) => {
                const a = (deg * Math.PI) / 180;
                const inner = deg % 90 === 0 ? r - 18 : r - 9;
                return (
                  <Line
                    key={deg}
                    x1={c + inner * Math.sin(a)}
                    y1={c - inner * Math.cos(a)}
                    x2={c + r * Math.sin(a)}
                    y2={c - r * Math.cos(a)}
                    stroke={deg === 0 ? colors.danger : colors.muted}
                    strokeWidth={deg % 90 === 0 ? 3 : 1}
                  />
                );
              })}
              {(['N', 'E', 'S', 'W'] as const).map((label, i) => {
                const a = (i * 90 * Math.PI) / 180;
                return (
                  <SvgText
                    key={label}
                    x={c + (r - 32) * Math.sin(a)}
                    y={c - (r - 32) * Math.cos(a) + 6}
                    fill={label === 'N' ? colors.danger : colors.text}
                    fontSize={18}
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {label}
                  </SvgText>
                );
              })}
            </G>
            {/* Phone top edge */}
            <Polygon points={`${c},${c - r + 4} ${c - 10},${c - r + 24} ${c + 10},${c - r + 24}`} fill={colors.accent} />
            {target && (
              <G>
                <Line x1={c} y1={c} x2={tx} y2={ty} stroke={colors.track} strokeWidth={3} strokeDasharray="6 4" />
                <Circle cx={tx} cy={ty} r={14} fill={aboveHorizon ? colors.track : colors.muted} />
                <SvgText x={tx} y={ty + 5} fontSize={14} textAnchor="middle">
                  🛰
                </SvgText>
              </G>
            )}
          </Svg>
        </View>

        <Card style={onTarget && { borderColor: colors.success }}>
          {target ? (
            <>
              <Text style={[ui.title, { color: onTarget ? colors.success : colors.text, textAlign: 'center' }]}>
                {onTarget
                  ? 'ON TARGET'
                  : turn === null
                    ? 'Waiting for compass…'
                    : `${Math.abs(turn) < ON_TARGET_DEG ? 'Hold heading' : `Turn ${turn > 0 ? 'right' : 'left'} ${Math.abs(turn).toFixed(0)}°`} · ${
                        tilt === null ? '' : Math.abs(tilt) < ON_TARGET_DEG ? 'hold tilt' : `tilt ${tilt > 0 ? 'up' : 'down'} ${Math.abs(tilt).toFixed(0)}°`
                      }`}
              </Text>
              <Text style={[ui.muted, { textAlign: 'center' }]}>
                Target az {target.azimuth.toFixed(1)}° ({azimuthToCardinal(target.azimuth)}) · el {target.elevation.toFixed(1)}° ·
                phone heading {heading?.toFixed(0) ?? '—'}° · tilt {pitch?.toFixed(0) ?? '—'}°
              </Text>
              {!aboveHorizon && upcoming && (
                <Text style={[ui.text, { textAlign: 'center' }]}>
                  Below the horizon. Pointing at the rise point: AOS in {formatDuration(upcoming.aos - now)}.
                </Text>
              )}
            </>
          ) : (
            <Text style={ui.text}>No upcoming pass in the prediction window.</Text>
          )}
          <Text style={[ui.muted, { textAlign: 'center' }]}>
            Hold the phone flat, then raise its top edge toward the sky. Calibrate the compass with a figure-8 motion.
          </Text>
        </Card>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
});
