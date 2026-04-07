import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useDocument } from '../../lib/hooks/use-documents';
import { useVersions, useRestoreVersion } from '../../lib/hooks/use-versions';
import DiffViewer from '../../components/DiffViewer';
import type { Version } from '../../lib/services/versions';

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;
  return new Date(dateStr).toLocaleDateString();
}

function CreatedByBadge({ createdBy }: { createdBy: string }) {
  const isClaude = createdBy?.toLowerCase().includes('claude');
  return (
    <View
      className={`px-2 py-0.5 rounded-full ${isClaude ? 'bg-purple-100' : 'bg-primary-50'}`}
    >
      <Text
        className={`text-xs font-medium ${isClaude ? 'text-purple-700' : 'text-primary'}`}
      >
        {isClaude ? '🤖 Claude' : '👤 User'}
      </Text>
    </View>
  );
}

export default function VersionHistoryScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const documentId = Array.isArray(id) ? id[0] : id;

  const { data: docData, isLoading: isDocLoading } = useDocument(documentId);
  const { data: versionData, isLoading: isVersionsLoading, refetch } = useVersions(documentId);
  const restoreMutation = useRestoreVersion(documentId);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [comparingId, setComparingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const versions = (versionData?.versions || []).sort(
    (a, b) => b.versionNumber - a.versionNumber
  );

  const currentMarkdown = docData?.markdown ?? '';

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const confirmRestore = (version: Version) => {
    const message = `Restore to version ${version.versionNumber}? This will replace the current document content.`;
    if (Platform.OS === 'web') {
      if (window.confirm(message)) {
        handleRestore(version);
      }
    } else {
      Alert.alert('Restore Version', message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', style: 'destructive', onPress: () => handleRestore(version) },
      ]);
    }
  };

  const handleRestore = async (version: Version) => {
    try {
      await restoreMutation.mutateAsync(version.markdown);
      const successMsg = `Restored to version ${version.versionNumber}`;
      if (Platform.OS === 'web') {
        alert(successMsg);
      } else {
        Alert.alert('Success', successMsg);
      }
    } catch {
      const errorMsg = 'Failed to restore version';
      if (Platform.OS === 'web') {
        alert(errorMsg);
      } else {
        Alert.alert('Error', errorMsg);
      }
    }
  };

  const toggleExpand = (versionId: string) => {
    setExpandedId((prev) => (prev === versionId ? null : versionId));
  };

  const toggleCompare = (versionId: string) => {
    setComparingId((prev) => (prev === versionId ? null : versionId));
  };

  if (isDocLoading || isVersionsLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-white">
        <ActivityIndicator size="large" color="#971B2F" />
        <Text className="mt-3 text-gray-500">Loading version history…</Text>
      </View>
    );
  }

  const renderVersion = ({ item }: { item: Version }) => {
    const isExpanded = expandedId === item.id;
    const isComparing = comparingId === item.id;

    return (
      <View className="mx-4 mb-3 border border-gray-200 rounded-xl overflow-hidden bg-white">
        {/* Version card header */}
        <TouchableOpacity
          className="p-4"
          onPress={() => toggleExpand(item.id)}
          activeOpacity={0.7}
        >
          <View className="flex-row justify-between items-center mb-2">
            <View className="flex-row items-center gap-2">
              <View className="bg-primary px-2.5 py-1 rounded-lg">
                <Text className="text-white text-xs font-bold">v{item.versionNumber}</Text>
              </View>
              <CreatedByBadge createdBy={item.createdBy} />
            </View>
            <Text className="text-xs text-gray-400">{relativeTime(item.createdAt)}</Text>
          </View>

          <Text className="text-xs text-gray-500">
            {new Date(item.createdAt).toLocaleString()}
          </Text>
        </TouchableOpacity>

        {/* Action buttons */}
        <View className="flex-row border-t border-gray-100 divide-x divide-gray-100">
          <TouchableOpacity
            className="flex-1 py-2.5 items-center"
            onPress={() => toggleExpand(item.id)}
          >
            <Text className="text-sm text-gray-600 font-medium">
              {isExpanded ? 'Hide' : 'Preview'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 py-2.5 items-center"
            onPress={() => toggleCompare(item.id)}
          >
            <Text className="text-sm text-blue-600 font-medium">
              {isComparing ? 'Hide Diff' : 'Compare'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 py-2.5 items-center"
            onPress={() => confirmRestore(item)}
            disabled={restoreMutation.isPending}
          >
            <Text className="text-sm text-primary font-medium">
              {restoreMutation.isPending ? 'Restoring…' : 'Restore'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Expanded markdown preview */}
        {isExpanded && (
          <View className="border-t border-gray-100 p-4 bg-gray-50 max-h-64">
            <Text className="font-mono text-xs text-gray-700">
              {item.markdown || '(empty)'}
            </Text>
          </View>
        )}

        {/* Diff view */}
        {isComparing && (
          <View className="border-t border-gray-100 max-h-80">
            <View className="px-4 py-2 bg-gray-50">
              <Text className="text-xs text-gray-500 font-medium">
                Comparing v{item.versionNumber} → Current
              </Text>
            </View>
            <DiffViewer oldText={item.markdown} newText={currentMarkdown} />
          </View>
        )}
      </View>
    );
  };

  return (
    <View className="flex-1 bg-gray-50">
      {/* Header */}
      <View className="bg-white p-4 border-b border-gray-200">
        <View className="flex-row items-center gap-3">
          <TouchableOpacity onPress={() => router.back()}>
            <Text className="text-primary text-base font-medium">← Back</Text>
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-lg font-bold" numberOfLines={1}>
              {docData?.title || 'Untitled'}
            </Text>
            <Text className="text-xs text-gray-500">
              {versions.length} version{versions.length !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>
      </View>

      {/* Version list */}
      {versions.length === 0 ? (
        <View className="flex-1 justify-center items-center p-6">
          <Text className="text-4xl mb-3">📄</Text>
          <Text className="text-gray-500 text-base font-medium mb-1">No versions yet</Text>
          <Text className="text-gray-400 text-sm text-center">
            Versions are created when you save snapshots of your document.
          </Text>
        </View>
      ) : (
        <FlatList
          data={versions}
          keyExtractor={(item) => item.id}
          renderItem={renderVersion}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#971B2F"
              colors={['#971B2F']}
            />
          }
        />
      )}
    </View>
  );
}
