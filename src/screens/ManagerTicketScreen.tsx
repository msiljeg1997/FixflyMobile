import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ManagerTicketSheet } from '../components/ManagerTicketSheet';
import { openChatWithTicket } from '../navigation/openChat';
import { colors } from '../theme/tokens';

type ParamList = { ManagerTicket: { ticketId: string } };

/**
 * A manager's ticket as a screen rather than a sheet over the inbox.
 *
 * The inbox has always shown a ticket as a modal, which works when you tap a
 * row and close it again — but it gives the ticket no address. Nothing could
 * navigate *to* it, so a conversation could not put it behind itself and a
 * push notification about a ticket had to drop the manager on the list
 * instead (see pushNavigation).
 *
 * Same component underneath, so there is one ticket UI and not two: the sheet
 * is a full-screen Modal already, and here it simply never closes on its own —
 * dismissing it means leaving the screen.
 */
export function ManagerTicketScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const { ticketId } = useRoute<RouteProp<ParamList, 'ManagerTicket'>>().params;

  return (
    // The modal presents over this; the ground behind it only shows during
    // the transition, so it matches the app's surface rather than flashing.
    <View style={styles.root}>
      <ManagerTicketSheet
        ticketId={ticketId}
        visible
        onClose={() => navigation.goBack()}
        // The inbox reloads whenever it regains focus, so a change made here
        // is already picked up on the way back — nothing to forward.
        onChanged={() => {}}
        onOpenChat={(id, title) => openChatWithTicket(navigation, 'ManagerTicket', id, title)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
});
