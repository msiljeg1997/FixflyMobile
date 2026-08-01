import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { TasksStackNavigator } from './TasksStackNavigator';
import { ChatStackNavigator } from './ChatStackNavigator';
import { ProfileScreen } from '../screens/ProfileScreen';
import { InboxScreen } from '../screens/InboxScreen';
import { ManagerProfileScreen } from '../screens/ManagerProfileScreen';
import { ChatBanner } from '../components/ChatBanner';
import { useUnread } from '../context/UnreadContext';
import { useAuth } from '../context/AuthContext';
import { MobilePrincipal } from '../api/types';
import { colors, spacing } from '../theme/tokens';

export type MainTabParamList = {
  TasksTab: undefined;
  InboxTab: undefined;
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
  const { total } = useUnread();
  const { principal, isVenueManager } = useAuth();
  // A manager triages; an agent works a queue. Same shell, different first
  // tab — they are not variations of one screen.
  const isManager = principal === MobilePrincipal.Manager;

  return (
    <>
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
      {isManager ? (
        <Tab.Screen
          name="InboxTab"
          component={InboxScreen}
          options={{
            tabBarLabel: t('tabs.inbox'),
            tabBarIcon: ({ color }) => <TabIcon glyph="📥" color={color} />,
          }}
        />
      ) : (
        <Tab.Screen
          name="TasksTab"
          component={TasksStackNavigator}
          options={{
            tabBarLabel: t('tabs.tasks'),
            tabBarIcon: ({ color }) => <TabIcon glyph="🗂️" color={color} />,
          }}
        />
      )}
      {/* The venue manager reads; he does not take part in the conversation.
          His side of a ticket is the report and its progress, and the chat is
          between the people doing the work. */}
      {!isVenueManager && <Tab.Screen
          name="ChatTab"
          component={ChatStackNavigator}
          options={{
            tabBarLabel: t('tabs.chat'),
            tabBarIcon: ({ color }) => <TabIcon glyph="💬" color={color} />,
            tabBarBadge: total > 0 ? (total > 99 ? '99+' : total) : undefined,
            tabBarBadgeStyle: { backgroundColor: colors.green, color: colors.white, fontSize: 10 },
          }}
        />}
      <Tab.Screen
        name="ProfileTab"
        component={isManager ? ManagerProfileScreen : ProfileScreen}
        options={{
          tabBarLabel: t('tabs.profile'),
          tabBarIcon: ({ color }) => <TabIcon glyph="👤" color={color} />,
        }}
      />
    </Tab.Navigator>
    <ChatBanner />
    </>
  );
}
