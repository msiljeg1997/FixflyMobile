import { apiClient } from './client';
import { tokenStorage } from './storage';
import type { AgentAuthResult, AgentLoginRequest, AgentProfile, ManagerProfile, MobileAuthResult } from './types';

// Calls the not-yet-built /api/agent/auth/* surface (backend W2). Kept in its
// own module so screens never touch tokenStorage or apiClient directly.

/**
 * One sign-in for every kind of account. The server decides whether these
 * credentials belong to an agent or a manager and says so in `principal` —
 * the caller does not have to know which, and neither does the person typing.
 */
export async function login(credentials: AgentLoginRequest): Promise<MobileAuthResult> {
  const { data } = await apiClient.post<MobileAuthResult>('/api/mobile/auth/login', credentials);
  await tokenStorage.setTokens(data.accessToken, data.refreshToken, principalOf(data));
  return data;
}

/**
 * A venue manager is a manager whose world is one location. The server says so
 * in the role, and it has to be recorded now: after this call the app only has
 * a token, and /api/admin/* answers a LocationAdmin with 403, not with a hint.
 */
function principalOf(result: MobileAuthResult) {
  if (result.principal !== 1) return 'agent' as const;
  return result.manager?.role === 'LocationAdmin' ? ('venue' as const) : ('manager' as const);
}

export async function logout(): Promise<void> {
  const refreshToken = await tokenStorage.getRefreshToken();
  if (refreshToken) {
    // Revoke BEFORE clearing — the revoke endpoint is [Authorize], so it needs
    // the access token still present in storage for the request interceptor.
    // Best-effort with a short wait; never block logout on network.
    try {
      const revokePath = (await tokenStorage.isManager()) ? '/api/auth/revoke' : '/api/agent/auth/revoke';
      await Promise.race([
        apiClient.post(revokePath, { refreshToken }),
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

/**
 * Restores whichever profile the stored session belongs to. A cold start
 * cannot ask /agent/auth/me for a manager — that endpoint is agent-only and
 * would 401, taking a perfectly good session down with it.
 */
export async function fetchCurrentPrincipal(): Promise<MobileAuthResult> {
  if (await tokenStorage.isManager()) {
    const { data } = await apiClient.get<ManagerProfile>(`${await tokenStorage.managerBase()}/me`);
    return { accessToken: '', refreshToken: '', expiresAt: '', principal: 1, agent: null, manager: data };
  }
  const agent = await fetchCurrentAgent();
  return { accessToken: '', refreshToken: '', expiresAt: '', principal: 0, agent, manager: null };
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
