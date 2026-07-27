import { apiClient } from './client';
import type { ChatMessage } from './types';

// Per-ticket chat (backend W8 — ChatService, shared thread between the
// company's managers, the assigned technician and the location's
// dispatchers). Agent-side endpoints live under /api/agent/tasks/{id}.

export async function getMessages(ticketId: string, before?: string, limit = 50): Promise<ChatMessage[]> {
  const { data } = await apiClient.get<ChatMessage[]>(
    `/api/agent/tasks/${encodeURIComponent(ticketId)}/messages`,
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
    `/api/agent/tasks/${encodeURIComponent(ticketId)}/messages`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 }
  );
  return data;
}

export async function markRead(ticketId: string): Promise<void> {
  await apiClient.post(`/api/agent/tasks/${encodeURIComponent(ticketId)}/messages/read`);
}
