import { apiClient } from './client';
import { TicketStatus } from './types';
import type { AdminInbox, AdminTicketDetail, BacklogResponse } from './types';

// Manager surface (company / location admin). Everything here runs against
// /api/admin/* with a User token — the same endpoints the dashboard uses, so
// there is one implementation of each rule rather than a mobile fork of it.

/**
 * Tickets that will not move without a person, grouped by why. Deliberately
 * NOT every ticket: the dashboard already lists those, and a phone list of
 * everything is a list nobody reads.
 */
export async function getInbox(perBucket = 5): Promise<AdminInbox> {
  const { data } = await apiClient.get<AdminInbox>('/api/admin/inbox', { params: { perBucket } });
  return data;
}

/** Stalled past the company's inbox horizon — cleanup, closable in bulk. */
export async function getBacklog(limit = 200): Promise<BacklogResponse> {
  const { data } = await apiClient.get<BacklogResponse>('/api/admin/inbox/backlog', { params: { limit } });
  return data;
}

export async function getTicket(ticketId: string): Promise<AdminTicketDetail> {
  const { data } = await apiClient.get<AdminTicketDetail>(
    `/api/admin/tickets/${encodeURIComponent(ticketId)}/full`
  );
  return data;
}

export async function bulkClose(ticketIds: string[], comment?: string): Promise<{ closed: number; requested: number }> {
  const { data } = await apiClient.post<{ closed: number; requested: number }>(
    '/api/admin/tickets/bulk-close',
    { ticketIds, comment }
  );
  return data;
}

/** Two-way: a manager who flagged something by mistake can take it back. */
export async function setUrgent(ticketId: string, isUrgent: boolean): Promise<void> {
  await apiClient.patch(`/api/admin/tickets/${encodeURIComponent(ticketId)}/urgent`, { isUrgent });
}

export async function forwardTicket(ticketId: string, agentId: number, comment?: string): Promise<void> {
  await apiClient.post(`/api/admin/tickets/${encodeURIComponent(ticketId)}/forward`, { agentId, comment });
}

export async function closeTicket(ticketId: string, comment?: string): Promise<void> {
  await apiClient.post(`/api/admin/tickets/${encodeURIComponent(ticketId)}/close`, { comment });
}

export async function reopenTicket(ticketId: string, agentId: number, comment?: string): Promise<void> {
  await apiClient.post(`/api/admin/tickets/${encodeURIComponent(ticketId)}/reopen`, { agentId, comment });
}

export interface ForwardOption {
  id: number;
  name: string;
  role: number;
  photoUrl: string | null;
  technicianSpecializations: string | null;
  availability: number;
  matchesCategory: boolean;
}

export interface ForwardOptionsResponse {
  ticketId: string;
  location: string;
  categoryName: string | null;
  requiredTrades: string[];
  options: ForwardOption[];
}

/** Scoped to the ticket's location, recommended-first by its fault category. */
export async function getForwardOptions(ticketId: string): Promise<ForwardOptionsResponse> {
  const { data } = await apiClient.get<ForwardOptionsResponse>(
    `/api/admin/tickets/${encodeURIComponent(ticketId)}/forward-options`
  );
  return data;
}

// ── Assigned tickets (the inbox's complement: work that IS owned) ───────────

export interface AssignedTicket {
  ticketId: string;
  location: string;
  description: string;
  status: TicketStatus;
  isUrgent: boolean;
  createdAt: string;
  forwardedAt: string | null;
  acceptedAt: string | null;
  assignedAgent: { id: number; name: string } | null;
  category: { id: number; name: string } | null;
}

export interface AssignedPage {
  items: AssignedTicket[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Forwarded or accepted — someone owns these and is working them. Filters and
 * paging are the server's, so the phone never holds the whole list.
 */
export async function getAssigned(opts: {
  page?: number;
  pageSize?: number;
  agentId?: number | null;
  location?: string | null;
}): Promise<AssignedPage> {
  const { data } = await apiClient.get<AssignedPage>('/api/admin/tickets', {
    params: {
      inProgress: true,
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 10,
      // assignedTo, not agentId: the latter matches anyone who ever
      // touched the ticket, which is a different question entirely.
      ...(opts.agentId ? { assignedTo: opts.agentId } : {}),
      ...(opts.location ? { location: opts.location } : {}),
    },
  });
  return data;
}

export interface FilterAgent { id: number; name: string; role: number; isActive: boolean }
export interface FilterLocation { id: number; code: string; name: string }

export async function getAgentsForFilter(): Promise<FilterAgent[]> {
  const { data } = await apiClient.get<FilterAgent[]>('/api/admin/agents');
  return data;
}

export async function getLocationsForFilter(): Promise<FilterLocation[]> {
  const { data } = await apiClient.get<FilterLocation[]>('/api/admin/locations');
  return data;
}
