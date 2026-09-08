import { NavigationProp } from '@react-navigation/native';

/**
 * Which tab holds a conversation, and which screen shows a ticket in it.
 *
 * The two differ by account, not by taste: an agent's job card carries accept
 * and resolve and reads an endpoint a manager cannot call, and a manager has
 * no Tasks tab to put it in. Everything that opens a chat from outside the
 * tabs — the in-app banner, a push notification — asks here, so the entry
 * points cannot drift into different answers.
 */
export function chatTargetFor(isManager: boolean): { tab: string; ticketScreen: string } {
  return isManager
    ? { tab: 'InboxTab', ticketScreen: 'ManagerTicket' }
    : { tab: 'ChatTab', ticketScreen: 'TaskDetail' };
}

/**
 * Opening a conversation.
 *
 * One screen, pushed on top of wherever you were. An earlier version pushed
 * the ticket underneath the thread so that backing out landed on the fault —
 * it worked, but it made "back" mean two different things depending on how
 * you had arrived. The ticket is now a step *forward* from the conversation
 * instead (drag left, or tap the header), which leaves back meaning exactly
 * one thing everywhere: undo the last step.
 */
export function openChat(
  navigation: NavigationProp<Record<string, object | undefined>>,
  ticketId: string,
  title?: string
): void {
  (navigation as unknown as { navigate: (name: string, params: object) => void })
    .navigate('Chat', { ticketId, title });
}

/** The same, addressed from the root stack — the banner and push both sit outside the tabs. */
export function openChatFromRoot(
  navigate: (name: string, params: object) => void,
  isManager: boolean,
  ticketId: string,
  title?: string
): void {
  const { tab } = chatTargetFor(isManager);
  navigate('Main', { screen: tab, params: { screen: 'Chat', params: { ticketId, title } } });
}
