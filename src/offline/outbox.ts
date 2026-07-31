import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as chatApi from '../api/chat';
import * as tasksApi from '../api/tasks';
import { isNetworkError } from '../api/client';

// Offline outbox for chat sends. A technician in a basement or a lift shaft
// loses signal mid-message constantly; without this the message is simply
// lost with an error toast. Queued sends are retried when connectivity
// returns and are safe to retry because every entry carries the same
// clientMessageId the backend de-duplicates on — a message that actually
// landed before the connection dropped comes back as the original row
// instead of posting twice.
//
// RESOLVE is queued too, but accept and reject are not — and the difference
// is deliberate.
//
// The original objection to queueing task actions was that replaying them
// late could corrupt state after a dispatcher reassigned the task. It cannot:
// the server checks ownership AND status on every one, so a stale replay is
// refused (403/400) rather than applied. What remains true is the other half
// of that objection — failing SILENTLY is worse than failing loudly — so
// queued work is shown as pending and permanent failures are surfaced, never
// swallowed.
//
// Resolve is queued because its payload is irreplaceable: the technician has
// already done the job, written the comment and taken the photos, and losing
// all of it to a dead signal in a plant room means doing the job's paperwork
// twice. Accept and reject are single taps that can simply be repeated, and
// they are time-sensitive — a stale accept arriving after the acceptance
// window has expired is worth less than an error the technician sees now.

const STORAGE_KEY = 'fixfly_outbox_v1';

export type OutboxImage = { uri: string; fileName?: string | null; mimeType?: string | null };

export interface OutboxItem {
  id: string; // chat: == clientMessageId, so retries stay idempotent
  /** Absent on rows written before resolve was queued — those are all chat. */
  kind?: 'chat' | 'resolve';
  ticketId: string;
  text?: string;
  image?: OutboxImage;
  /** resolve only */
  comment?: string;
  images?: OutboxImage[];
  queuedAt: number;
  attempts: number;
  /** Set when the server refused it for good; kept so the UI can say so. */
  failedReason?: string;
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
    return this.items.filter((i) => i.ticketId === ticketId && (i.kind ?? 'chat') === 'chat');
  }

  /** Ticket ids with a resolve waiting to sync — drives the "pending" badge. */
  async pendingResolves(): Promise<OutboxItem[]> {
    await this.ensureLoaded();
    return this.items.filter((i) => i.kind === 'resolve');
  }

  async enqueueResolve(ticketId: string, comment: string, images: OutboxImage[]): Promise<void> {
    await this.ensureLoaded();
    // One pending resolve per ticket: a second tap replaces the first rather
    // than queueing a duplicate that is guaranteed to fail.
    this.items = this.items.filter((i) => !(i.kind === 'resolve' && i.ticketId === ticketId));
    this.items.push({
      id: `resolve-${ticketId}-${Date.now()}`,
      kind: 'resolve',
      ticketId,
      comment,
      images,
      queuedAt: Date.now(),
      attempts: 0,
    });
    await this.persist();
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

  async resolveFor(ticketId: string): Promise<OutboxItem | undefined> {
    await this.ensureLoaded();
    return this.items.find((i) => i.kind === 'resolve' && i.ticketId === ticketId);
  }

  /** Clears the failure so the next flush picks the entry up again. */
  async retryResolve(ticketId: string): Promise<void> {
    await this.ensureLoaded();
    const item = this.items.find((i) => i.kind === 'resolve' && i.ticketId === ticketId);
    if (!item) return;
    item.failedReason = undefined;
    item.attempts = 0;
    await this.persist();
    await this.flush();
  }

  async discardResolve(ticketId: string): Promise<void> {
    await this.ensureLoaded();
    this.items = this.items.filter((i) => !(i.kind === 'resolve' && i.ticketId === ticketId));
    await this.persist();
  }

  /** Sends everything queued, oldest first. Safe to call repeatedly. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    await this.ensureLoaded();
    if (this.items.length === 0) return;

    this.flushing = true;
    try {
      // Failed resolves are not retried on every reconnect — they need a
      // person, and hammering the server with a request that cannot succeed
      // helps nobody.
      for (const item of [...this.items].filter((i) => !i.failedReason).sort((a, b) => a.queuedAt - b.queuedAt)) {
        try {
          if (item.kind === 'resolve') {
            await tasksApi.resolveTask(item.ticketId, item.comment ?? '', item.images ?? []);
          } else {
            await chatApi.sendMessage(item.ticketId, item.id, item.text, item.image);
          }
          await this.remove(item.id);
        } catch (e) {
          if (isNetworkError(e)) {
            // Still offline — stop and keep the rest queued for next time.
            break;
          }
          // A real rejection (deleted ticket, no longer a participant,
          // reassigned meanwhile, invalid payload) will never succeed on
          // retry. Chat drops it; a resolve is kept and marked failed, because
          // it represents work already done and the technician has to be told
          // it did not land rather than discovering it days later.
          item.attempts += 1;
          if (item.kind === 'resolve') {
            item.failedReason = (e as any)?.response?.data?.message ?? 'sync-failed';
            await this.persist();
          } else if (item.attempts >= 3) {
            await this.remove(item.id);
          } else {
            await this.persist();
          }
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
