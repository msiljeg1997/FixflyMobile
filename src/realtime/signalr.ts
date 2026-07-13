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
      this.connection?.invoke('JoinMyGroups').catch(() => {});
    });

    try {
      await this.connection.start();
      await this.connection.invoke('JoinMyGroups'); // new hub method — backend W7
    } finally {
      this.connecting = null;
    }
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
