import { useState } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getOrchestrator } from '../../services/container';
import { formatTime } from '../../shared/format';
import { createStore } from '../../shared/store';
import { colors, spacing } from '../../shared/theme';
import { Badge, Button, Card, SectionTitle, Stat, styles as ui } from '../../shared/ui';
import { useSelectedSatellite } from '../tracking/SelectedSatelliteContext';
import { trackingStore } from '../tracking/trackingStore';
import { compareWithSample, toMarkdownTable, type ValidationRow } from './validation';

const historyStore = createStore<{ rows: ValidationRow[] }>({ rows: [] });
const MAX_ROWS = 60;

const errorTone = (km: number) => (km < 5 ? 'success' : km < 20 ? 'warning' : 'danger');

/** RF-15: our SGP4 position vs N2YO (any satellite) and Where the ISS at? (ISS). */
export function ValidationScreen() {
  const { satellite } = useSelectedSatellite();
  const observer = trackingStore.use((s) => s.observer);
  const rows = historyStore.use((s) => s.rows);
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const run = async () => {
    if (!satellite) return;
    setRunning(true);
    const outcomes = await getOrchestrator().getValidationPositions(satellite.noradId, observer);
    const fresh: ValidationRow[] = [];
    const failures: string[] = [];
    for (const o of outcomes) {
      const row = o.sample && compareWithSample(satellite, o.provider, o.sample);
      if (row) fresh.push(row);
      else failures.push(`${o.provider}: ${o.error ?? 'no data'}`);
    }
    if (outcomes.length === 0) failures.push('No validation source supports this satellite.');
    historyStore.set((s) => ({ rows: [...fresh, ...s.rows].slice(0, MAX_ROWS) }));
    setErrors(failures);
    setRunning(false);
  };

  const latest = rows.filter((r) => r.noradId === satellite?.noradId);
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

  return (
    <SafeAreaView style={ui.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={ui.title}>Validation · {satellite?.name ?? '…'}</Text>
          <Text style={ui.muted}>
            Each sample is compared at the provider timestamp, so network latency does not bias the error.
          </Text>
          <View style={ui.wrap}>
            <Button label={running ? 'Querying…' : 'Compare now'} onPress={run} disabled={running || !satellite} />
            <Button
              label="Share table"
              tone="neutral"
              onPress={() => Share.share({ message: toMarkdownTable(rows) })}
              disabled={rows.length === 0}
            />
            {running && <ActivityIndicator color={colors.accent} />}
          </View>
          {errors.map((e) => (
            <Badge key={e} label={e} tone="danger" />
          ))}
        </Card>

        {latest.length > 0 && (
          <Card>
            <SectionTitle>Summary ({latest.length} samples)</SectionTitle>
            <View style={ui.wrap}>
              <Stat label="Mean 3D error" value={`${mean(latest.map((r) => r.error3dKm)).toFixed(2)} km`} />
              <Stat label="Max 3D error" value={`${Math.max(...latest.map((r) => r.error3dKm)).toFixed(2)} km`} />
              <Stat label="Mean ground error" value={`${mean(latest.map((r) => r.groundErrorKm)).toFixed(2)} km`} />
              <Stat label="Elements age" value={`${latest[0].epochAgeHours.toFixed(1)} h`} />
            </View>
          </Card>
        )}

        {rows.map((r) => (
          <Card key={`${r.provider}-${r.timestamp}-${r.noradId}`}>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.text}>
                {r.name} · {r.provider}
              </Text>
              <Badge label={`${r.error3dKm.toFixed(2)} km`} tone={errorTone(r.error3dKm)} />
            </View>
            <Text style={ui.muted}>
              {formatTime(r.timestamp)} · ground {r.groundErrorKm.toFixed(2)} km · Δalt {r.altitudeDiffKm.toFixed(2)} km ·
              elements {r.epochAgeHours.toFixed(1)} h old
            </Text>
            {r.clockCorrectedErrorKm !== undefined && (
              <Text style={[ui.muted, { color: colors.success }]}>
                With the N2YO 1 s propagation lag accounted for: {(r.clockCorrectedErrorKm * 1000).toFixed(0)} m
              </Text>
            )}
            <Text style={ui.muted}>
              ours {r.ours.latitude.toFixed(3)}, {r.ours.longitude.toFixed(3)}, {r.ours.altitudeKm.toFixed(1)} km — theirs{' '}
              {r.theirs.latitude.toFixed(3)}, {r.theirs.longitude.toFixed(3)}, {r.theirs.altitudeKm.toFixed(1)} km
            </Text>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
});
