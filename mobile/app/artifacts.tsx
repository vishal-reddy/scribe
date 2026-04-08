import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useClaudeArtifacts } from '../lib/hooks/use-claude';

export default function ArtifactsScreen() {
  const router = useRouter();
  const { data, isLoading, refetch } = useClaudeArtifacts();

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-white">
        <ActivityIndicator size="large" color="#971B2F" />
      </View>
    );
  }

  const artifacts = data || [];

  return (
    <View className="flex-1 bg-white">
      <View className="p-4 border-b border-gray-200">
        <Text className="text-2xl font-bold">Artifacts</Text>
        <Text className="text-gray-600 mt-1">
          Documents from Claude's perspective
        </Text>
      </View>

      {artifacts.length === 0 ? (
        <View className="flex-1 justify-center items-center p-6">
          <Text className="text-gray-500 text-center">No artifacts yet</Text>
          <Text className="text-gray-400 text-sm mt-2 text-center">
            Claude will create artifacts as you interact
          </Text>
        </View>
      ) : (
        <FlatList
          data={artifacts}
          keyExtractor={(item) => item.artifactId}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor="#971B2F"
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              className="p-4 border-b border-gray-100"
              onPress={() => router.push(`/document/${item.artifactId}`)}
            >
              <View className="flex-row justify-between items-start">
                <View className="flex-1">
                  <Text className="font-semibold text-lg mb-1">
                    {item.title}
                  </Text>
                  <Text className="text-gray-600 text-sm mb-2" numberOfLines={2}>
                    {item.content.substring(0, 100)}...
                  </Text>
                  <View className="flex-row gap-4">
                    <Text className="text-xs text-gray-400">
                      Created: {new Date(item.createdAt).toLocaleDateString()}
                    </Text>
                    <Text className="text-xs text-gray-400">
                      Updated: {new Date(item.updatedAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <View className="flex-row gap-2 mt-2">
                    {item.author === 'claude' && (
                      <View className="bg-primary/10 px-2 py-1 rounded">
                        <Text className="text-xs text-primary">Created by Claude</Text>
                      </View>
                    )}
                    {item.lastEditor === 'claude' && (
                      <View className="bg-primary/10 px-2 py-1 rounded">
                        <Text className="text-xs text-primary">Edited by Claude</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Text className="text-gray-400">›</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}
