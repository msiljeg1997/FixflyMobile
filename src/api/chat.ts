import { apiClient } from './client';
import { tokenStorage } from './storage';
import type { ChatMessage, ChatThread } from './types';

/**
 * The same conversation lives behind two controllers: agents reach it through
 * /api/agent/tasks/{id}, managers through /api/admin/tickets/{id}. Resolving
 * the path here rather than at each call site keeps ChatScreen and
 * ChatListScreen unaware of who is signed in — the messages are identical
 * either way, only the door differs.
 */
async function ticketBase(ticketId: string): Promise<string> {
  const id = encodeURIComponent(ticketId);
  return (await tokenStorage.isManager())
    ? `${await tokenStorage.managerBase()}/tickets/${id}`
    : `/api/agent/tasks/${id}`;
}

// Per-ticket chat (backend W8 — ChatService, shared thread between the
// company's managers, the assigned technician and the location's
// dispatchers). Agent-side endpoints live under /api/agent/tasks/{id}.

/**
 * Conversations this agent takes part in, newest message first. Only tickets
 * that have messages — and not limited to open tasks, so a returned or closed
 * ticket keeps its thread reachable.
 */
export async function getThreads(limit = 50): Promise<ChatThread[]> {
  const path = (await tokenStorage.isManager())
    ? `${await tokenStorage.managerBase()}/chat/threads`
    : '/api/agent/chat/threads';
  const { data } = await apiClient.get<ChatThread[]>(path, { params: { limit } });
  return data;
}

export async function getMessages(ticketId: string, before?: string, limit = 50): Promise<ChatMessage[]> {
  const { data } = await apiClient.get<ChatMessage[]>(
    `${await ticketBase(ticketId)}/messages`,
    { params: { before, limit } }
  );
  return data;
}

export interface ChatImage {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}

/**
 * clientMessageId makes sends idempotent — the backend has a unique
 * (TicketId, ClientMessageId) index and returns the ORIGINAL row on a
 * repeat, so a retry after a flaky connection can never double-post.
 */
export async function sendMessage(
  ticketId: string,
  clientMessageId: string,
  text?: string,
  image?: ChatImage
): Promise<ChatMessage> {
  const form = new FormData();
  form.append('clientMessageId', clientMessageId);
  if (text) form.append('text', text);
  if (image) {
    form.append('image', {
      uri: image.uri,
      name: image.fileName || 'photo.jpg',
      type: image.mimeType || 'image/jpeg',
    } as unknown as Blob);
  }

  const { data } = await apiClient.post<ChatMessage>(
    `${await ticketBase(ticketId)}/messages`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 }
  );
  return data;
}

export async function markRead(ticketId: string): Promise<void> {
  await apiClient.post(`${await ticketBase(ticketId)}/messages/read`);
}
