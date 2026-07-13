import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth';
import { registerSessionExpiredHandler } from '../api/client';
import { signalRService } from '../realtime/signalr';
import type { AgentLoginRequest, AgentProfile } from '../api/types';

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
        await signalRService.connect();
      } catch {
        // Token dead and refresh already failed (interceptor cleared it) —
        // or the network is down. Either way, fall back to the login screen;
        // the offline task cache (cross-cutting layer, not built yet) is what
        // will eventually let a genuinely-offline-but-still-logged-in agent
        // keep working without this refetch succeeding.
        await doLogout();
      }
    })();
  }, [doLogout]);

  const doLogin = useCallback(async (credentials: AgentLoginRequest) => {
    const profile = await authApi.login(credentials);
    setAgent(profile);
    setStatus('signedIn');
    await signalRService.connect();
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
