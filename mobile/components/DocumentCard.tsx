import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Document } from '../lib/services/documents';

interface DocumentCardProps {
  document: Document;
  onPress: () => void;
  onLongPress: () => void;
  isClaudeEditing?: boolean;
}

const BURGUNDY = '#971B2F';

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
          Animated.timing(pulseAnim, { toValue: 0.97, duration: 800, useNativeDriver: true }),
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
  const previewText = document.markdown
    .replace(/^#+\s+/gm, '')
    .substring(0, 120);

  return (
    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
      <TouchableOpacity
        onPress={onPress}
        onLongPress={onLongPress}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row',
          backgroundColor: '#FFFFFF',
          borderRadius: 14,
          marginBottom: 12,
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
          elevation: 3,
        }}
      >
        {/* Left accent bar for claude-edited docs */}
        {(isClaudeEdited || isClaudeEditing) && (
          <View
            style={{
              width: 4,
              backgroundColor: isClaudeEditing ? '#625B71' : BURGUNDY,
            }}
          />
        )}

        <View style={{ flex: 1, padding: 16 }}>
          {/* Title row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text
              style={{ flex: 1, fontSize: 17, fontWeight: '700', color: '#1E1E1E' }}
              numberOfLines={1}
            >
              {document.title}
            </Text>
            {isClaudeEditing && (
              <View
                style={{
                  backgroundColor: '#625B71',
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 12,
                  marginLeft: 8,
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '600' }}>
                  ✨ Editing…
                </Text>
              </View>
            )}
          </View>

          {/* Preview text */}
          <Text
            style={{ fontSize: 14, color: '#7A7672', lineHeight: 20, marginBottom: 10 }}
            numberOfLines={2}
          >
            {previewText}...
          </Text>

          {/* Metadata row */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="time-outline" size={12} color="#B0ACA8" style={{ marginRight: 4 }} />
              <Text style={{ fontSize: 12, color: '#B0ACA8' }}>
                {new Date(document.updatedAt).toLocaleDateString()}
              </Text>
            </View>

            {isClaudeEdited && !isClaudeEditing && (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(151,27,47,0.08)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Ionicons name="sparkles" size={11} color={BURGUNDY} style={{ marginRight: 3 }} />
                <Text style={{ fontSize: 11, color: BURGUNDY, fontWeight: '600' }}>
                  Claude
                </Text>
              </View>
            )}

            {!isClaudeEdited && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="person-outline" size={12} color="#B0ACA8" style={{ marginRight: 4 }} />
                <Text style={{ fontSize: 12, color: '#B0ACA8' }}>You</Text>
              </View>
            )}
          </View>
        </View>

        {/* Chevron */}
        <View style={{ justifyContent: 'center', paddingRight: 12 }}>
          <Ionicons name="chevron-forward" size={18} color="#D5D1CC" />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}
