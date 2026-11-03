import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Pass } from '../../core';
import { azimuthToCardinal, formatTime } from '../../shared/format';
import { loadJson, saveJson } from '../../shared/persistence';
import { createStore } from '../../shared/store';

export const PASS_CHANNEL_ID = 'passes';

export interface WatchedSatellite {
  noradId: number;
  name: string;
}

interface ReminderState {
  /** Satellites whose passes are re-scheduled automatically by the background task. */
  watched: WatchedSatellite[];
  /** Scheduled reminder id keyed by `${noradId}:${aos}`. */
  scheduled: Record<string, string>;
}

const KEY = 'reminders.v1';

export const reminderStore = createStore<ReminderState>(loadJson(KEY, { watched: [], scheduled: {} }), (s) =>
  saveJson(KEY, s),
);

export const reminderKey = (noradId: number, pass: Pick<Pass, 'aos'>) =>
  `${noradId}:${Math.round(pass.aos / 60_000)}`;

export async function setupNotifications(): Promise<boolean> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(PASS_CHANNEL_ID, {
      name: 'Satellite passes',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#38BDF8',
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

function content(name: string, noradId: number, pass: Pass, leadMinutes: number) {
  return {
    title: `🛰 ${name} pass in ${leadMinutes} min`,
    body: `AOS ${formatTime(pass.aos)} from ${azimuthToCardinal(pass.aosAzimuth)} · max ${pass.maxElevation.toFixed(0)}° at ${formatTime(pass.tca)} · LOS ${azimuthToCardinal(pass.losAzimuth)}${pass.optical ? ' · visible to the naked eye' : ''}`,
    data: { noradId, aos: pass.aos },
  };
}

/** RF-06: local notification N minutes before AOS (no server, survives app close). */
export async function schedulePassReminder(
  sat: WatchedSatellite,
  pass: Pass,
  leadMinutes: number,
): Promise<string | null> {
  const fireAt = pass.aos - leadMinutes * 60_000;
  if (fireAt <= Date.now()) return null;
  const key = reminderKey(sat.noradId, pass);
  const existing = reminderStore.get().scheduled[key];
  if (existing) return existing;
  const id = await Notifications.scheduleNotificationAsync({
    content: content(sat.name, sat.noradId, pass, leadMinutes),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      channelId: PASS_CHANNEL_ID,
    },
  });
  reminderStore.set((s) => ({ scheduled: { ...s.scheduled, [key]: id } }));
  return id;
}

export async function cancelPassReminder(noradId: number, pass: Pass): Promise<void> {
  const key = reminderKey(noradId, pass);
  const id = reminderStore.get().scheduled[key];
  if (id) await Notifications.cancelScheduledNotificationAsync(id);
  reminderStore.set((s) => {
    const scheduled = { ...s.scheduled };
    delete scheduled[key];
    return { scheduled };
  });
}

/** Demo helper: fires the real reminder content for `pass` in a few seconds. */
export async function scheduleDemoReminder(sat: WatchedSatellite, pass: Pass, leadMinutes: number, inSeconds = 15) {
  return Notifications.scheduleNotificationAsync({
    content: content(sat.name, sat.noradId, pass, leadMinutes),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: inSeconds,
      channelId: PASS_CHANNEL_ID,
    },
  });
}

export function toggleWatched(sat: WatchedSatellite) {
  reminderStore.set((s) => ({
    watched: s.watched.some((w) => w.noradId === sat.noradId)
      ? s.watched.filter((w) => w.noradId !== sat.noradId)
      : [...s.watched, sat],
  }));
}

/** Drops bookkeeping for reminders that already fired or were dismissed by the OS. */
export async function pruneReminders(): Promise<void> {
  const pending = new Set((await Notifications.getAllScheduledNotificationsAsync()).map((n) => n.identifier));
  reminderStore.set((s) => ({
    scheduled: Object.fromEntries(Object.entries(s.scheduled).filter(([, id]) => pending.has(id))),
  }));
}
