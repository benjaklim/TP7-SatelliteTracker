import '../features/notifications/backgroundRefresh';

import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { refreshWatchedPasses, registerBackgroundRefresh } from '../features/notifications/backgroundRefresh';
import { setupNotifications } from '../features/notifications/passReminders';
import { PassesProvider } from '../features/passes/PassesContext';
import { useObserverLocation } from '../features/tracking/hooks/useObserverLocation';
import { SelectedSatelliteProvider } from '../features/tracking/SelectedSatelliteContext';
import { colors } from '../shared/theme';

function Bootstrap() {
  useObserverLocation();

  useEffect(() => {
    (async () => {
      await setupNotifications();
      await registerBackgroundRefresh();
      await refreshWatchedPasses();
    })().catch(() => undefined);

    // Tapping a pass reminder opens the passes tab.
    const sub = Notifications.addNotificationResponseReceivedListener(() => router.navigate('/passes'));
    return () => sub.remove();
  }, []);

  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SelectedSatelliteProvider>
        <PassesProvider>
          <Bootstrap />
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="compass" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          </Stack>
        </PassesProvider>
      </SelectedSatelliteProvider>
    </SafeAreaProvider>
  );
}
