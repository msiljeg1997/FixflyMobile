import * as SecureStore from 'expo-secure-store';

// Mirrors the web dashboard's localStorage['qrticket_token'] pattern, but using
// the OS keychain/keystore via expo-secure-store instead of plain storage —
// this holds an agent JWT, not a User JWT, so keys are deliberately different.
const ACCESS_TOKEN_KEY = 'fixfly_agent_access_token';
const REFRESH_TOKEN_KEY = 'fixfly_agent_refresh_token';

export const tokenStorage = {
  async getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  },
  async getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  },
  async setTokens(accessToken: string, refreshToken: string): Promise<void> {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  },
};
