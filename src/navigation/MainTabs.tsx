import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { TasksStackNavigator } from './TasksStackNavigator';
import { ChatPlaceholderScreen } from '../screens/ChatPlaceholderScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { colors, spacing } from '../theme/tokens';

export type MainTabParamList = {
  TasksTab: undefined;
  ChatTab: undefined;
  ProfileTab: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
}

// Always-visible bottom bar (Tasks/Chat/Profile) — the app's single source
// of top-level navigation once signed in. TasksStackNavigator keeps this bar
// mounted even when a technician is deep in a task's detail screen.
export function MainTabs() {
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
        // No explicit height — react-navigation sizes the bar itself using
        // the device's safe-area bottom inset (home indicator etc.); setting
        // a fixed height here would short-circuit that and either clip the
        // bar or leave a dead gap depending on the device.
        tabBarStyle: {
          paddingTop: spacing.xs,
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="TasksTab"
        component={TasksStackNavigator}
        options={{
          tabBarLabel: t('tabs.tasks'),
          tabBarIcon: ({ color }) => <TabIcon glyph="🗂️" color={color} />,
        }}
      />
      <Tab.Screen
        name="ChatTab"
        component={ChatPlaceholderScreen}
        options={{
          tabBarLabel: t('tabs.chat'),
          tabBarIcon: ({ color }) => <TabIcon glyph="💬" color={color} />,
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          tabBarLabel: t('tabs.profile'),
          tabBarIcon: ({ color }) => <TabIcon glyph="👤" color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}
