import { CommonActions, NavigationProp } from '@react-navigation/native';

/**
 * Which tab holds a conversation, and which ticket screen sits under it.
 *
 * The two differ by account, not by taste: an agent's job card carries accept
 * and resolve and reads an endpoint a manager cannot call, and a manager has
 * no Tasks tab to put it in. Everything that opens a chat from outside the
 * tabs — the in-app banner, a push notification — asks here, so the three
 * entry points cannot drift into three answers.
 */
export function chatTargetFor(isManager: boolean): { tab: string; under: string } {
  return isManager
    ? { tab: 'InboxTab', under: 'ManagerTicket' }
    : { tab: 'ChatTab', under: 'TaskDetail' };
}

/**
 * The same rule, addressed from the root stack.
 *
 * Two dispatches rather than one built state: the tab's stack is a child
 * navigator, and from the root the only handle onto it is its name.
 */
export function openChatFromRoot(
  navigate: (name: string, params: object) => void,
  isManager: boolean,
  ticketId: string,
  title?: string
): void {
  const { tab, under } = chatTargetFor(isManager);
  const go = (screen: string, params: object) =>
    navigate('Main', { screen: tab, params: { screen, params } });

  go(under, { ticketId });
  go('Chat', { ticketId, title });
}

/**
 * The rule: leaving a conversation lands on the ticket it is about.
 *
 * Reading a thread and then needing the fault behind it is the normal case,
 * not the exception — without this you memorise the ticket code, back out,
 * and search for it. So the ticket is pushed *underneath* the chat rather
 * than the back button being intercepted: the stack then genuinely says what
 * it does, the iOS swipe-back gesture follows it for free, and nothing has to
 * remember where anybody came from.
 *
 * What the second back does falls out of the same rule. Opened from the
 * thread list, the stack is [list, ticket, chat] and the second back is the
 * list. Opened from a ticket, the ticket is already on the stack and only the
 * chat is pushed, so the second back is the ticket list — which is why the
 * technician's Tasks path already behaved correctly and needed no change.
 */
export function openChatWithTicket(
  navigation: NavigationProp<Record<string, object | undefined>>,
  detailRoute: string,
  ticketId: string,
  title?: string
): void {
  navigation.dispatch(state => {
    // Already standing on this ticket: only the chat is missing.
    const top = state.routes[state.routes.length - 1];
    const alreadyOnTicket =
      top?.name === detailRoute && (top.params as { ticketId?: string } | undefined)?.ticketId === ticketId;

    const routes = alreadyOnTicket
      ? [...state.routes, { name: 'Chat', params: { ticketId, title } }]
      : [
          ...state.routes,
          { name: detailRoute, params: { ticketId } },
          { name: 'Chat', params: { ticketId, title } },
        ];

    // Keys are left off the new routes on purpose — React Navigation mints
    // them, and reusing one would resurrect a screen's old state.
    return CommonActions.reset({ ...state, routes, index: routes.length - 1 });
  });
}
