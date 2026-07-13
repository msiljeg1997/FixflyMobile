import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { env } from '../config/env';
import { tokenStorage } from './storage';
import type { AgentAuthResult, AgentRefreshRequest } from './types';

// Typed API client with a JWT + refresh interceptor, mirroring the pattern
// already used on the web dashboard (shared/interceptors/auth.interceptor.ts +
// error.interceptor.ts), adapted for axios + React Native.
//
// Auth endpoints hit here (POST /api/agent/auth/*) don't exist yet — they're
// built in backend W2. This client is written against the frozen contract so
// mobile + backend can proceed in parallel (guide §5, Phase 0).

export const apiClient = axios.create({
  baseURL: env.apiUrl,
  timeout: 15000,
});

apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await tokenStorage.getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

// Queue concurrent requests while a single refresh is in flight, so a burst
// of 401s doesn't trigger a burst of refresh calls.
let refreshPromise: Promise<string | null> | null = null;

/** True when the request never reached the server (offline, DNS, timeout). */
export function isNetworkError(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await tokenStorage.getRefreshToken();
  if (!refreshToken) return null;

  try {
    const body: AgentRefreshRequest = { refreshToken };
    const { data } = await axios.post<AgentAuthResult>(
      `${env.apiUrl}/api/agent/auth/refresh`,
      body
    );
    await tokenStorage.setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch (error) {
    // Clear only when the server actually rejected the token — a network
    // failure must not destroy a valid session (retry succeeds when back
    // online).
    if (!isNetworkError(error)) {
      await tokenStorage.clear();
    }
    return null;
  }
}

// Set by AuthContext once mounted, so the interceptor can force a logout/
// navigate-to-login when the refresh token itself is dead (avoids a circular
// import between the API layer and the navigation/auth layer).
let onSessionExpired: (() => void) | null = null;
export function registerSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;

      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      const newToken = await refreshPromise;

      if (newToken) {
        original.headers.set('Authorization', `Bearer ${newToken}`);
        return apiClient(original);
      }

      // Fire session-expired only when the refresh token is truly gone
      // (server rejected it) — after a mere network failure the tokens are
      // still stored and the session survives for a later retry.
      if (!(await tokenStorage.getRefreshToken())) {
        onSessionExpired?.();
      }
    }

    return Promise.reject(error);
  }
);
