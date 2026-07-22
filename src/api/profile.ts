import { apiClient } from './client';
import type { AgentStats } from './types';

export async function getMyStats(): Promise<AgentStats> {
  const { data } = await apiClient.get<AgentStats>('/api/agent/me/stats');
  return data;
}
