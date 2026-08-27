import * as signalR from '@microsoft/signalr';
import { env } from '../config/env';
import { tokenStorage } from '../api/storage';
import type {
  ChatMessageReadEvent,
  ChatMessageReceivedEvent,
  TaskAssignedToMeEvent,
  TaskStatusChangedEvent,
} from '../api/types';

// Mirrors DomagojFront's shared/services/signalr.service.ts, adapted for RN.
// Connects to the SAME hub the dashboard uses (/hubs/tickets) — agents join
// via ?access_token=<agent JWT>, then call JoinMyGroups() (new hub method,
// backend W7) to land in the Agent_{agentId} group instead of a company group.

type Listener<T> = (payload: T) => void;

class SignalRService {
  private connection: signalR.HubConnection | null = null;
  private connecting: Promise<void> | null = null;

  private taskAssignedListeners = new Set<Listener<TaskAssignedToMeEvent>>();
  private taskStatusChangedListeners = new Set<Listener<TaskStatusChangedEvent>>();
  private chatReceivedListeners = new Set<Listener<ChatMessageReceivedEvent>>();
  private chatReadListeners = new Set<Listener<ChatMessageReadEvent>>();
  private companyChangedListeners = new Set<() => void>();
  /**
   * Fired after the socket comes back.
   *
   * SignalR does not replay what happened while the connection was down, so a
   * screen that only listens to events shows whatever it had before the drop —
   * with nothing on screen saying it is stale. Every subscriber re-fetches on
   * this instead of trusting the events it may never have received.
   */
  private resyncListeners = new Set<() => void>();
  /** Which thread is on screen, so it can be re-announced after a reconnect. */
  private openThread: string | null = null;

  async connect(): Promise<void> {
    if (this.connection?.state === signalR.HubConnectionState.Connected) return;
    if (this.connecting) return this.connecting;

    this.connecting = this.createConnection();
    return this.connecting;
  }

  private async createConnection(): Promise<void> {
    const token = await tokenStorage.getAccessToken();

    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(env.hubUrl, { accessTokenFactory: async () => (await tokenStorage.getAccessToken()) ?? token ?? '' })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    this.registerHandlers();

    this.connection.onreconnected(() => {
      this.joinGroups().catch(() => {});
      // Presence lives with the socket that reported it, so a reconnect on a
      // new socket has to say it again — otherwise the screen stays open and
      // the server quietly starts pushing to it.
      if (this.openThread) this.enterThread(this.openThread).catch(() => {});
      // Whatever happened during the gap was never delivered. Tell the screens
      // to go and look rather than leave them showing the last thing they saw.
      this.notifyResync();
    });

    try {
      await this.connection.start();
      await this.joinGroups();
    } finally {
      this.connecting = null;
    }
  }

  /**
   * Agents belong to a personal Agent_{id} group; managers belong to their
   * company's. JoinMyGroups puts a manager in User_{id}, which NOTHING ever
   * broadcasts to — every manager-facing event goes to Company_{id}, which is
   * what JoinAdminGroup joins. Calling the wrong one leaves a connected socket
   * that never receives anything, which looks exactly like working code.
   *
   * Failures are swallowed: realtime is an enhancement, and a missing hub
   * method must not tear down an otherwise healthy connection.
   */
  private async joinGroups(): Promise<void> {
    // Both manager kinds take the company group — that is where chat and ticket
    // events go, and it is what the web dashboard already does for a venue
    // manager. Their screens re-fetch from a scoped endpoint on every event, so
    // the group only decides *when* they refresh, not what they can read.
    const method = (await tokenStorage.isManager()) ? 'JoinAdminGroup' : 'JoinMyGroups';
    await this.connection?.invoke(method).catch(() => {});
  }

  /**
   * Tells the server this thread is on screen, so it skips the push — a
   * notification for the conversation you are reading is noise. Best
   * effort: a failure here only means one redundant notification.
   */
  async enterThread(ticketId: string): Promise<void> {
    this.openThread = ticketId;
    await this.connection?.invoke('EnterThread', ticketId).catch(() => {});
  }

  async leaveThread(ticketId: string): Promise<void> {
    if (this.openThread === ticketId) this.openThread = null;
    await this.connection?.invoke('LeaveThread', ticketId).catch(() => {});
  }

  private registerHandlers(): void {
    if (!this.connection) return;

    this.connection.on('TaskAssignedToMe', (data: TaskAssignedToMeEvent) => {
      this.taskAssignedListeners.forEach((fn) => fn(data));
    });
    this.connection.on('TaskStatusChanged', (data: TaskStatusChangedEvent) => {
      this.taskStatusChangedListeners.forEach((fn) => fn(data));
    });
    this.connection.on('ChatMessageReceived', (data: ChatMessageReceivedEvent) => {
      this.chatReceivedListeners.forEach((fn) => fn(data));
    });
    this.connection.on('ChatMessageRead', (data: ChatMessageReadEvent) => {
      this.chatReadListeners.forEach((fn) => fn(data));
    });

    // Company-group events. A manager's inbox is a view over all of these, so
    // rather than model each one it just reloads — the payloads differ and the
    // screen would have to refetch anyway.
    for (const event of ['TicketCreated', 'TicketStatusChanged', 'TicketAssigned', 'TicketEscalated']) {
      this.connection.on(event, () => {
        this.companyChangedListeners.forEach((fn) => fn());
      });
    }
  }

  /**
   * "The connection was away; re-read what you show." Also called by hand when
   * the app returns from the background, where the socket may have been torn
   * down without SignalR noticing.
   */
  onResync(fn: () => void): () => void {
    this.resyncListeners.add(fn);
    return () => this.resyncListeners.delete(fn);
  }

  notifyResync(): void {
    for (const fn of this.resyncListeners) {
      try { fn(); } catch { /* one bad subscriber must not stop the others */ }
    }
  }

  /** Any ticket change anywhere in the company — drives the manager inbox. */
  onCompanyTicketsChanged(fn: () => void): () => void {
    this.companyChangedListeners.add(fn);
    return () => this.companyChangedListeners.delete(fn);
  }

  async disconnect(): Promise<void> {
    await this.connection?.stop();
    this.connection = null;
  }

  onTaskAssigned(fn: Listener<TaskAssignedToMeEvent>): () => void {
    this.taskAssignedListeners.add(fn);
    return () => this.taskAssignedListeners.delete(fn);
  }

  onTaskStatusChanged(fn: Listener<TaskStatusChangedEvent>): () => void {
    this.taskStatusChangedListeners.add(fn);
    return () => this.taskStatusChangedListeners.delete(fn);
  }

  onChatMessageReceived(fn: Listener<ChatMessageReceivedEvent>): () => void {
    this.chatReceivedListeners.add(fn);
    return () => this.chatReceivedListeners.delete(fn);
  }

  onChatMessageRead(fn: Listener<ChatMessageReadEvent>): () => void {
    this.chatReadListeners.add(fn);
    return () => this.chatReadListeners.delete(fn);
  }
}

export const signalRService = new SignalRService();
