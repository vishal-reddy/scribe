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
import { Ionicons } from '@expo/vector-icons';
import { useClaudeArtifacts } from '../lib/hooks/use-claude';

const BURGUNDY = '#971B2F';
const CREAM_BG = '#FAFAF7';

export default function ArtifactsScreen() {
  const router = useRouter();
  const { data, isLoading, refetch } = useClaudeArtifacts();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: CREAM_BG }}>
        <ActivityIndicator size="large" color={BURGUNDY} />
      </View>
    );
  }

  const artifacts = data || [];

  return (
    <View style={{ flex: 1, backgroundColor: CREAM_BG }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: '#1E1E1E' }}>Artifacts</Text>
        <Text style={{ fontSize: 14, color: '#9E9A96', marginTop: 4 }}>
          Created by Claude during your sessions
        </Text>
      </View>

      {artifacts.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Ionicons name="sparkles-outline" size={56} color="#D5D1CC" style={{ marginBottom: 16 }} />
          <Text style={{ fontSize: 18, fontWeight: '600', color: '#7A7672', textAlign: 'center' }}>
            No artifacts yet
          </Text>
          <Text style={{ fontSize: 14, color: '#B0ACA8', marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
            Claude will create artifacts as you{'\n'}collaborate on your writing
          </Text>
        </View>
      ) : (
        <FlatList
          data={artifacts}
          keyExtractor={(item) => item.artifactId}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor={BURGUNDY}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={{
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
              onPress={() => router.push(`/document/${item.artifactId}`)}
              activeOpacity={0.7}
            >
              <View style={{ flexDirection: 'row' }}>
                {/* Left accent bar */}
                <View style={{ width: 4, backgroundColor: BURGUNDY }} />

                <View style={{ flex: 1, padding: 16 }}>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: '#1E1E1E', marginBottom: 6 }}>
                    {item.title}
                  </Text>
                  <Text
                    style={{ fontSize: 14, color: '#7A7672', lineHeight: 20, marginBottom: 10 }}
                    numberOfLines={2}
                  >
                    {item.content.substring(0, 120)}...
                  </Text>

                  {/* Metadata row */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Ionicons name="time-outline" size={12} color="#B0ACA8" style={{ marginRight: 4 }} />
                    <Text style={{ fontSize: 12, color: '#B0ACA8', marginRight: 16 }}>
                      Created: {new Date(item.createdAt).toLocaleDateString()}
                    </Text>
                    <Ionicons name="refresh-outline" size={12} color="#B0ACA8" style={{ marginRight: 4 }} />
                    <Text style={{ fontSize: 12, color: '#B0ACA8' }}>
                      Updated: {new Date(item.updatedAt).toLocaleDateString()}
                    </Text>
                  </View>

                  {/* Tags */}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {item.author === 'claude' && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(151,27,47,0.08)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Ionicons name="sparkles" size={11} color={BURGUNDY} style={{ marginRight: 3 }} />
                        <Text style={{ fontSize: 11, color: BURGUNDY, fontWeight: '600' }}>Created by Claude</Text>
                      </View>
                    )}
                    {item.lastEditor === 'claude' && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(151,27,47,0.08)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Ionicons name="create-outline" size={11} color={BURGUNDY} style={{ marginRight: 3 }} />
                        <Text style={{ fontSize: 11, color: BURGUNDY, fontWeight: '600' }}>Edited by Claude</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Chevron */}
                <View style={{ justifyContent: 'center', paddingRight: 12 }}>
                  <Ionicons name="chevron-forward" size={18} color="#D5D1CC" />
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}
