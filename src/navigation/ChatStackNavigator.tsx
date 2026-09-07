import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ChatListScreen } from '../screens/ChatListScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { TaskDetailScreen } from '../screens/TaskDetailScreen';
import { ManagerTicketScreen } from '../screens/ManagerTicketScreen';

export type ChatStackParamList = {
  ChatList: undefined;
  // The ticket a thread is about, pushed underneath it so backing out of a
  // conversation lands on the fault rather than on the list of threads. Two
  // of them because the two audiences have nothing in common: an agent's
  // detail screen is his job card, with accept and resolve on it, and reads
  // the agent task endpoint a manager cannot call.
  TaskDetail: { ticketId: string };
  ManagerTicket: { ticketId: string };
  Chat: { ticketId: string; title?: string };
};

const Stack = createNativeStackNavigator<ChatStackParamList>();

// Nested in the Chat tab so the bottom bar stays visible on the thread list;
// the thread screen itself is shared with the Tasks stack (same component,
// registered in both so either entry point works).
export function ChatStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ChatList" component={ChatListScreen} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} />
      <Stack.Screen name="ManagerTicket" component={ManagerTicketScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
    </Stack.Navigator>
  );
}
