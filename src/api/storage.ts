import * as SecureStore from 'expo-secure-store';

// Mirrors the web dashboard's localStorage['qrticket_token'] pattern, but using
// the OS keychain/keystore via expo-secure-store instead of plain storage —
// this holds an agent JWT, not a User JWT, so keys are deliberately different.
const ACCESS_TOKEN_KEY = 'fixfly_agent_access_token';
const REFRESH_TOKEN_KEY = 'fixfly_agent_refresh_token';
// Which kind of account the stored tokens belong to. Load-bearing, not a
// convenience: agent and manager tokens refresh, revoke and resolve their
// profile through DIFFERENT endpoints, and the agent ones reject a manager
// token outright. Without this a manager's session would silently die at the
// first token expiry.
const PRINCIPAL_KEY = 'fixfly_principal'; // 'agent' | 'manager'

export type StoredPrincipal = 'agent' | 'manager';

export const tokenStorage = {
  async getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  },
  async getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  },
  /** Defaults to 'agent' for sessions stored before this key existed. */
  async getPrincipal(): Promise<StoredPrincipal> {
    return (await SecureStore.getItemAsync(PRINCIPAL_KEY)) === 'manager' ? 'manager' : 'agent';
  },
  async setTokens(accessToken: string, refreshToken: string, principal: StoredPrincipal = 'agent'): Promise<void> {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
    await SecureStore.setItemAsync(PRINCIPAL_KEY, principal);
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    await SecureStore.deleteItemAsync(PRINCIPAL_KEY);
  },
};
