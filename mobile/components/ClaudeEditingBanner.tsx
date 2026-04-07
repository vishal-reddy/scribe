import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, TouchableOpacity } from 'react-native';

interface ClaudeEditingBannerProps {
  visible: boolean;
  onDismiss: () => void;
}

export default function ClaudeEditingBanner({ visible, onDismiss }: ClaudeEditingBannerProps) {
  const slideAnim = useRef(new Animated.Value(-60)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) {
      // Slide in
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();

      // Pulse loop
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.6,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();

      return () => pulse.stop();
    } else {
      // Slide out
      Animated.timing(slideAnim, {
        toValue: -60,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim, pulseAnim]);

  if (!visible) return null;

  return (
    <Animated.View
      style={{
        transform: [{ translateY: slideAnim }],
        backgroundColor: '#625B71',
        paddingHorizontal: 16,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Animated.View style={{ flexDirection: 'row', alignItems: 'center', opacity: pulseAnim }}>
        <Text style={{ fontSize: 14, marginRight: 6 }}>✨</Text>
        <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>
          Claude is editing...
        </Text>
      </Animated.View>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={{ color: '#CCC2DC', fontSize: 16, fontWeight: '600' }}>✕</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}
