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

export async function resolveTask(ticketId: string, comment: string, images: ResolveImage[]): Promise<TaskDetail> {
  const form = new FormData();
  form.append('comment', comment);
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

export async function getTechnicians(): Promise<TechnicianOption[]> {
  const { data } = await apiClient.get<TechnicianOption[]>('/api/agent/technicians');
  return data;
}

export async function forwardTask(ticketId: string, technicianAgentId: number): Promise<TaskDetail> {
  const { data } = await apiClient.post<TaskDetail>(
    `/api/agent/tasks/${encodeURIComponent(ticketId)}/forward`,
    { technicianAgentId }
  );
  return data;
}
