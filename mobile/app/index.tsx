import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/auth-context';
import { useDocuments, useCreateDocument, useDeleteDocument } from '../lib/hooks/use-documents';
import DocumentCard from '../components/DocumentCard';

const CREAM_BG = '#FAFAF7';
const BURGUNDY = '#971B2F';

export default function HomeScreen() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const { data: docs = [], isLoading, error, refetch } = useDocuments();
  const createDoc = useCreateDocument();
  const deleteDoc = useDeleteDocument();

  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/auth/login');
    }
  }, [isAuthenticated, authLoading]);

  const handleCreateDocument = async () => {
    const title = newDocTitle.trim();
    if (!title) {
      Alert.alert('Error', 'Please enter a document title');
      return;
    }
    try {
      const doc = await createDoc.mutateAsync({
        title,
        markdown: `# ${title}\n\nStart writing...`,
      });
      setNewDocTitle('');
      setShowCreateModal(false);
      router.push(`/document/${doc.id}`);
    } catch {
      Alert.alert('Error', 'Failed to create document');
    }
  };

  const handleDeleteDocument = (id: string, title: string) => {
    const doDelete = async () => {
      try {
        await deleteDoc.mutateAsync(id);
      } catch {
        Alert.alert('Error', 'Failed to delete document');
      }
    };

    if (Platform.OS === 'web') {
      if (confirm(`Delete "${title}"?`)) doDelete();
    } else {
      Alert.alert('Delete Document', `Are you sure you want to delete "${title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const filteredDocuments = docs.filter((doc) =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const docCount = filteredDocuments.length;

  if (authLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: CREAM_BG }}>
        <ActivityIndicator size="large" color={BURGUNDY} />
      </View>
    );
  }

  if (isLoading && docs.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: CREAM_BG }}>
        <ActivityIndicator size="large" color={BURGUNDY} />
        <Text style={{ marginTop: 16, color: '#7A7672', fontSize: 14 }}>Loading documents...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: CREAM_BG, padding: 24 }}>
        <Ionicons name="cloud-offline-outline" size={56} color="#D5D1CC" style={{ marginBottom: 16 }} />
        <Text style={{ fontSize: 18, fontWeight: '600', color: '#7A7672', textAlign: 'center' }}>
          Failed to load documents
        </Text>
        <Text style={{ fontSize: 13, color: '#B0ACA8', marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
          {error instanceof Error ? error.message : 'Unknown error'}
        </Text>
        <TouchableOpacity
          style={{ marginTop: 20, backgroundColor: BURGUNDY, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 }}
          onPress={() => refetch()}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: CREAM_BG }}>
      {/* Header area */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <Text style={{ fontSize: 24, fontWeight: '700', color: '#1E1E1E' }}>Your Documents</Text>
          <Text style={{ fontSize: 13, color: '#9E9A96' }}>{docCount} {docCount === 1 ? 'document' : 'documents'}</Text>
        </View>

        {/* Search */}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0EDE8', borderRadius: 12, paddingHorizontal: 12 }}>
          <Ionicons name="search-outline" size={18} color="#9E9A96" />
          <TextInput
            style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 8, fontSize: 15, color: '#1E1E1E' }}
            placeholder="Search documents..."
            placeholderTextColor="#B0ACA8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color="#B0ACA8" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Document List */}
      {filteredDocuments.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Ionicons
            name={searchQuery ? 'search-outline' : 'document-text-outline'}
            size={56}
            color="#D5D1CC"
            style={{ marginBottom: 16 }}
          />
          <Text style={{ fontSize: 18, fontWeight: '600', color: '#7A7672', textAlign: 'center' }}>
            {searchQuery ? 'No documents found' : 'No documents yet'}
          </Text>
          <Text style={{ fontSize: 14, color: '#B0ACA8', marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
            {searchQuery ? 'Try a different search term' : 'Tap the + button to create\nyour first masterpiece'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredDocuments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => refetch()} tintColor={BURGUNDY} />}
          renderItem={({ item }) => (
            <DocumentCard
              document={item}
              onPress={() => router.push(`/document/${item.id}`)}
              onLongPress={() => handleDeleteDocument(item.id, item.title)}
            />
          )}
        />
      )}

      {/* Floating Action Button */}
      <TouchableOpacity
        style={{
          position: 'absolute', bottom: 24, right: 20, width: 56, height: 56, borderRadius: 28,
          backgroundColor: BURGUNDY, justifyContent: 'center', alignItems: 'center',
          shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
        }}
        onPress={() => setShowCreateModal(true)}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Create modal */}
      <Modal visible={showCreateModal} transparent animationType="slide">
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
          activeOpacity={1}
          onPress={() => { setShowCreateModal(false); setNewDocTitle(''); }}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={{ backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 }}>
              <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#E0DCD7', marginBottom: 20 }} />
              <Text style={{ fontSize: 20, fontWeight: '700', color: '#1E1E1E', marginBottom: 16 }}>New Document</Text>
              <TextInput
                style={{ backgroundColor: '#F7F5F2', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#1E1E1E', marginBottom: 20 }}
                placeholder="Document title"
                placeholderTextColor="#A8A4A0"
                value={newDocTitle}
                onChangeText={setNewDocTitle}
                autoFocus
              />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: '#F0EDE8', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
                  onPress={() => { setShowCreateModal(false); setNewDocTitle(''); }}
                >
                  <Text style={{ fontWeight: '600', color: '#5A5652' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: BURGUNDY, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: createDoc.isPending ? 0.6 : 1 }}
                  onPress={handleCreateDocument}
                  disabled={createDoc.isPending}
                >
                  <Text style={{ fontWeight: '600', color: '#FFFFFF' }}>{createDoc.isPending ? 'Creating...' : 'Create'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
