import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { apiClient } from '../api/client';
import { tokenStorage } from '../api/storage';
import i18n from '../i18n';

/**
 * Registering this device to be woken by the server.
 *
 * The backend sends through the Firebase Admin SDK, which addresses devices by
 * their NATIVE FCM/APNs token. So this asks for `getDevicePushTokenAsync`, not
 * `getExpoPushTokenAsync` — the Expo token is a different address space
 * belonging to Expo's own relay, and handing one to FCM fails per-token at
 * send time, which looks like "push just doesn't arrive" and never like a
 * wrong token.
 *
 * Everything here is best-effort. Someone who declines notifications, or whose
 * device cannot register, must still get a working app.
 */

// Android needs a channel before anything can be shown, and the channel — not
// the message — is what carries importance. Without one, notifications arrive
// silently and the urgent ones read the same as the rest.
const CHANNEL_ID = 'default';

// The settings toggle, kept under the key ProfileScreen already wrote to so an
// existing preference survives this becoming real.
const PUSH_PREF_KEY = 'fixfly_push_notifications_enabled';

let registeredToken: string | null = null;
/** Alongside the token, so a language change re-registers instead of being skipped. */
let registeredLanguage: string | null = null;

/**
 * Where this session's token belongs. Technicians and dispatchers are Agents;
 * a company admin is a User, and the two are filed in the same table under
 * different owner types — so the endpoint, not a field in the body, is what
 * decides whose device this is.
 *
 * A venue manager (LocationAdmin) is left out deliberately: nothing on the
 * server sends to them, and asking for a permission we cannot act on is worse
 * than not asking.
 */
async function tokenEndpoint(): Promise<string | null> {
  const principal = await tokenStorage.getPrincipal();
  if (principal === 'agent') return '/api/agent/device-token';
  if (principal === 'manager') return '/api/admin/device-token';
  return null;
}

/** Notifications while the app is open: the in-app banner already covers chat. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Zadaci i poruke',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#0ACC6B',
  });
}

/**
 * Asks once, then registers. Called after sign-in, because the endpoint is
 * authenticated and the token belongs to whoever is signed in — registering
 * before login would file the device under nobody.
 */
export async function registerForPush(): Promise<void> {
  try {
    // An emulator has no push transport; asking produces an error that reads
    // like a real failure and is not one.
    if (!Device.isDevice) return;

    // Switched off in settings. Checked before the permission prompt, so
    // someone who turned notifications off is not asked for permission on
    // every sign-in.
    if (!(await isPushEnabled())) return;

    const endpoint = await tokenEndpoint();
    if (!endpoint) return;

    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;

    // Only ask if the system has not already answered. Re-prompting a person
    // who said no is how an app gets its notifications turned off in settings.
    if (!granted && existing.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return;

    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    const token = String(devicePushToken.data);
    if (!token) return;

    // A push is written on the server while this app is closed, so it cannot
    // be worded here — the language has to travel with the token.
    const language = i18n.language?.slice(0, 2) ?? null;

    // The same token every launch would be a write per app open for nothing —
    // but a changed language still has to reach the server, or notifications
    // keep arriving in the one it was registered with.
    if (token === registeredToken && language === registeredLanguage) return;

    await apiClient.post(endpoint, {
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      language,
    });
    registeredToken = token;
    registeredLanguage = language;
  } catch {
    // Push is an enhancement. It must never be the reason a sign-in fails.
  }
}

/**
 * Forgets the local token on sign-out so the next person to use this phone
 * does not inherit the previous one's registration in this process.
 *
 * The server row is deliberately left alone: the same device may sign back in,
 * and FCM prunes tokens it reports as gone. Removing it here would need an
 * authenticated call at the exact moment the session is being torn down.
 */
export function forgetPushRegistration(): void {
  registeredToken = null;
}

/** True once this device has a token filed under the signed-in account. */
export function isPushRegistered(): boolean {
  return registeredToken !== null;
}

/** The settings toggle. On unless the person has said otherwise. */
export async function isPushEnabled(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(PUSH_PREF_KEY);
  return stored === null ? true : stored === 'true';
}

/**
 * Turning notifications off has to reach the server. Dropping only the local
 * token would leave the row behind and the phone would keep buzzing — the
 * setting would look like it worked and would not have.
 *
 * Turning them back on re-registers, which is also what recovers a device
 * whose token was deleted while it was off.
 */
export async function setPushEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(PUSH_PREF_KEY, String(enabled));

  if (enabled) {
    await registerForPush();
    return;
  }

  try {
    const endpoint = await tokenEndpoint();
    if (!endpoint) return;

    // The cached token is empty on a fresh launch while the server row still
    // exists, so ask the device rather than skip the delete.
    let token = registeredToken;
    if (!token && Device.isDevice) {
      token = String((await Notifications.getDevicePushTokenAsync()).data);
    }
    if (!token) return;

    await apiClient.delete(endpoint, { data: { token } });
    registeredToken = null;
  } catch {
    // Best effort. The preference is already stored, so this device stops
    // registering either way; a stale row costs one undelivered push.
  }
}
