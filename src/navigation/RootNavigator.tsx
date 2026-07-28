import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { DarkTheme, NavigationContainer, Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { LockScreen } from '../screens/LockScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { ForgotPinScreen } from '../screens/ForgotPinScreen';
import { MainTabs } from './MainTabs';
import { colors } from '../theme/tokens';

export type RootStackParamList = {
  Login: undefined;
  ForgotPassword: undefined;
  Lock: undefined;
  ForgotPin: undefined;
  PinSetup: undefined;
  Main: undefined; // MainTabs — Tasks/Chat/Profile, always-visible bottom bar
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Matches our exact dark palette (not React Navigation's stock DarkTheme
// grays) so the brief background a navigator shows during a screen
// transition — before the destination screen's own View paints — is the
// right shade of dark instead of flashing a mismatched color.
const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.surface,
    card: colors.card,
    text: colors.forest,
    border: colors.border,
    primary: colors.green,
  },
};

export function RootNavigator() {
  const { status, logout, unlock, completePinSetup, skipPinSetup, resetPin } = useAuth();

  // Recovery detours are local flags rather than stack routes: `status` decides
  // which screen the stack renders, and pushing a route on top of that would
  // fight it — a status change mid-recovery would leave a stranded screen.
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const [recoveringPin, setRecoveringPin] = useState(false);

  if (status === 'checking') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface }}>
        <ActivityIndicator color={colors.green} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {status === 'signedIn' ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : status === 'locked' ? (
          recoveringPin ? (
            <Stack.Screen name="ForgotPin">
              {() => (
                <ForgotPinScreen
                  onVerified={async () => {
                    setRecoveringPin(false);
                    // Session survives — straight to choosing a new PIN.
                    await resetPin();
                  }}
                  onCancel={() => setRecoveringPin(false)}
                />
              )}
            </Stack.Screen>
          ) : (
            <Stack.Screen name="Lock">
              {() => (
                <LockScreen
                  mode="unlock"
                  onSuccess={unlock}
                  onUseFullLogin={logout}
                  onForgotPin={() => setRecoveringPin(true)}
                />
              )}
            </Stack.Screen>
          )
        ) : status === 'pinSetup' ? (
          <Stack.Screen name="PinSetup">
            {() => <LockScreen mode="setup" onSuccess={completePinSetup} onSkip={skipPinSetup} />}
          </Stack.Screen>
        ) : recoveringPassword ? (
          <Stack.Screen name="ForgotPassword">
            {() => (
              <ForgotPasswordScreen
                onDone={() => setRecoveringPassword(false)}
                onCancel={() => setRecoveringPassword(false)}
              />
            )}
          </Stack.Screen>
        ) : (
          <Stack.Screen name="Login">
            {() => <LoginScreen onForgotPassword={() => setRecoveringPassword(true)} />}
          </Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
