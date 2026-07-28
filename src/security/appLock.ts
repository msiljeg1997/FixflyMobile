import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';

// Quick unlock for daily field use: a technician opens the app dozens of
// times a shift and shouldn't retype a full password each time. The real
// session is still the agent JWT in SecureStore — this layer only gates
// access to an already-authenticated session on THIS device, it is not a
// second authentication factor against the server.
//
// PIN is stored as a salted SHA-256 hash in the OS keychain/keystore, never
// in plaintext. Biometrics never touch our storage at all — the OS decides.

const PIN_HASH_KEY = 'fixfly_pin_hash';
const PIN_SALT_KEY = 'fixfly_pin_salt';
const BIOMETRIC_PREF_KEY = 'fixfly_biometric_enabled';
// Records that the agent made a choice about the lock, which "is a PIN set?"
// cannot express: without it, declining the setup prompt was forgotten at the
// next login and the app asked again, forever.
const LOCK_CHOICE_KEY = 'fixfly_lock_choice'; // 'on' | 'off' | absent = never asked

async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

export const appLock = {
  async isPinSet(): Promise<boolean> {
    return (await SecureStore.getItemAsync(PIN_HASH_KEY)) !== null;
  },

  async setPin(pin: string): Promise<void> {
    const salt = Array.from(await Crypto.getRandomBytesAsync(16))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await SecureStore.setItemAsync(PIN_SALT_KEY, salt);
    await SecureStore.setItemAsync(PIN_HASH_KEY, await hashPin(pin, salt));
    await SecureStore.setItemAsync(LOCK_CHOICE_KEY, 'on');
  },

  /**
   * Has the agent decided about the lock yet? Only an undecided device gets
   * the setup prompt after login — "no thanks" is an answer and must stick.
   */
  async hasChosen(): Promise<boolean> {
    return (await SecureStore.getItemAsync(LOCK_CHOICE_KEY)) !== null;
  },

  /** True only when a PIN is set AND the lock is switched on. */
  async isLockEnabled(): Promise<boolean> {
    const [choice, pinSet] = await Promise.all([
      SecureStore.getItemAsync(LOCK_CHOICE_KEY),
      SecureStore.getItemAsync(PIN_HASH_KEY),
    ]);
    return choice === 'on' && pinSet !== null;
  },

  /**
   * Turning the lock off drops the PIN outright rather than parking it —
   * a hash sitting in the keychain for a lock nobody uses is stored secret
   * with no purpose, and turning the lock back on asks for a new PIN anyway.
   */
  async disableLock(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(PIN_HASH_KEY),
      SecureStore.deleteItemAsync(PIN_SALT_KEY),
      SecureStore.deleteItemAsync(BIOMETRIC_PREF_KEY),
    ]);
    await SecureStore.setItemAsync(LOCK_CHOICE_KEY, 'off');
  },

  /** Records "asked, declined" so login stops offering it. */
  async declineLock(): Promise<void> {
    await SecureStore.setItemAsync(LOCK_CHOICE_KEY, 'off');
  },

  async verifyPin(pin: string): Promise<boolean> {
    const [hash, salt] = await Promise.all([
      SecureStore.getItemAsync(PIN_HASH_KEY),
      SecureStore.getItemAsync(PIN_SALT_KEY),
    ]);
    if (!hash || !salt) return false;
    return (await hashPin(pin, salt)) === hash;
  },

  /** Full reset on logout — including the choice, since the next person to
   *  sign in on this device gets to make their own. */
  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(PIN_HASH_KEY),
      SecureStore.deleteItemAsync(PIN_SALT_KEY),
      SecureStore.deleteItemAsync(BIOMETRIC_PREF_KEY),
      SecureStore.deleteItemAsync(LOCK_CHOICE_KEY),
    ]);
  },

  /** Hardware present AND the user has actually enrolled a face/finger. */
  async isBiometricAvailable(): Promise<boolean> {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && isEnrolled;
  },

  async isBiometricEnabled(): Promise<boolean> {
    return (await SecureStore.getItemAsync(BIOMETRIC_PREF_KEY)) === 'true';
  },

  async setBiometricEnabled(enabled: boolean): Promise<void> {
    await SecureStore.setItemAsync(BIOMETRIC_PREF_KEY, String(enabled));
  },

  /**
   * Returns true only on a successful face/finger match. `fallbackLabel: ''`
   * suppresses the OS "Enter Password" fallback — our own PIN screen is the
   * fallback, and the device passcode would unlock nothing useful here.
   */
  async authenticateBiometric(promptMessage: string): Promise<boolean> {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: '',
      disableDeviceFallback: true,
      cancelLabel: undefined,
    });
    return result.success;
  },
};
