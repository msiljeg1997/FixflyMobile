import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as chatApi from '../api/chat';
import { isNetworkError } from '../api/client';

// Offline outbox for chat sends. A technician in a basement or a lift shaft
// loses signal mid-message constantly; without this the message is simply
// lost with an error toast. Queued sends are retried when connectivity
// returns and are safe to retry because every entry carries the same
// clientMessageId the backend de-duplicates on — a message that actually
// landed before the connection dropped comes back as the original row
// instead of posting twice.
//
// Only chat is queued. Task actions (accept/resolve/reject) are deliberately
// NOT queued: they change ticket state that other people act on, and silently
// replaying them minutes later — after a dispatcher may have reassigned the
// task — would be worse than failing loudly at the time.

const STORAGE_KEY = 'fixfly_outbox_v1';

export interface OutboxItem {
  id: string; // == clientMessageId, so retries stay idempotent
  ticketId: string;
  text?: string;
  image?: { uri: string; fileName?: string | null; mimeType?: string | null };
  queuedAt: number;
  attempts: number;
}

type Listener = () => void;

class Outbox {
  private items: OutboxItem[] = [];
  private loaded = false;
  private flushing = false;
  private listeners = new Set<Listener>();

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      this.items = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    } catch {
      this.items = [];
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch {
      // Storage full / unavailable — the in-memory queue still works for
      // this session, which covers the common "signal came back a minute
      // later" case.
    }
    this.listeners.forEach((fn) => fn());
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async pendingFor(ticketId: string): Promise<OutboxItem[]> {
    await this.ensureLoaded();
    return this.items.filter((i) => i.ticketId === ticketId);
  }

  async enqueue(item: Omit<OutboxItem, 'queuedAt' | 'attempts'>): Promise<void> {
    await this.ensureLoaded();
    if (this.items.some((i) => i.id === item.id)) return;
    this.items.push({ ...item, queuedAt: Date.now(), attempts: 0 });
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    this.items = this.items.filter((i) => i.id !== id);
    await this.persist();
  }

  /** Sends everything queued, oldest first. Safe to call repeatedly. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    await this.ensureLoaded();
    if (this.items.length === 0) return;

    this.flushing = true;
    try {
      for (const item of [...this.items].sort((a, b) => a.queuedAt - b.queuedAt)) {
        try {
          await chatApi.sendMessage(item.ticketId, item.id, item.text, item.image);
          await this.remove(item.id);
        } catch (e) {
          if (isNetworkError(e)) {
            // Still offline — stop and keep the rest queued for next time.
            break;
          }
          // A real rejection (deleted ticket, no longer a participant,
          // invalid payload) will never succeed on retry; drop it rather
          // than retrying forever.
          item.attempts += 1;
          if (item.attempts >= 3) await this.remove(item.id);
          else await this.persist();
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Retry whenever the device regains connectivity. */
  startAutoFlush(): () => void {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) this.flush();
    });
    this.flush();
    return unsubscribe;
  }
}

export const outbox = new Outbox();
