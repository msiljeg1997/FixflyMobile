import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { navigationRef } from '../navigation/navigationRef';

/**
 * Opening the screen a notification is about.
 *
 * The payload contract is the backend's (`Dictionary<string, string>` on every
 * `SendToAgent*` call), so it is all strings and every field is optional from
 * this side's point of view:
 *
 *   { type: 'task',  taskId:   'FX-00042' }   assigned / reassigned / urgent
 *   { type: 'chat',  ticketId: 'FX-00042', messageId: '881' }
 *
 * Both ids carry the same thing — a ticket's public code — under two names,
 * because the two senders were written against different vocabularies. Read
 * both rather than making the app depend on which one showed up.
 */

interface PushData {
  type?: string;
  taskId?: string;
  ticketId?: string;
  messageId?: string;
}

/**
 * A tap that lands before the app can act on it: during the splash, at the
 * lock screen, or while a session is still being restored. Held here and
 * replayed once navigation is both ready and past the gate, so a cold start
 * from a notification ends on the right screen rather than the task list.
 */
let pending: PushData | null = null;
let armed = false;

function readPayload(response: Notifications.NotificationResponse): PushData {
  return (response.notification.request.content.data ?? {}) as PushData;
}

/**
 * Ticket code under either name, and a nudge toward the right screen when
 * `type` is missing: a chat notification is the one that names `ticketId`.
 */
function route(data: PushData): { tab: 'ChatTab' | 'TasksTab'; ticketId: string } | null {
  const ticketId = data.taskId || data.ticketId;
  if (!ticketId) return null;
  const isChat = data.type === 'chat' || (!data.type && !data.taskId);
  return { tab: isChat ? 'ChatTab' : 'TasksTab', ticketId };
}

function open(data: PushData): void {
  if (!armed || !navigationRef.isReady()) {
    pending = data;
    return;
  }
  const target = route(data);
  if (!target) return;

  // Addressed all the way down from the root stack. 'ChatTab' means nothing at
  // the root — the root knows only Login/Lock/Main — so a partial target is
  // dropped silently rather than failing loudly. Same reasoning as ChatBanner.
  navigationRef.navigate('Main', {
    screen: target.tab,
    params:
      target.tab === 'ChatTab'
        ? { screen: 'Chat', params: { ticketId: target.ticketId } }
        : { screen: 'TaskDetail', params: { ticketId: target.ticketId } },
  } as never);
}

/**
 * Listens for notification taps and follows them to the matching screen.
 *
 * @param ready true once the app is past login and any device lock — the
 * point at which the destination screens actually exist in the stack.
 */
export function usePushNavigation(ready: boolean): void {
  // Registered regardless of `ready`: a tap while the app sits at the lock
  // screen still says where the person wanted to go, and it is held until
  // they get through.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      open(readPayload(response));
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    armed = ready;
    if (!ready) return;

    // A tap that launched the app from cold is not delivered to the listener
    // above — it happened before any of this was running — so it is collected
    // from the response that started the process, then cleared. Without the
    // clear it would be replayed on every later unlock, dragging the person
    // back to a conversation they finished with hours ago.
    const launch = Notifications.getLastNotificationResponse();
    if (launch) {
      Notifications.clearLastNotificationResponse();
      open(readPayload(launch));
      return;
    }

    if (pending) {
      const held = pending;
      pending = null;
      open(held);
    }
  }, [ready]);
}

/** Drops a held tap on sign-out — it belonged to the session that just ended. */
export function forgetPendingPushNavigation(): void {
  pending = null;
}
