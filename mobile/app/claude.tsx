import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useClaudePrompt } from '../lib/hooks/use-claude';
import { useDocument, useUpdateDocument } from '../lib/hooks/use-documents';
import type { Message } from '../lib/types';

const BURGUNDY = '#971B2F';
const CREAM_BG = '#FAFAF7';

// ─── Quick action chips for document context ──────────────────────────────

const DOCUMENT_QUICK_ACTIONS = [
  { label: 'Expand this section', prompt: 'Expand this section with more detail and elaboration.' },
  { label: 'Simplify', prompt: 'Simplify the language of this document to make it clearer and easier to understand.' },
  { label: 'Add examples', prompt: 'Add concrete examples to illustrate the key points in this document.' },
  { label: 'Create outline', prompt: 'Create a structured outline from this document.' },
  { label: 'Fix grammar', prompt: 'Fix all grammar and spelling errors in this document.' },
  { label: 'Summarize', prompt: 'Provide a concise summary of this document.' },
];

export default function ClaudeChatScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const documentId = params.documentId as string | undefined;

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [showDocPreview, setShowDocPreview] = useState(false);
  const [contextDismissed, setContextDismissed] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const claudePrompt = useClaudePrompt();

  // Fetch document data when a documentId is present
  const { data: docData } = useDocument(documentId ?? '');
  const updateDocument = useUpdateDocument(documentId ?? '');

  const hasDocumentContext = !!documentId && !contextDismissed;

  // ── Send message ────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? inputText).trim();
      if (!text || claudePrompt.isPending) return;

      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: text,
        timestamp: new Date(),
        documentId,
      };

      setMessages((prev) => [...prev, userMessage]);
      setInputText('');

      try {
        const response = await claudePrompt.mutateAsync({
          prompt: text,
          documentId,
        });

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: response,
          timestamp: new Date(),
          documentId,
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (error: any) {
        console.error('Error sending message:', error);
        Alert.alert('Error', error.message || 'Failed to get response from Claude');

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Sorry, I encountered an error. Please try again.',
            timestamp: new Date(),
          },
        ]);
      }
    },
    [inputText, claudePrompt, documentId],
  );

  // ── Apply Claude response to document ───────────────────────────────────

  const handleApply = useCallback(
    async (content: string) => {
      if (!documentId) return;
      try {
        await updateDocument.mutateAsync({ markdown: content });
        if (Platform.OS === 'web') {
          alert('Applied to document');
        } else {
          Alert.alert('Success', 'Content applied to document');
        }
      } catch (err: any) {
        console.error('Apply error:', err);
        if (Platform.OS === 'web') {
          alert('Failed to apply content');
        } else {
          Alert.alert('Error', 'Failed to apply content to document');
        }
      }
    },
    [documentId, updateDocument],
  );

  // ── Render a single message ─────────────────────────────────────────────

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';

    return (
      <View style={{ marginBottom: 16, alignItems: isUser ? 'flex-end' : 'flex-start' }}>
        {/* Claude label */}
        {!isUser && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, marginLeft: 4 }}>
            <Ionicons name="sparkles" size={11} color={BURGUNDY} style={{ marginRight: 4 }} />
            <Text style={{ fontSize: 11, fontWeight: '600', color: BURGUNDY }}>Claude</Text>
          </View>
        )}
        <View
          style={{
            maxWidth: '80%',
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderRadius: 18,
            borderBottomRightRadius: isUser ? 4 : 18,
            borderBottomLeftRadius: isUser ? 18 : 4,
            backgroundColor: isUser ? BURGUNDY : '#F0EDE8',
          }}
        >
          <Text style={{ color: isUser ? '#FFFFFF' : '#1E1E1E', fontSize: 15, lineHeight: 21 }}>
            {item.content}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8, paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 11, color: '#B0ACA8' }}>{item.timestamp.toLocaleTimeString()}</Text>
          {item.role === 'assistant' && documentId && (
            <TouchableOpacity
              style={{
                backgroundColor: 'rgba(151,27,47,0.08)',
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 6,
              }}
              onPress={() => handleApply(item.content)}
              disabled={updateDocument.isPending}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: BURGUNDY }}>
                {updateDocument.isPending ? 'Applying...' : 'Apply to document'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  // ── Main render ─────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: CREAM_BG }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Document context banner */}
      {hasDocumentContext && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(151,27,47,0.06)',
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderBottomWidth: 0.5,
            borderBottomColor: '#E5E1DC',
          }}
        >
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ fontSize: 10, color: BURGUNDY, fontWeight: '600', letterSpacing: 0.5 }}>EDITING</Text>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#1E1E1E' }} numberOfLines={1}>
              {docData?.title || 'Untitled Document'}
            </Text>
          </View>
          <TouchableOpacity
            style={{
              backgroundColor: 'rgba(151,27,47,0.1)',
              borderRadius: 12,
              width: 24,
              height: 24,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onPress={() => setContextDismissed(true)}
            accessibilityLabel="Dismiss document context"
          >
            <Ionicons name="close" size={14} color={BURGUNDY} />
          </TouchableOpacity>
        </View>
      )}

      {/* Message list or empty state */}
      {messages.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Ionicons name="chatbubble-ellipses-outline" size={56} color="#D5D1CC" style={{ marginBottom: 16 }} />
          <Text style={{ fontSize: 22, fontWeight: '700', color: '#1E1E1E', marginBottom: 6 }}>Chat with Claude</Text>
          <Text style={{ fontSize: 15, color: '#7A7672', textAlign: 'center', lineHeight: 22 }}>
            Your scholarly writing partner — ask for help{'\n'}creating, editing, or refining your work
          </Text>
          {hasDocumentContext && (
            <View style={{ marginTop: 16, backgroundColor: 'rgba(151,27,47,0.06)', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
              <Text style={{ fontSize: 13, color: '#7A7672', textAlign: 'center' }}>
                Claude has access to your current document and can make edits
              </Text>
            </View>
          )}
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          style={{ flex: 1 }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />
      )}

      {/* Document preview (collapsible) */}
      {hasDocumentContext && docData?.markdown && (
        <View style={{ borderTopWidth: 0.5, borderTopColor: '#E5E1DC' }}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#F7F5F2' }}
            onPress={() => setShowDocPreview((v) => !v)}
          >
            <Text style={{ fontSize: 12, fontWeight: '500', color: '#9E9A96' }}>
              Document preview
            </Text>
            <Ionicons name={showDocPreview ? 'chevron-up' : 'chevron-down'} size={14} color="#9E9A96" />
          </TouchableOpacity>
          {showDocPreview && (
            <ScrollView style={{ maxHeight: 128, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#F7F5F2' }}>
              <Text style={{ fontSize: 12, color: '#7A7672', lineHeight: 18 }} numberOfLines={20}>
                {docData.markdown}
              </Text>
            </ScrollView>
          )}
        </View>
      )}

      {/* Quick action chips — always visible when document context is active */}
      {hasDocumentContext && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
          keyboardShouldPersistTaps="always"
          style={{ borderTopWidth: 0.5, borderTopColor: '#E5E1DC' }}
        >
          {DOCUMENT_QUICK_ACTIONS.map((action) => (
            <TouchableOpacity
              key={action.label}
              style={{
                backgroundColor: 'rgba(151,27,47,0.08)',
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 20,
                marginRight: 8,
              }}
              onPress={() => sendMessage(action.prompt)}
              disabled={claudePrompt.isPending}
            >
              <Text style={{ fontSize: 13, color: BURGUNDY, fontWeight: '500' }}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* General quick actions (no document context, empty state) */}
      {!hasDocumentContext && messages.length === 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
          keyboardShouldPersistTaps="always"
        >
          {['Help me write a draft', 'Brainstorm ideas', 'Create an outline'].map((text) => (
            <TouchableOpacity
              key={text}
              style={{
                backgroundColor: '#F0EDE8',
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 20,
                marginRight: 8,
              }}
              onPress={() => setInputText(text)}
            >
              <Text style={{ fontSize: 13, color: '#5A5652' }}>{text}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Input area */}
      <View
        style={{
          borderTopWidth: 0.5,
          borderTopColor: '#E5E1DC',
          backgroundColor: '#FFFFFF',
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <TextInput
            style={{
              flex: 1,
              backgroundColor: '#F7F5F2',
              borderRadius: 22,
              paddingHorizontal: 16,
              paddingVertical: 10,
              paddingRight: 12,
              fontSize: 15,
              color: '#1E1E1E',
              maxHeight: 100,
              marginRight: 10,
            }}
            placeholder={hasDocumentContext ? 'Ask about this document...' : 'Ask Claude...'}
            placeholderTextColor="#B0ACA8"
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={() => sendMessage()}
            editable={!claudePrompt.isPending}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={{
              backgroundColor: BURGUNDY,
              borderRadius: 22,
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: claudePrompt.isPending || !inputText.trim() ? 0.4 : 1,
            }}
            onPress={() => sendMessage()}
            disabled={claudePrompt.isPending || !inputText.trim()}
          >
            {claudePrompt.isPending ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Ionicons name="send" size={18} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
