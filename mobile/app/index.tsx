import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/auth-context';
import {
  useDocuments,
  useCreateDocument,
  useDeleteDocument,
} from '../lib/hooks/use-documents';
import DocumentCard from '../components/DocumentCard';

export default function HomeScreen() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');

  // Fetch documents
  const { data, isLoading, refetch } = useDocuments();
  const createMutation = useCreateDocument();
  const deleteMutation = useDeleteDocument();

  // Redirect if not authenticated
  React.useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/auth/login');
    }
  }, [isAuthenticated, authLoading]);

  const handleCreateDocument = async () => {
    if (!newDocTitle.trim()) {
      Alert.alert('Error', 'Please enter a document title');
      return;
    }

    try {
      const doc = await createMutation.mutateAsync({
        title: newDocTitle,
        markdown: '# ' + newDocTitle + '\n\nStart writing...',
      });
      setNewDocTitle('');
      setShowCreateModal(false);
      router.push(`/document/${doc.id}`);
    } catch (error) {
      Alert.alert('Error', 'Failed to create document');
    }
  };

  const handleDeleteDocument = (id: string, title: string) => {
    Alert.alert(
      'Delete Document',
      `Are you sure you want to delete "${title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(id),
        },
      ]
    );
  };

  const filteredDocuments = data?.filter((doc) =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  if (authLoading || isLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-white">
        <ActivityIndicator size="large" color="#971B2F" />
        <Text className="mt-4 text-gray-600">Loading...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      {/* Header */}
      <View className="p-4 border-b border-gray-200">
        <Text className="text-2xl font-bold mb-4">Documents</Text>
        
        {/* Search */}
        <TextInput
          className="bg-gray-100 rounded-lg px-4 py-3 mb-4"
          placeholder="Search documents..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />

        {/* Create Button */}
        <TouchableOpacity
          className="bg-primary rounded-lg py-3"
          onPress={() => setShowCreateModal(true)}
        >
          <Text className="text-white text-center font-semibold">
            + New Document
          </Text>
        </TouchableOpacity>
      </View>

      {/* Document List */}
      {filteredDocuments.length === 0 ? (
        <View className="flex-1 justify-center items-center p-6">
          <Text className="text-gray-500 text-center">
            {searchQuery ? 'No documents found' : 'No documents yet'}
          </Text>
          <Text className="text-gray-400 text-sm mt-2 text-center">
            {searchQuery ? 'Try a different search' : 'Create your first document to get started'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredDocuments}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor="#971B2F"
            />
          }
          renderItem={({ item }) => (
            <DocumentCard
              document={item}
              onPress={() => router.push(`/document/${item.id}`)}
              onLongPress={() => handleDeleteDocument(item.id, item.title)}
            />
          )}
        />
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <View className="absolute inset-0 bg-black/50 justify-center items-center">
          <View className="bg-white rounded-lg p-6 w-80">
            <Text className="text-xl font-bold mb-4">New Document</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 mb-4"
              placeholder="Document title"
              value={newDocTitle}
              onChangeText={setNewDocTitle}
              autoFocus
            />
            <View className="flex-row gap-2">
              <TouchableOpacity
                className="flex-1 bg-gray-200 rounded-lg py-3"
                onPress={() => {
                  setShowCreateModal(false);
                  setNewDocTitle('');
                }}
              >
                <Text className="text-center font-semibold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-primary rounded-lg py-3"
                onPress={handleCreateDocument}
                disabled={createMutation.isPending}
              >
                <Text className="text-white text-center font-semibold">
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
