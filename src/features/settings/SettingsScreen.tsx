import { useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ProviderHealth } from '../../data/orchestrator/ProviderOrchestrator';
import { getOrchestrator } from '../../services/container';
import { formatTime } from '../../shared/format';
import { colors, spacing } from '../../shared/theme';
import { Badge, Button, Card, Chip, SectionTitle, Stepper, styles as ui } from '../../shared/ui';
import { useSelectedSatellite } from '../tracking/SelectedSatelliteContext';
import { trackingStore } from '../tracking/trackingStore';
import { DEFAULT_PROXY_URL, settingsStore } from './settingsStore';

function useProviderHealth(): ProviderHealth[] {
  const orchestrator = getOrchestrator();
  return useSyncExternalStore(orchestrator.subscribe, orchestrator.getHealth);
}

export function SettingsScreen() {
  const settings = settingsStore.use((s) => s);
  const observer = trackingStore.use((s) => s.observer);
  const observerSource = trackingStore.use((s) => s.observerSource);
  const { refresh, meta } = useSelectedSatellite();
  const health = useProviderHealth();
  const [proxyDraft, setProxyDraft] = useState(settings.proxyUrl);
  const [lat, setLat] = useState(String(observer.latitude.toFixed(4)));
  const [lon, setLon] = useState(String(observer.longitude.toFixed(4)));

  const set = settingsStore.set;

  return (
    <SafeAreaView style={ui.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <SectionTitle>Prediction</SectionTitle>
          <Stepper
            label="Minimum elevation (AOS/LOS, footprint)"
            value={settings.minElevation}
            unit="°"
            step={5}
            min={0}
            max={45}
            onChange={(v) => set({ minElevation: v })}
          />
          <Stepper
            label="Reminder lead time"
            value={settings.leadMinutes}
            unit="min"
            step={5}
            min={5}
            max={60}
            onChange={(v) => set({ leadMinutes: v })}
          />
          <Stepper
            label="Remind passes above"
            value={settings.reminderMinElevation}
            unit="°"
            step={5}
            min={0}
            max={80}
            onChange={(v) => set({ reminderMinElevation: v })}
          />
          <Text style={ui.muted}>ITU-R practice for satellite links uses 5–10° minimum elevation; 10° is the default.</Text>
        </Card>

        <Card>
          <SectionTitle>Constellation layer</SectionTitle>
          <Stepper
            label="Max Starlink objects"
            value={settings.constellationLimit}
            unit=""
            step={100}
            min={100}
            max={1500}
            onChange={(v) => set({ constellationLimit: v })}
          />
        </Card>

        <Card>
          <SectionTitle>Observer</SectionTitle>
          <Text style={ui.text}>
            {observer.latitude.toFixed(4)}, {observer.longitude.toFixed(4)} · {observerSource}
          </Text>
          <View style={ui.row}>
            <TextInput value={lat} onChangeText={setLat} keyboardType="numeric" style={[styles.input, { flex: 1 }]} />
            <TextInput value={lon} onChangeText={setLon} keyboardType="numeric" style={[styles.input, { flex: 1 }]} />
          </View>
          <View style={ui.wrap}>
            <Button
              label="Use these coordinates"
              compact
              onPress={() => {
                const latitude = Number(lat);
                const longitude = Number(lon);
                if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
                  set({ manualObserver: { latitude, longitude, altitudeKm: 0 } });
                }
              }}
            />
            <Button label="Use GPS" tone="neutral" compact onPress={() => set({ manualObserver: null })} />
          </View>
        </Card>

        <Card>
          <SectionTitle>Data sources</SectionTitle>
          <Text style={ui.muted}>Proxy URL (keeps Space-Track and N2YO credentials off the device)</Text>
          <TextInput
            value={proxyDraft}
            onChangeText={setProxyDraft}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <View style={ui.wrap}>
            <Button label="Save proxy" compact onPress={() => set({ proxyUrl: proxyDraft.trim().replace(/\/$/, '') })} />
            <Chip
              label="Reset"
              onPress={() => {
                setProxyDraft(DEFAULT_PROXY_URL);
                set({ proxyUrl: DEFAULT_PROXY_URL });
              }}
            />
            <Button label="Force refresh orbital data" tone="neutral" compact onPress={() => refresh(true)} />
          </View>
          {meta && (
            <Text style={ui.muted}>
              Selected satellite served by {meta.source} · downloaded {formatTime(meta.fetchedAt)} · TTL{' '}
              {getOrchestrator().ttl / 3_600_000} h{meta.stale ? ' · STALE' : ''}
            </Text>
          )}
          {health.length === 0 && <Text style={ui.muted}>No requests yet.</Text>}
          {health.map((h) => (
            <View key={h.label} style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={[ui.text, { flex: 1 }]}>{h.label}</Text>
              <Badge label={h.ok ? `OK ${formatTime(h.at)}` : 'FAILED'} tone={h.ok ? 'success' : 'danger'} />
            </View>
          ))}
          {health
            .filter((h) => !h.ok && h.lastError)
            .map((h) => (
              <Text key={`${h.label}-err`} style={[ui.muted, { color: colors.danger }]} numberOfLines={2}>
                {h.label}: {h.lastError}
              </Text>
            ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  input: {
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
