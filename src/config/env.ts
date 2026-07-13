// Environment config. Swap via EXPO_PUBLIC_API_URL at build/run time
// (e.g. `EXPO_PUBLIC_API_URL=https://test.fixfly.io npx expo start`).
// Expo inlines EXPO_PUBLIC_* vars into the JS bundle at build time.

const DEV_API_URL = 'http://localhost:5062';
const STAGING_API_URL = 'https://test.fixfly.io';
const PROD_API_URL = 'https://app.fixfly.io';

function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;
  if (__DEV__) return DEV_API_URL;
  return PROD_API_URL;
}

export const env = {
  apiUrl: resolveApiUrl(),
  hubUrl: `${resolveApiUrl()}/hubs/tickets`,
  stagingApiUrl: STAGING_API_URL,
};
