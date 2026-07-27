import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as authApi from '../api/auth';
import { isNetworkError, registerSessionExpiredHandler } from '../api/client';
import { signalRService } from '../realtime/signalr';
import { appLock } from '../security/appLock';
import type { AgentLoginRequest, AgentProfile } from '../api/types';

// Realtime is an enhancement, never a gate: a SignalR failure (server hub
// method missing, hub down, flaky network) must not fail login/startup —
// pull-to-refresh is the guide's designated fallback (§12).
function connectRealtimeSafe(): void {
  signalRService.connect().catch(() => {});
}

// Re-lock after this long in the background. Short enough that a lost phone
// isn't wide open, long enough that snapping a photo or taking a call
// mid-task doesn't demand a PIN on every return.
const LOCK_AFTER_BACKGROUND_MS = 60_000;

interface AuthContextValue {
  agent: AgentProfile | null;
  /**
   * 'locked' = valid session, but the device gate (biometric/PIN) must pass.
   * 'pinSetup' = signed in, no PIN yet — offer to create one.
   */
  status: 'checking' | 'signedOut' | 'signedIn' | 'locked' | 'pinSetup';
  login: (credentials: AgentLoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  unlock: () => void;
  skipPinSetup: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('checking');
  const backgroundedAt = useRef<number | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const doLogout = useCallback(async () => {
    await authApi.logout();
    await signalRService.disconnect();
    // Clearing the PIN with the session keeps the gate tied to one agent —
    // otherwise the next person to sign in on this device would inherit it.
    await appLock.clear();
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
        connectRealtimeSafe();
        // A stored session behind a set PIN starts locked, not open.
        setStatus((await appLock.isPinSet()) ? 'locked' : 'signedIn');
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

  // Re-lock when the app comes back from a long stint in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        backgroundedAt.current = Date.now();
        return;
      }
      if (next === 'active' && backgroundedAt.current && statusRef.current === 'signedIn') {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (away >= LOCK_AFTER_BACKGROUND_MS) {
          appLock.isPinSet().then((set) => {
            if (set) setStatus('locked');
          });
        }
      }
    });
    return () => sub.remove();
  }, []);

  const doLogin = useCallback(async (credentials: AgentLoginRequest) => {
    const profile = await authApi.login(credentials);
    setAgent(profile);
    connectRealtimeSafe();
    // Offer the quick-unlock gate right after a full login, once per device.
    setStatus((await appLock.isPinSet()) ? 'signedIn' : 'pinSetup');
  }, []);

  const unlock = useCallback(() => setStatus('signedIn'), []);
  const skipPinSetup = useCallback(() => setStatus('signedIn'), []);

  const value = useMemo<AuthContextValue>(
    () => ({ agent, status, login: doLogin, logout: doLogout, unlock, skipPinSetup }),
    [agent, status, doLogin, doLogout, unlock, skipPinSetup]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
