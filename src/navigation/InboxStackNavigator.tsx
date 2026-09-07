import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { InboxScreen } from '../screens/InboxScreen';
import { ManagerTicketScreen } from '../screens/ManagerTicketScreen';
import { ChatScreen } from '../screens/ChatScreen';

export type InboxStackParamList = {
  Inbox: undefined;
  ManagerTicket: { ticketId: string };
  Chat: { ticketId: string; title?: string };
};

const Stack = createNativeStackNavigator<InboxStackParamList>();

// The inbox used to be a bare screen in the tab bar, which is why opening a
// conversation from a ticket jumped to the Chat tab: there was nowhere else
// for it to go. With the ticket and the thread addressable here, a manager who
// starts at a ticket stays in this tab, and backing out of the conversation
// walks ticket → inbox instead of landing in a list of unrelated threads.
export function InboxStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Inbox" component={InboxScreen} />
      <Stack.Screen name="ManagerTicket" component={ManagerTicketScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
    </Stack.Navigator>
  );
}
