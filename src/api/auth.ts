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
  if (refreshToken) {
    // Revoke BEFORE clearing — the revoke endpoint is [Authorize], so it needs
    // the access token still present in storage for the request interceptor.
    // Best-effort with a short wait; never block logout on network.
    try {
      await Promise.race([
        apiClient.post('/api/agent/auth/revoke', { refreshToken }),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch {
      // offline / already-dead token — local logout still proceeds
    }
  }
  await tokenStorage.clear();
}

export async function hasStoredSession(): Promise<boolean> {
  const token = await tokenStorage.getAccessToken();
  return !!token;
}

export async function fetchCurrentAgent(): Promise<AgentProfile> {
  const { data } = await apiClient.get<AgentProfile>('/api/agent/auth/me');
  return data;
}

// ── Account recovery ────────────────────────────────────────────────────────

/**
 * Always resolves for any syntactically valid address — the server answers
 * identically whether or not the account exists, so the UI must not imply it
 * learned anything either.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await apiClient.post('/api/agent/auth/forgot-password', { email });
}

/** Server signs us straight in on success; no second login round-trip. */
export async function resetPassword(email: string, code: string, newPassword: string): Promise<AgentProfile> {
  const { data } = await apiClient.post<AgentAuthResult>('/api/agent/auth/reset-password', {
    email,
    code,
    newPassword,
  });
  await tokenStorage.setTokens(data.accessToken, data.refreshToken);
  return data.agent;
}

/**
 * Emails a code for clearing the device PIN. Authenticated: the locked device
 * still holds a valid session, and that session is what identifies the agent.
 * Returns the masked address so the screen can say which inbox to check.
 */
export async function requestPinReset(): Promise<string> {
  const { data } = await apiClient.post<{ email: string }>('/api/agent/auth/forgot-pin', {});
  return data.email ?? '';
}

/** Throws on a bad or expired code; success authorizes dropping the local PIN. */
export async function verifyPinReset(code: string): Promise<void> {
  await apiClient.post('/api/agent/auth/verify-pin-reset', { code });
}
