import React from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme/tokens';

interface Props {
  uri: string | null;
  onClose: () => void;
}

// Tap any photo in the app to see it full-bleed — the standard mobile
// pattern for "this thumbnail is evidence, let me actually look at it"
// (guest fault photos, resolution proof). Tap anywhere to dismiss.
export function ImageViewerModal({ uri, onClose }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={uri !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {uri && <Image source={{ uri }} style={styles.image} resizeMode="contain" />}
        <View style={[styles.closeButton, { top: insets.top + spacing.sm }]}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', height: '80%' },
  closeButton: {
    position: 'absolute',
    right: spacing.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: { color: colors.forest, fontSize: 16, fontWeight: '700' },
});
