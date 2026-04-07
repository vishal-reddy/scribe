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
import { useClaudePrompt } from '../lib/hooks/use-claude';
import { useDocument, useUpdateDocument } from '../lib/hooks/use-documents';
import type { Message } from '../lib/types';

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

  const renderMessage = ({ item }: { item: Message }) => (
    <View className={`mb-4 ${item.role === 'user' ? 'items-end' : 'items-start'}`}>
      <View
        className={`max-w-[80%] p-3 rounded-lg ${
          item.role === 'user' ? 'bg-primary' : 'bg-gray-200'
        }`}
      >
        <Text className={item.role === 'user' ? 'text-white' : 'text-gray-900'}>
          {item.content}
        </Text>
      </View>
      <View className="flex-row items-center gap-2 mt-1">
        <Text className="text-xs text-gray-500">{item.timestamp.toLocaleTimeString()}</Text>
        {item.role === 'assistant' && documentId && (
          <TouchableOpacity
            className="bg-primary/10 px-2 py-0.5 rounded"
            onPress={() => handleApply(item.content)}
            disabled={updateDocument.isPending}
          >
            <Text className="text-xs font-medium text-primary">
              {updateDocument.isPending ? 'Applying...' : 'Apply to document'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  // ── Main render ─────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Document context banner */}
      {hasDocumentContext && (
        <View className="flex-row items-center justify-between bg-primary-50 px-4 py-2.5 border-b border-primary-100">
          <View className="flex-1 mr-2">
            <Text className="text-xs text-primary-400 font-medium">EDITING</Text>
            <Text className="text-sm font-semibold text-primary" numberOfLines={1}>
              {docData?.title || 'Untitled Document'}
            </Text>
          </View>
          <TouchableOpacity
            className="bg-primary-100 rounded-full w-6 h-6 items-center justify-center"
            onPress={() => setContextDismissed(true)}
            accessibilityLabel="Dismiss document context"
          >
            <Text className="text-primary text-xs font-bold">✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Message list or empty state */}
      {messages.length === 0 ? (
        <View className="flex-1 justify-center items-center p-6">
          <Text className="text-2xl font-bold mb-2">Chat with Claude</Text>
          <Text className="text-gray-600 text-center">
            Ask Claude to help you create or edit documents
          </Text>
          {hasDocumentContext && (
            <Text className="text-sm text-gray-500 mt-4 text-center">
              Claude has access to your current document and can make edits
            </Text>
          )}
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          className="flex-1 p-4"
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />
      )}

      {/* Document preview (collapsible) */}
      {hasDocumentContext && docData?.markdown && (
        <View className="border-t border-gray-100">
          <TouchableOpacity
            className="flex-row items-center justify-between px-4 py-2 bg-gray-50"
            onPress={() => setShowDocPreview((v) => !v)}
          >
            <Text className="text-xs font-medium text-gray-500">
              Document preview
            </Text>
            <Text className="text-xs text-gray-400">{showDocPreview ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {showDocPreview && (
            <ScrollView className="max-h-32 px-4 py-2 bg-gray-50">
              <Text className="text-xs text-gray-600 leading-4" numberOfLines={20}>
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
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 6 }}
          keyboardShouldPersistTaps="always"
          className="border-t border-gray-100"
        >
          {DOCUMENT_QUICK_ACTIONS.map((action) => (
            <TouchableOpacity
              key={action.label}
              className="bg-primary/10 px-3 py-1.5 rounded-full mr-2"
              onPress={() => sendMessage(action.prompt)}
              disabled={claudePrompt.isPending}
            >
              <Text className="text-sm text-primary font-medium">{action.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* General quick actions (no document context, empty state) */}
      {!hasDocumentContext && messages.length === 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 6 }}
          keyboardShouldPersistTaps="always"
        >
          {['Help me write a draft', 'Brainstorm ideas', 'Create an outline'].map((text) => (
            <TouchableOpacity
              key={text}
              className="bg-gray-100 px-3 py-2 rounded-full mr-2"
              onPress={() => setInputText(text)}
            >
              <Text className="text-sm">{text}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Input area */}
      <View className="border-t border-gray-200 p-4">
        <View className="flex-row items-center">
          <TextInput
            className="flex-1 border border-gray-300 rounded-full px-4 py-2 mr-2"
            placeholder={hasDocumentContext ? 'Ask about this document...' : 'Ask Claude...'}
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={() => sendMessage()}
            editable={!claudePrompt.isPending}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            className={`bg-primary rounded-full w-10 h-10 items-center justify-center ${
              claudePrompt.isPending || !inputText.trim() ? 'opacity-50' : ''
            }`}
            onPress={() => sendMessage()}
            disabled={claudePrompt.isPending || !inputText.trim()}
          >
            {claudePrompt.isPending ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text className="text-white text-lg">→</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
