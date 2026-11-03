import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { createSatellite, findPasses } from '../../core';
import { getOrchestrator } from '../../services/container';
import { settingsStore } from '../settings/settingsStore';
import { trackingStore } from '../tracking/trackingStore';
import { pruneReminders, reminderStore, schedulePassReminder } from './passReminders';

export const BACKGROUND_TASK = 'satellite-tracker.refresh-passes';
const HORIZON_HOURS = 36;

/**
 * Refreshes orbital data that exceeded its TTL (the orchestrator decides, so
 * provider limits are respected) and (re)schedules reminders for watched
 * satellites. Shared by the background task and the foreground app start.
 */
export async function refreshWatchedPasses(): Promise<number> {
  const { watched } = reminderStore.get();
  const { minElevation, leadMinutes, reminderMinElevation } = settingsStore.get();
  const { observer } = trackingStore.get();
  await pruneReminders();
  let scheduled = 0;
  for (const sat of watched) {
    const { data } = await getOrchestrator().getOrbitalData(sat.noradId);
    const passes = findPasses(createSatellite(data), observer, {
      start: Date.now(),
      hours: HORIZON_HOURS,
      minElevation,
    }).filter((p) => p.maxElevation >= reminderMinElevation);
    for (const pass of passes) {
      if (await schedulePassReminder(sat, pass, leadMinutes)) scheduled++;
    }
  }
  return scheduled;
}

// Task definitions must live at module scope so the OS can run them headless.
TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    await refreshWatchedPasses();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundRefresh(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK)) return;
  await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 60 });
}
