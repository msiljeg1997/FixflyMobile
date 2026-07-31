import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as authApi from '../api/auth';
import { isNetworkError, registerSessionExpiredHandler } from '../api/client';
import { signalRService } from '../realtime/signalr';
import { appLock } from '../security/appLock';
import { MobilePrincipal } from '../api/types';
import type { AgentLoginRequest, AgentProfile, ManagerProfile } from '../api/types';

// Realtime is an enhancement, never a gate: a SignalR failure (server hub
// method missing, hub down, flaky network) must not fail login/startup —
// pull-to-refresh is the guide's designated fallback (§12).
//
// Connected for managers too: the service picks the right hub group from the
// stored principal, so a manager gets their company's ticket and chat events.
function connectRealtimeSafe(): void {
  signalRService.connect().catch(() => {});
}

// Re-lock after this long in the background. Short enough that a lost phone
// isn't wide open, long enough that snapping a photo or taking a call
// mid-task doesn't demand a PIN on every return.
const LOCK_AFTER_BACKGROUND_MS = 60_000;

interface AuthContextValue {
  /** Set when a technician or dispatcher is signed in; null for a manager. */
  agent: AgentProfile | null;
  /** Set when a company/location manager is signed in; null for an agent. */
  manager: ManagerProfile | null;
  /** Which app the person gets. Drives navigation, not just labels. */
  principal: MobilePrincipal;
  /**
   * 'locked' = valid session, but the device gate (biometric/PIN) must pass.
   * 'pinSetup' = signed in, no PIN yet — offer to create one.
   */
  status: 'checking' | 'signedOut' | 'signedIn' | 'locked' | 'pinSetup';
  login: (credentials: AgentLoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  unlock: () => void;
  /** PIN created — appLock.setPin already recorded the choice. */
  completePinSetup: () => void;
  /** Setup declined — records "off" so login stops asking. */
  skipPinSetup: () => void;
  /** Drops the local PIN and jumps to setup — after an email-verified reset. */
  resetPin: () => Promise<void>;
  /** Opens PIN setup from settings: enrolling a new lock, or replacing a PIN. */
  startPinSetup: (intent: 'enroll' | 'change') => void;
  /**
   * Why the setup screen is open. Backing out of a *change* must leave the
   * existing PIN alone; backing out of an *enroll* means "no lock, stop
   * asking".
   */
  pinSetupIntent: 'enroll' | 'change';
  /**
   * Adopts tokens that were stored outside the login call — the password
   * reset signs the agent in as part of the reset, and this picks that
   * session up without a second trip through the login screen.
   */
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [manager, setManager] = useState<ManagerProfile | null>(null);
  const [principal, setPrincipal] = useState<MobilePrincipal>(MobilePrincipal.Agent);
  const [status, setStatus] = useState<AuthContextValue['status']>('checking');
  const [pinSetupIntent, setPinSetupIntent] = useState<'enroll' | 'change'>('enroll');
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
    setManager(null);
    setPrincipal(MobilePrincipal.Agent);
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
        const restored = await authApi.fetchCurrentPrincipal();
        setAgent(restored.agent);
        setManager(restored.manager);
        setPrincipal(restored.principal);
        connectRealtimeSafe();
        // A stored session behind an ENABLED lock starts locked, not open.
        setStatus((await appLock.isLockEnabled()) ? 'locked' : 'signedIn');
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
          appLock.isLockEnabled().then((enabled) => {
            if (enabled) setStatus('locked');
          });
        }
      }
    });
    return () => sub.remove();
  }, []);

  const doLogin = useCallback(async (credentials: AgentLoginRequest) => {
    const result = await authApi.login(credentials);
    setAgent(result.agent);
    setManager(result.manager);
    setPrincipal(result.principal);
    connectRealtimeSafe();
    // Offer the quick-unlock gate once, and only to a device that has never
    // answered. Someone who turned the lock off stays signed straight in —
    // re-asking on every login is how a declined option becomes nagging.
    setStatus((await appLock.hasChosen()) ? 'signedIn' : 'pinSetup');
  }, []);

  const unlock = useCallback(() => setStatus('signedIn'), []);

  // Distinct from skipPinSetup on purpose: that one records "lock off", which
  // applied to a successful setup would switch off the PIN just created.
  const completePinSetup = useCallback(() => setStatus('signedIn'), []);

  const startPinSetup = useCallback((intent: 'enroll' | 'change') => {
    setPinSetupIntent(intent);
    setStatus('pinSetup');
  }, []);

  // "Not now" is a decision, so it gets recorded — see appLock.declineLock.
  // Except when changing an existing PIN: backing out of that means "leave it
  // as it was", not "switch the lock off".
  const skipPinSetup = useCallback(async () => {
    if (pinSetupIntent === 'enroll') await appLock.declineLock();
    setStatus('signedIn');
  }, [pinSetupIntent]);

  /**
   * Runs after an email-verified PIN reset. The session behind the lock is
   * still valid, so the app goes straight to choosing a new PIN instead of
   * throwing the agent back to a full login they don't need.
   */
  const resetPin = useCallback(async () => {
    await appLock.disableLock();
    setPinSetupIntent('enroll');
    setStatus('pinSetup');
  }, []);

  const refreshSession = useCallback(async () => {
    const restored = await authApi.fetchCurrentPrincipal();
    setAgent(restored.agent);
    setManager(restored.manager);
    setPrincipal(restored.principal);
    connectRealtimeSafe();
    setStatus((await appLock.hasChosen()) ? 'signedIn' : 'pinSetup');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      agent, manager, principal, status, login: doLogin, logout: doLogout,
      unlock, completePinSetup, skipPinSetup, resetPin, refreshSession,
      startPinSetup, pinSetupIntent,
    }),
    [agent, manager, principal, status, doLogin, doLogout, unlock, completePinSetup, skipPinSetup,
     resetPin, refreshSession, startPinSetup, pinSetupIntent]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
