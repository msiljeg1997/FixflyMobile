import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { signalRService } from '../realtime/signalr';

/**
 * Keeps a screen's data honest while it is open.
 *
 * A screen that only re-fetches on focus shows whatever it had when it was
 * opened, for as long as it stays open — the technician sits in a task while
 * the dispatcher reassigns it and reads a status that stopped being true
 * minutes ago. Wrong information that looks current is worse than a spinner.
 *
 * Two things can make a screen stale, and events alone only cover the first:
 *
 *  - something changed and the server said so — handled by the event
 *    subscriptions each screen sets up;
 *  - something changed and nobody told us, because the socket was down. The
 *    phone lost signal, or the OS froze the app in the background. SignalR
 *    reconnects on its own but never replays the gap, so the screen keeps
 *    showing pre-drop data with nothing indicating it.
 *
 * This covers the second: refetch when the connection returns, and when the
 * app comes back to the foreground.
 *
 * @param refresh what to re-read. Kept in a ref so a caller that rebuilds the
 * function every render does not re-subscribe on every render.
 * @param enabled pass false to stand down — an unfocused screen should not
 * refetch, and a signed-out one has nothing to read.
 */
export function useLiveRefresh(refresh: () => void, enabled = true): void {
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    if (!enabled) return;

    const run = () => latest.current();

    const offResync = signalRService.onResync(run);

    // The socket can die in the background without SignalR ever seeing it, so
    // coming back to the foreground is its own trigger rather than something
    // we hope a reconnect will cover.
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') run();
    });

    return () => {
      offResync();
      sub.remove();
    };
  }, [enabled]);
}
