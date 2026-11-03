import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { parseEpoch, type OrbitalRecord } from '../../core';
import { CATALOG_GROUPS, type CatalogGroup, type FetchResult } from '../../data/types';
import { getOrchestrator } from '../../services/container';
import { formatAge } from '../../shared/format';
import { colors, spacing } from '../../shared/theme';
import { Badge, Chip, styles as ui } from '../../shared/ui';
import { selectSatellite, trackingStore } from '../tracking/trackingStore';

const GROUP_LIMIT = 300;

/** RF-01 search by name / NORAD ID, RF-08 filter by constellation. */
export function CatalogScreen() {
  const [group, setGroup] = useState<CatalogGroup | null>('stations');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<FetchResult<OrbitalRecord[]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = trackingStore.use((s) => s.selectedNoradId);

  const run = useCallback(async (task: () => Promise<FetchResult<OrbitalRecord[]>>) => {
    setLoading(true);
    setError(null);
    try {
      setResult(await task());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (group) void run(() => getOrchestrator().getCatalog(group, { limit: GROUP_LIMIT }));
  }, [group, run]);

  const search = () => {
    const q = query.trim();
    if (q.length < 2 && !/^\d+$/.test(q)) return;
    setGroup(null);
    void run(() => getOrchestrator().search(q));
  };

  const pick = (record: OrbitalRecord) => {
    selectSatellite(Number(record.NORAD_CAT_ID), record.OBJECT_NAME);
    router.navigate('/');
  };

  const now = Date.now();

  return (
    <SafeAreaView style={ui.screen} edges={['top']}>
      <View style={styles.header}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={search}
          placeholder="Search by name or NORAD ID (e.g. NOAA 19, 25544)"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          autoCapitalize="characters"
          style={styles.input}
        />
        <View style={ui.wrap}>
          {CATALOG_GROUPS.map((g) => (
            <Chip key={g.id} label={g.label} active={group === g.id} onPress={() => setGroup(g.id)} />
          ))}
        </View>
        {result && (
          <View style={ui.wrap}>
            <Badge label={`${result.data.length} objects`} tone="accent" />
            <Badge label={`source: ${result.source}`} />
            <Badge
              label={`downloaded ${formatAge((now - result.fetchedAt) / 3_600_000)} ago${result.stale ? ' (stale)' : ''}`}
              tone={result.stale ? 'warning' : 'neutral'}
            />
          </View>
        )}
      </View>
      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />
      ) : error ? (
        <Text style={[ui.text, styles.error]}>{error}</Text>
      ) : (
        <FlatList
          data={result?.data ?? []}
          keyExtractor={(r) => String(r.NORAD_CAT_ID)}
          initialNumToRender={20}
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={({ item }) => {
            const age = (now - parseEpoch(item.EPOCH)) / 3_600_000;
            const active = Number(item.NORAD_CAT_ID) === selected;
            return (
              <Pressable onPress={() => pick(item)} style={[styles.item, active && styles.itemActive]}>
                <View style={{ flex: 1 }}>
                  <Text style={ui.text} numberOfLines={1}>
                    {item.OBJECT_NAME}
                  </Text>
                  <Text style={ui.muted}>
                    NORAD {item.NORAD_CAT_ID} · {item.OBJECT_ID} · epoch {formatAge(age)} ago
                  </Text>
                </View>
                {active && <Badge label="Tracking" tone="success" />}
              </Pressable>
            );
          }}
          ListEmptyComponent={<Text style={[ui.muted, { padding: 16 }]}>No results.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  itemActive: { backgroundColor: colors.surfaceRaised },
  error: { padding: 16, color: colors.danger },
});
