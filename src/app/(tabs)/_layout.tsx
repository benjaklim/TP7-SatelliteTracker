import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { colors } from '../../shared/theme';

const icon = (glyph: string) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 18, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Map', tabBarIcon: icon('🗺') }} />
      <Tabs.Screen name="catalog" options={{ title: 'Satellites', tabBarIcon: icon('🛰') }} />
      <Tabs.Screen name="passes" options={{ title: 'Passes', tabBarIcon: icon('🔭') }} />
      <Tabs.Screen name="validation" options={{ title: 'Validation', tabBarIcon: icon('📏') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('⚙') }} />
    </Tabs>
  );
}
