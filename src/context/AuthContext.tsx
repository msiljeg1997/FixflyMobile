import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth';
import { isNetworkError, registerSessionExpiredHandler } from '../api/client';
import { signalRService } from '../realtime/signalr';
import type { AgentLoginRequest, AgentProfile } from '../api/types';

// Realtime is an enhancement, never a gate: a SignalR failure (server hub
// method missing, hub down, flaky network) must not fail login/startup —
// pull-to-refresh is the guide's designated fallback (§12).
function connectRealtimeSafe(): void {
  signalRService.connect().catch(() => {});
}

interface AuthContextValue {
  agent: AgentProfile | null;
  status: 'checking' | 'signedOut' | 'signedIn';
  login: (credentials: AgentLoginRequest) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('checking');

  const doLogout = useCallback(async () => {
    await authApi.logout();
    await signalRService.disconnect();
    setAgent(null);
    setStatus('signedOut');
  }, []);

  useEffect(() => {
    registerSessionExpiredHandler(() => {
      doLogout();
    });
  }, [doLogout]);

  useEffect(() => {
    (async () => {
      const has = await authApi.hasStoredSession();
      if (!has) {
        setStatus('signedOut');
        return;
      }
      try {
        const profile = await authApi.fetchCurrentAgent();
        setAgent(profile);
        setStatus('signedIn');
        connectRealtimeSafe();
      } catch (error) {
        if (isNetworkError(error)) {
          // Offline at cold start: keep the stored session intact and show
          // the login screen — next launch (or a later login) with network
          // resumes normally. The offline task cache (not built yet) is what
          // will eventually let this path stay signed in.
          setStatus('signedOut');
        } else {
          // Server explicitly rejected the session — clean local logout.
          await doLogout();
        }
      }
    })();
  }, [doLogout]);

  const doLogin = useCallback(async (credentials: AgentLoginRequest) => {
    const profile = await authApi.login(credentials);
    setAgent(profile);
    setStatus('signedIn');
    connectRealtimeSafe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ agent, status, login: doLogin, logout: doLogout }),
    [agent, status, doLogin, doLogout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
