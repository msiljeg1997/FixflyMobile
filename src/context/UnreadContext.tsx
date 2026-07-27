import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as chatApi from '../api/chat';
import { signalRService } from '../realtime/signalr';
import type { ChatMessage } from '../api/types';

interface UnreadContextValue {
  /** Total unread chat messages across the agent's conversations. */
  total: number;
  /** Refetch counts from the server (after opening a thread, etc). */
  refresh: () => void;
  /** Latest message that arrived while the app was open, for the in-app banner. */
  banner: { ticketId: string; message: ChatMessage } | null;
  dismissBanner: () => void;
  /** Suppress banners for a thread while the user is looking at it. */
  setActiveThread: (ticketId: string | null) => void;
}

const UnreadContext = createContext<UnreadContextValue | null>(null);

export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const [total, setTotal] = useState(0);
  const [banner, setBanner] = useState<UnreadContextValue['banner']>(null);
  const activeThread = useRef<string | null>(null);

  // Counted over the same threads the Chat tab lists. Summing the active-task
  // list instead (as this used to) both missed unread messages on returned or
  // closed tickets and let the badge disagree with what the list showed.
  const refresh = useCallback(async () => {
    try {
      const threads = await chatApi.getThreads();
      setTotal(threads.reduce((sum, x) => sum + (x.unreadCount ?? 0), 0));
    } catch {
      // Leave the previous count — a failed poll shouldn't zero the badge.
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Unlike the dashboard (where a manager only wants threads they replied
  // in), an agent only ever sees their own tickets, so every chat message
  // that reaches them is relevant — no filtering needed here.
  useEffect(() => {
    const off = signalRService.onChatMessageReceived((evt) => {
      refresh();
      // Don't interrupt with a banner for the thread already on screen.
      if (activeThread.current === evt.ticketId) return;
      setBanner({ ticketId: evt.ticketId, message: evt.message });
    });
    return off;
  }, [refresh]);

  // Auto-dismiss so a missed banner doesn't sit there forever.
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(timer);
  }, [banner]);

  const value = useMemo<UnreadContextValue>(
    () => ({
      total,
      refresh,
      banner,
      dismissBanner: () => setBanner(null),
      setActiveThread: (ticketId) => {
        activeThread.current = ticketId;
        if (ticketId && banner?.ticketId === ticketId) setBanner(null);
      },
    }),
    [total, refresh, banner]
  );

  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export function useUnread(): UnreadContextValue {
  const ctx = useContext(UnreadContext);
  if (!ctx) throw new Error('useUnread must be used within UnreadProvider');
  return ctx;
}
