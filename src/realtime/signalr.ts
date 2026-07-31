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
