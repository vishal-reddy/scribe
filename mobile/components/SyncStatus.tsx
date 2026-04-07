import React, { useEffect, useRef } from 'react';
import { View, Text, Animated } from 'react-native';

type ConnectionState = 'connected' | 'syncing' | 'disconnected';

interface SyncStatusProps {
  isSynced: boolean;
  lastSynced?: Date;
  lastEditor?: 'user' | 'claude' | null;
  collaboratorCount?: number;
}

function getConnectionState(isSynced: boolean): ConnectionState {
  // `isSynced` maps to WebSocket connected state.
  // The "syncing" state is inferred when connected and a save is in-flight,
  // but for simplicity we treat !isSynced as disconnected and isSynced as connected.
  return isSynced ? 'connected' : 'disconnected';
}

const STATUS_CONFIG: Record<ConnectionState, { dot: string; label: string }> = {
  connected: { dot: '🟢', label: 'Connected' },
  syncing: { dot: '🟡', label: 'Syncing' },
  disconnected: { dot: '🔴', label: 'Disconnected' },
};

export default function SyncStatus({
  isSynced,
  lastSynced,
  lastEditor,
  collaboratorCount = 1,
}: SyncStatusProps) {
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Animate on state change
  useEffect(() => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0.4, duration: 150, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  }, [isSynced, lastEditor, fadeAnim]);

  const state = getConnectionState(isSynced);
  const { dot, label } = STATUS_CONFIG[state];

  const editorLabel =
    lastEditor === 'claude'
      ? 'Last edited by Claude'
      : lastEditor === 'user'
        ? 'Last edited by you'
        : null;

  return (
    <Animated.View style={{ opacity: fadeAnim, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={{ fontSize: 8 }}>{dot}</Text>
      <Text className="text-xs text-gray-500">{label}</Text>
      {editorLabel && (
        <Text className="text-xs text-gray-400"> • {editorLabel}</Text>
      )}
      {collaboratorCount > 1 && (
        <Text className="text-xs text-secondary"> • {collaboratorCount} active</Text>
      )}
      {lastSynced && (
        <Text className="text-xs text-gray-400"> • {lastSynced.toLocaleTimeString()}</Text>
      )}
    </Animated.View>
  );
}
