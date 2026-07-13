import { apiClient } from './client';
import { tokenStorage } from './storage';
import type { AgentAuthResult, AgentLoginRequest, AgentProfile } from './types';

// Calls the not-yet-built /api/agent/auth/* surface (backend W2). Kept in its
// own module so screens never touch tokenStorage or apiClient directly.

export async function login(credentials: AgentLoginRequest): Promise<AgentProfile> {
  const { data } = await apiClient.post<AgentAuthResult>('/api/agent/auth/login', credentials);
  await tokenStorage.setTokens(data.accessToken, data.refreshToken);
  return data.agent;
}

export async function logout(): Promise<void> {
  const refreshToken = await tokenStorage.getRefreshToken();
  await tokenStorage.clear();
  if (refreshToken) {
    // Best-effort — don't block logout on network.
    apiClient.post('/api/agent/auth/revoke', { refreshToken }).catch(() => {});
  }
}

export async function hasStoredSession(): Promise<boolean> {
  const token = await tokenStorage.getAccessToken();
  return !!token;
}

export async function fetchCurrentAgent(): Promise<AgentProfile> {
  const { data } = await apiClient.get<AgentProfile>('/api/agent/auth/me');
  return data;
}
