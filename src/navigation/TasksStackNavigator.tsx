import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TasksScreen } from '../screens/TasksScreen';
import { TaskDetailScreen } from '../screens/TaskDetailScreen';
import { ChatScreen } from '../screens/ChatScreen';

export type TasksStackParamList = {
  Tasks: undefined;
  TaskDetail: { ticketId: string };
  // Reachable from a task's detail so a technician can open the ticket's
  // thread without leaving the Tasks tab (the Chat tab has its own copy).
  Chat: { ticketId: string; title?: string };
};

const Stack = createNativeStackNavigator<TasksStackParamList>();

// Nested inside the Tasks tab so the bottom tab bar (MainTabs) stays visible
// when a technician drills into a task's detail — React Navigation keeps the
// parent tab bar mounted for any screen pushed within a child stack by default.
export function TasksStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{
      headerShown: false,
      // Explicit rather than relying on the default: the whole back rule
      // rests on this gesture, and a stack that quietly loses it would look
      // like the rule was never implemented.
      gestureEnabled: true,
      // A screen that is covered stops re-rendering. The chat sits on top of
      // a ticket screen that polls and listens, and without this both keep
      // working while only one is visible.
      freezeOnBlur: true,
    }}>
      <Stack.Screen name="Tasks" component={TasksScreen} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
    </Stack.Navigator>
  );
}
