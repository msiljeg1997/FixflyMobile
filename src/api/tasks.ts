import { apiClient } from './client';
import type {
  AgentProfile,
  PutAvailabilityRequest,
  TaskDetail,
  TaskHistoryEvent,
  TaskListResponse,
  TaskTab,
  TechnicianOption,
} from './types';

// Task endpoints (backend W3/W4 — Controllers/AgentController.cs).
// Screens never touch apiClient directly; this module is the API surface.

export async function getTasks(tab: TaskTab, page = 1, pageSize = 20): Promise<TaskListResponse> {
  const { data } = await apiClient.get<TaskListResponse>('/api/agent/tasks', {
    params: { tab, page, pageSize },
  });
  return data;
}

export async function getTask(ticketId: string): Promise<TaskDetail> {
  const { data } = await apiClient.get<TaskDetail>(`/api/agent/tasks/${encodeURIComponent(ticketId)}`);
  return data;
}

export async function getTaskHistory(ticketId: string): Promise<TaskHistoryEvent[]> {
  const { data } = await apiClient.get<TaskHistoryEvent[]>(`/api/agent/tasks/${encodeURIComponent(ticketId)}/history`);
  return data;
}

export async function acceptTask(ticketId: string): Promise<TaskDetail> {
  const { data } = await apiClient.post<TaskDetail>(`/api/agent/tasks/${encodeURIComponent(ticketId)}/accept`);
  return data;
}

export async function rejectTask(ticketId: string, reason: string): Promise<void> {
  await apiClient.post(`/api/agent/tasks/${encodeURIComponent(ticketId)}/reject`, { reason });
}

export interface ResolveImage {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}

/**
 * @param resolvedAt when the technician actually marked it done, as epoch ms.
 * Only meaningful for a resolve that sat in the outbox: a job finished in a
 * basement reaches the server whenever signal returns, and stamping the
 * arrival puts hours nobody worked into the average resolution time — and can
 * push a job finished at 23:50 into the next day. The server ignores anything
 * outside the acceptance-to-now window, so a wrong phone clock changes nothing.
 */
export async function resolveTask(
  ticketId: string,
  comment: string,
  images: ResolveImage[],
  resolvedAt?: number
): Promise<TaskDetail> {
  const form = new FormData();
  form.append('comment', comment);
  if (resolvedAt) form.append('resolvedAt', new Date(resolvedAt).toISOString());
  images.forEach((img, i) => {
    // React Native FormData file part: { uri, name, type }
    form.append('images', {
      uri: img.uri,
      name: img.fileName || `photo_${i + 1}.jpg`,
      type: img.mimeType || 'image/jpeg',
    } as unknown as Blob);
  });

  const { data } = await apiClient.post<TaskDetail>(
    `/api/agent/tasks/${encodeURIComponent(ticketId)}/resolve`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 }
  );
  return data;
}

export async function putAvailability(body: PutAvailabilityRequest): Promise<AgentProfile> {
  const { data } = await apiClient.put<AgentProfile>('/api/agent/status', body);
  return data;
}

/**
 * Pass the ticket so the server can scope the list to its location and mark
 * who its fault category recommends. Without it the list is every technician.
 */
export async function getTechnicians(ticketId?: string): Promise<TechnicianOption[]> {
  const { data } = await apiClient.get<TechnicianOption[]>('/api/agent/technicians', {
    params: ticketId ? { ticketId } : undefined,
  });
  return data;
}

/**
 * @param handoverNote what the receiving technician needs to know. It is the
 * only thing he inherits — the conversation stays with whoever had the ticket
 * — so the dispatcher decides here what carries forward.
 */
/**
 * Marking a ticket urgent swaps the acceptance deadline for the company's
 * shorter urgent one and pushes every dispatcher covering the location — so
 * it is a real lever, not a label.
 */
export async function setTaskUrgent(ticketId: string, isUrgent: boolean): Promise<void> {
  await apiClient.patch(`/api/agent/tasks/${encodeURIComponent(ticketId)}/urgent`, { isUrgent });
}

export async function forwardTask(
  ticketId: string,
  technicianAgentId: number,
  handoverNote?: string
): Promise<TaskDetail> {
  const { data } = await apiClient.post<TaskDetail>(
    `/api/agent/tasks/${encodeURIComponent(ticketId)}/forward`,
    { technicianAgentId, handoverNote }
  );
  return data;
}


// ── Description translation ─────────────────────────────────────────────────

export interface TicketTranslation {
  ticketId: string;
  language: string;
  text: string;
  detectedSource: string | null;
  /** True when there was nothing to translate — hide the button. */
  alreadyInLanguage: boolean;
}

/** Whether a translation key is configured at all. */
/**
 * Asked once per session, not once per screen.
 *
 * Whether a translation key is configured is a fact about the server, and it
 * does not change while somebody is using the app. Every ticket screen asked
 * again as it mounted — and with the conversation and its ticket a swipe apart,
 * reading one fault could mount its ticket screen over and over, spending a
 * request each time. That is what ran the per-minute limit dry in normal use.
 *
 * Nothing live depends on this. Ticket and message updates arrive over the
 * socket and through their own refreshes; this only decides whether one
 * button is drawn, so holding the answer cannot make a screen stale.
 *
 * One in-flight request is shared, so two screens mounting together ask once.
 * A failure is NOT remembered: on a phone a dropped connection is ordinary, and
 * caching "unavailable" would hide the button for the rest of the session over
 * one bad moment. The next screen simply asks again.
 */
let availability: Promise<boolean> | null = null;

export function translationAvailable(): Promise<boolean> {
  if (!availability) {
    availability = apiClient
      .get<{ available: boolean }>('/api/translate/availability')
      .then(({ data }) => data.available)
      .catch(() => {
        availability = null;
        // Hiding a button is recoverable; offering one that always errors is not.
        return false;
      });
  }
  return availability;
}

/** The fault description in `lang` ("HR" | "EN" | "DE"). Cached server-side. */
export async function translateTicket(ticketId: string, lang: string): Promise<TicketTranslation> {
  const { data } = await apiClient.get<TicketTranslation>(
    `/api/translate/ticket/${encodeURIComponent(ticketId)}`,
    { params: { lang } }
  );
  return data;
}
