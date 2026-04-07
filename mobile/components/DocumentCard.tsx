import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import type { Document } from '../lib/services/documents';

interface DocumentCardProps {
  document: Document;
  onPress: () => void;
  onLongPress: () => void;
  isClaudeEditing?: boolean;
}

export default function DocumentCard({
  document,
  onPress,
  onLongPress,
  isClaudeEditing = false,
}: DocumentCardProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isClaudeEditing) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.92, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isClaudeEditing, pulseAnim]);

  const isClaudeEdited = document.lastEditedBy === 'claude';
  const borderColor = isClaudeEditing
    ? '#625B71'
    : isClaudeEdited
      ? '#CCC2DC'
      : '#E5E7EB';

  return (
    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
      <TouchableOpacity
        className="bg-white p-4 mb-2 rounded-lg"
        style={{ borderWidth: 1, borderColor }}
        onPress={onPress}
        onLongPress={onLongPress}
      >
        <View className="flex-row items-center mb-2">
          <Text className="font-bold text-lg flex-1" numberOfLines={1}>
            {document.title}
          </Text>
          {isClaudeEditing && (
            <View
              style={{ backgroundColor: '#625B71' }}
              className="px-2 py-0.5 rounded-full ml-2"
            >
              <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '600' }}>
                ✨ Editing…
              </Text>
            </View>
          )}
        </View>

        <Text className="text-gray-600 mb-2" numberOfLines={2}>
          {document.markdown.substring(0, 100)}...
        </Text>

        <View className="flex-row justify-between items-center">
          <Text className="text-xs text-gray-400">
            {new Date(document.updatedAt).toLocaleDateString()}
          </Text>

          {isClaudeEdited && !isClaudeEditing && (
            <View className="flex-row items-center" style={{ backgroundColor: '#F3E8FF', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ fontSize: 10 }}>✨</Text>
              <Text style={{ fontSize: 11, color: '#625B71', fontWeight: '600', marginLeft: 2 }}>
                Claude
              </Text>
            </View>
          )}

          {!isClaudeEdited && (
            <Text className="text-xs text-gray-400">You</Text>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}
