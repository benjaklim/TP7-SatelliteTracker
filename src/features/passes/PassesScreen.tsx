import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { lookAnglesAt, passTrack, type Pass } from '../../core';
import { azimuthToCardinal, formatDateTime, formatDuration, formatTime } from '../../shared/format';
import { useNow } from '../../shared/hooks';
import { colors, spacing } from '../../shared/theme';
import { Badge, Button, Card, Chip, SectionTitle, styles as ui } from '../../shared/ui';
import {
  cancelPassReminder,
  reminderKey,
  reminderStore,
  scheduleDemoReminder,
  schedulePassReminder,
  setupNotifications,
  toggleWatched,
} from '../notifications/passReminders';
import { refreshWatchedPasses } from '../notifications/backgroundRefresh';
import { settingsStore } from '../settings/settingsStore';
import { DataAgeBadge } from '../tracking/components/DataAgeBadge';
import { useSelectedSatellite } from '../tracking/SelectedSatelliteContext';
import { trackingStore } from '../tracking/trackingStore';
import { PASS_WINDOW_HOURS, usePasses } from './PassesContext';
import { SkyChart } from './SkyChart';

/** RF-04 pass list, RF-05 sky chart, RF-06 reminders. */
export function PassesScreen() {
  const now = useNow(1000);
  const { width } = useWindowDimensions();
  const { satellite, meta } = useSelectedSatellite();
  const observer = trackingStore.use((s) => s.observer);
  const minElevation = settingsStore.use((s) => s.minElevation);
  const leadMinutes = settingsStore.use((s) => s.leadMinutes);
  const scheduled = reminderStore.use((s) => s.scheduled);
  const watched = reminderStore.use((s) => s.watched);
  const { passes, computing, computeMs } = usePasses();
  const upcoming = passes.filter((p) => p.los > now);
  const [selectedAos, setSelectedAos] = useState<number | null>(null);
  const selected = upcoming.find((p) => p.aos === selectedAos) ?? upcoming[0];

  // ~60 propagations for a 10-minute pass: cheap enough to recompute on each 1 s tick.
  const track = satellite && selected ? passTrack(satellite, observer, selected) : [];
  const live = satellite ? lookAnglesAt(satellite, observer, now) : null;
  const isWatched = satellite ? watched.some((w) => w.noradId === satellite.noradId) : false;

  if (!satellite) {
    return (
      <SafeAreaView style={[ui.screen, styles.centre]}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  const sat = { noradId: satellite.noradId, name: satellite.name };

  const toggleReminder = async (pass: Pass) => {
    if (!(await setupNotifications())) {
      Alert.alert('Notifications disabled', 'Enable notifications to receive pass reminders.');
      return;
    }
    if (scheduled[reminderKey(sat.noradId, pass)]) await cancelPassReminder(sat.noradId, pass);
    else if (!(await schedulePassReminder(sat, pass, leadMinutes))) {
      Alert.alert('Too late', `This pass starts in less than ${leadMinutes} minutes.`);
    }
  };

  const toggleAuto = async () => {
    if (!(await setupNotifications())) return;
    toggleWatched(sat);
    if (!isWatched) {
      const count = await refreshWatchedPasses();
      Alert.alert('Automatic reminders on', `${count} reminders scheduled for the next 36 h.`);
    }
  };

  const demo = async () => {
    if (!selected || !(await setupNotifications())) return;
    await scheduleDemoReminder(sat, selected, leadMinutes, 10);
    Alert.alert('Demo reminder', 'The reminder for the selected pass will fire in 10 seconds. Lock the screen or leave the app to see it.');
  };

  return (
    <SafeAreaView style={ui.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <Text style={ui.title}>{satellite.name}</Text>
            {computing && <ActivityIndicator color={colors.accent} />}
          </View>
          <View style={ui.wrap}>
            <DataAgeBadge satellite={satellite} now={now} stale={meta?.stale} />
            <Badge label={`min el ${minElevation}°`} tone="warning" />
            <Badge label={`${upcoming.length} passes / ${PASS_WINDOW_HOURS} h · ${computeMs} ms`} />
          </View>
          <View style={ui.wrap}>
            <Button
              label={isWatched ? 'Auto reminders: ON' : 'Auto reminders: OFF'}
              tone={isWatched ? 'success' : 'neutral'}
              onPress={toggleAuto}
              compact
            />
            <Button label="Demo notification (10 s)" tone="warning" onPress={demo} compact disabled={!selected} />
          </View>
        </Card>

        {selected && (
          <Card style={{ alignItems: 'center' }}>
            <SectionTitle>Sky chart · {formatDateTime(selected.aos)}</SectionTitle>
            <SkyChart
              track={track}
              size={Math.min(width - 2 * spacing.lg - 2 * spacing.md, 340)}
              minElevation={minElevation}
              current={live}
            />
            <Text style={ui.muted}>
              AOS {formatTime(selected.aos)} {azimuthToCardinal(selected.aosAzimuth)} → max {selected.maxElevation.toFixed(1)}° at{' '}
              {formatTime(selected.tca)} {azimuthToCardinal(selected.tcaAzimuth)} → LOS {formatTime(selected.los)}{' '}
              {azimuthToCardinal(selected.losAzimuth)}
            </Text>
          </Card>
        )}

        {upcoming.length === 0 && !computing && (
          <Text style={[ui.muted, { textAlign: 'center' }]}>
            No passes above {minElevation}° in the next {PASS_WINDOW_HOURS} h from this location.
          </Text>
        )}

        {upcoming.map((pass) => {
          const active = selected?.aos === pass.aos;
          const inProgress = pass.aos <= now;
          const reminded = Boolean(scheduled[reminderKey(sat.noradId, pass)]);
          return (
            <Card key={pass.aos} style={active && { borderColor: colors.accent }}>
              <View style={[ui.row, { justifyContent: 'space-between' }]}>
                <Text style={ui.text} onPress={() => setSelectedAos(pass.aos)}>
                  {formatDateTime(pass.aos)}
                </Text>
                <View style={ui.row}>
                  {inProgress && <Badge label="IN PROGRESS" tone="success" />}
                  {pass.optical && <Badge label="Visible" tone="accent" />}
                  {pass.truncated && <Badge label="continuous" />}
                </View>
              </View>
              <Text style={ui.muted} onPress={() => setSelectedAos(pass.aos)}>
                {inProgress ? `LOS in ${formatDuration(pass.los - now)}` : `in ${formatDuration(pass.aos - now)}`} · duration{' '}
                {formatDuration(pass.los - pass.aos)} · max {pass.maxElevation.toFixed(1)}° ·{' '}
                {azimuthToCardinal(pass.aosAzimuth)} → {azimuthToCardinal(pass.losAzimuth)}
              </Text>
              <View style={ui.row}>
                <Chip label={active ? 'Showing sky chart' : 'Sky chart'} active={active} onPress={() => setSelectedAos(pass.aos)} />
                {!inProgress && (
                  <Chip
                    label={reminded ? `🔔 ${leadMinutes} min before` : '🔕 Remind me'}
                    active={reminded}
                    onPress={() => void toggleReminder(pass)}
                  />
                )}
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  centre: { alignItems: 'center', justifyContent: 'center' },
});
