import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './RootNavigator';

/**
 * Navigation reachable from outside the component tree.
 *
 * A notification tap arrives at a module-level listener, not inside a screen,
 * so there is no `useNavigation` to reach for. Everything else in the app
 * navigates through hooks — this exists for that one caller.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
