import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TaskDetail, TaskHistoryEvent, TaskListItem, TaskTab } from '../api/types';

/**
 * Last-known task data, so a technician underground can still read the job he
 * is standing in front of.
 *
 * A basement, a lift shaft, a plant room: the places this app is used are the
 * places with no signal, and until now every screen went to the network and
 * showed an error without it. The work he already accepted is work he needs to
 * read — the address, the description, the contact number — precisely when he
 * cannot reach the server.
 *
 * Three deliberate limits:
 *
 *  - This is a READ cache, nothing else. It never decides anything and is
 *    never a source of truth: the moment the network answers, the answer wins.
 *    Actions still go through the outbox, which is where the rules about
 *    replaying them safely already live.
 *
 *  - Every entry carries when it was stored, and screens show that. Data with
 *    no age on it is what makes people trust a stale screen; "as of 14:20" is
 *    what makes them look again.
 *
 *  - Only the technician's own tabs are cached, and only the first page. The
 *    point is the work in hand, not an offline archive.
 */

const KEY = 'fixfly_task_cache_v1';

/** Older than this and it is history, not information. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Snapshot<T> {
  data: T;
  /** epoch ms — surfaced in the UI, not just used for expiry. */
  at: number;
}

interface CacheShape {
  lists: Partial<Record<TaskTab, Snapshot<TaskListItem[]>>>;
  details: Record<string, Snapshot<TaskDetail>>;
  histories: Record<string, Snapshot<TaskHistoryEvent[]>>;
}

const empty = (): CacheShape => ({ lists: {}, details: {}, histories: {} });

class TaskCache {
  private cache: CacheShape = empty();
  private loaded = false;
  private writing: Promise<void> | null = null;

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      this.cache = raw ? { ...empty(), ...JSON.parse(raw) } : empty();
    } catch {
      // A corrupt or unreadable cache is not worth a crash on launch — it is,
      // by definition, the copy we can afford to lose.
      this.cache = empty();
    }
    this.loaded = true;
  }

  /**
   * Writes are coalesced: a list refresh stores several entries in a row and
   * each one would otherwise be its own round trip to disk.
   */
  private schedulePersist(): void {
    if (this.writing) return;
    this.writing = new Promise((resolve) => {
      setTimeout(async () => {
        this.writing = null;
        try {
          await AsyncStorage.setItem(KEY, JSON.stringify(this.cache));
        } catch {
          // Out of space, most likely. Losing the cache is survivable.
        }
        resolve();
      }, 0);
    });
  }

  private fresh<T>(snap: Snapshot<T> | undefined): Snapshot<T> | null {
    if (!snap) return null;
    return Date.now() - snap.at <= MAX_AGE_MS ? snap : null;
  }

  async putList(tab: TaskTab, items: TaskListItem[]): Promise<void> {
    await this.ensureLoaded();
    this.cache.lists[tab] = { data: items, at: Date.now() };
    this.schedulePersist();
  }

  async getList(tab: TaskTab): Promise<Snapshot<TaskListItem[]> | null> {
    await this.ensureLoaded();
    return this.fresh(this.cache.lists[tab]);
  }

  async putDetail(task: TaskDetail): Promise<void> {
    await this.ensureLoaded();
    this.cache.details[task.ticketId] = { data: task, at: Date.now() };
    this.schedulePersist();
  }

  async getDetail(ticketId: string): Promise<Snapshot<TaskDetail> | null> {
    await this.ensureLoaded();
    return this.fresh(this.cache.details[ticketId]);
  }

  async putHistory(ticketId: string, events: TaskHistoryEvent[]): Promise<void> {
    await this.ensureLoaded();
    this.cache.histories[ticketId] = { data: events, at: Date.now() };
    this.schedulePersist();
  }

  async getHistory(ticketId: string): Promise<Snapshot<TaskHistoryEvent[]> | null> {
    await this.ensureLoaded();
    return this.fresh(this.cache.histories[ticketId]);
  }

  /**
   * Signing out has to take the cached work with it. A shared phone handed to
   * the next shift must not still hold the previous technician's jobs — their
   * addresses and reporters' phone numbers are somebody else's business.
   */
  async clear(): Promise<void> {
    this.cache = empty();
    this.loaded = true;
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      // Best effort; the next successful write overwrites it anyway.
    }
  }
}

export const taskCache = new TaskCache();
