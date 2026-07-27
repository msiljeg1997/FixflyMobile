import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ChatListScreen } from '../screens/ChatListScreen';
import { ChatScreen } from '../screens/ChatScreen';

export type ChatStackParamList = {
  ChatList: undefined;
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
      <Stack.Screen name="Chat" component={ChatScreen} />
    </Stack.Navigator>
  );
}
