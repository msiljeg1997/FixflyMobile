import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnread } from '../context/UnreadContext';
import { getInitials } from '../utils/format';
import { colors, radius, spacing, tint } from '../theme/tokens';

/**
 * In-app notification for a chat message that arrives while the app is open.
 * This is the in-app half of notifications; the OS-level push half only works
 * in a native build (Expo Go can't hold an FCM token), so this is what a
 * technician actually sees today when a message lands.
 */
export function ChatBanner() {
  const { banner, dismissBanner } = useUnread();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  if (!banner) return null;

  const { ticketId, message } = banner;

  const open = () => {
    dismissBanner();
    // The banner renders as a sibling of Tab.Navigator, so its navigation
    // context is the ROOT stack (Login/Lock/Main) — not the tabs. The target
    // has to be addressed all the way down: Main → ChatTab → Chat, otherwise
    // react-navigation can't resolve 'ChatTab' and drops the action.
    navigation.navigate('Main', {
      screen: 'ChatTab',
      params: { screen: 'Chat', params: { ticketId } },
    });
  };

  return (
    <View style={[styles.wrap, { top: insets.top + spacing.xs }]} pointerEvents="box-none">
      <TouchableOpacity style={styles.banner} activeOpacity={0.85} onPress={open}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(message.senderName || '?')}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sender} numberOfLines={1}>
            {message.senderName}
          </Text>
          <Text style={styles.preview} numberOfLines={1}>
            {message.text || '📷'}
          </Text>
        </View>
        <TouchableOpacity onPress={dismissBanner} hitSlop={10}>
          <Text style={styles.close}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.md, right: spacing.md, zIndex: 1000 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: tint(colors.green, '2A'),
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 12, fontWeight: '700', color: colors.forest },
  sender: { fontSize: 13, fontWeight: '700', color: colors.forest },
  preview: { fontSize: 13, color: colors.muted, marginTop: 1 },
  close: { color: colors.muted, fontSize: 15, fontWeight: '700', paddingHorizontal: 4 },
});
