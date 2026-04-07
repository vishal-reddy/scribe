import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
  Alert,
  Share,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useDocument } from '../../lib/hooks/use-documents';
import { useYjsDocument } from '../../lib/hooks/use-yjs-document';
import { useCollaboration } from '../../lib/hooks/use-collaboration';
import BlockNoteEditor, { BlockNoteEditorRef } from '../../components/BlockNoteEditor';
import MarkdownEditor, { MarkdownEditorRef } from '../../components/MarkdownEditor';
import SyncStatus from '../../components/SyncStatus';
import ClaudeEditingBanner from '../../components/ClaudeEditingBanner';
import { documentsService } from '../../lib/services/documents';

// Use BlockNote on web, MarkdownEditor on mobile (for now)
const USE_BLOCKNOTE = Platform.OS === 'web';

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatRelativeTime(date: Date | null): string {
  if (!date) return '';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

// ─── Formatting toolbar items ─────────────────────────────────────────────

interface FormatAction {
  label: string;
  icon: string;
  before: string;
  after: string;
}

const FORMAT_ACTIONS: FormatAction[] = [
  { label: 'Bold',       icon: 'B',   before: '**',          after: '**' },
  { label: 'Italic',     icon: 'I',   before: '*',           after: '*' },
  { label: 'H1',         icon: 'H1',  before: '# ',          after: '' },
  { label: 'H2',         icon: 'H2',  before: '## ',         after: '' },
  { label: 'H3',         icon: 'H3',  before: '### ',        after: '' },
  { label: 'Bullet',     icon: '•',   before: '- ',          after: '' },
  { label: 'Numbered',   icon: '1.',  before: '1. ',         after: '' },
  { label: 'Code',       icon: '</>',  before: '```\n',       after: '\n```' },
  { label: 'Link',       icon: '🔗',  before: '[',           after: '](url)' },
];

// ─── Screen ───────────────────────────────────────────────────────────────

export default function DocumentEditorScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const documentId = Array.isArray(id) ? id[0] : id;
  const blockNoteRef = useRef<BlockNoteEditorRef>(null);
  const markdownEditorRef = useRef<MarkdownEditorRef>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [relativeTime, setRelativeTime] = useState('');

  // Fetch document metadata
  const { data: docData, isLoading } = useDocument(documentId);

  // Use Y.js with WebSocket for real-time sync
  const { markdown, isConnected, updateContent, ydoc } = useYjsDocument(documentId);

  // Collaboration awareness — detect Claude edits
  const {
    isClaudeEditing,
    lastEditor,
    collaboratorCount,
    dismissClaudeEditing,
  } = useCollaboration(documentId);

  // Dismiss Claude banner when the user starts typing
  const handleContentChange = useCallback(
    (md: string) => {
      if (isClaudeEditing) dismissClaudeEditing();
      updateContent(md);
    },
    [isClaudeEditing, dismissClaudeEditing, updateContent]
  );

  // Track auto-save timestamp whenever Y.js reports connected after a content change
  useEffect(() => {
    if (isConnected && markdown) {
      setLastSavedAt(new Date());
    }
  }, [isConnected, markdown]);

  // Tick the relative-time label every 15 s
  useEffect(() => {
    const tick = () => setRelativeTime(formatRelativeTime(lastSavedAt));
    tick();
    const interval = setInterval(tick, 15_000);
    return () => clearInterval(interval);
  }, [lastSavedAt]);

  const wordCount = useMemo(() => countWords(markdown), [markdown]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await documentsService.createVersion(documentId);
      setLastSavedAt(new Date());
      if (Platform.OS === 'web') {
        alert('Version saved successfully');
      } else {
        Alert.alert('Success', 'Version saved successfully');
      }
    } catch (error) {
      console.error('Save error:', error);
      if (Platform.OS === 'web') {
        alert('Failed to save version');
      } else {
        Alert.alert('Error', 'Failed to save version');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      let markdownContent = markdown;

      if (USE_BLOCKNOTE && blockNoteRef.current) {
        markdownContent = await blockNoteRef.current.exportMarkdown();
      }

      if (Platform.OS === 'web') {
        const blob = new Blob([markdownContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${docData?.title || 'document'}.md`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({
          message: markdownContent,
          title: `${docData?.title || 'document'}.md`,
        });
      }
    } catch (error) {
      console.error('Export error:', error);
      if (Platform.OS === 'web') {
        alert('Failed to export document');
      } else {
        Alert.alert('Error', 'Failed to export document');
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleShare = async () => {
    try {
      let markdownContent = markdown;

      if (USE_BLOCKNOTE && blockNoteRef.current) {
        markdownContent = await blockNoteRef.current.exportMarkdown();
      }

      if (Platform.OS === 'web') {
        if (navigator.share) {
          await navigator.share({
            title: docData?.title || 'Untitled Document',
            text: markdownContent,
          });
        } else {
          await navigator.clipboard.writeText(markdownContent);
          alert('Content copied to clipboard');
        }
      } else {
        await Share.share({
          message: markdownContent,
          title: docData?.title || 'Untitled Document',
        });
      }
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  const handleFormat = useCallback((action: FormatAction) => {
    if (!USE_BLOCKNOTE && markdownEditorRef.current) {
      markdownEditorRef.current.insertAtCursor(action.before, action.after);
    }
  }, []);

  // ── Loading state ───────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center">
        <ActivityIndicator size="large" color="#971B2F" />
      </View>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Claude editing banner */}
      <ClaudeEditingBanner visible={isClaudeEditing} onDismiss={dismissClaudeEditing} />

      {/* Header */}
      <View className="p-4 border-b border-gray-200">
        <View className="flex-row justify-between items-center mb-2">
          <Text className="text-lg font-bold flex-1" numberOfLines={1}>
            {docData?.title || 'Untitled'}
          </Text>
          <View className="flex-row gap-2">
            <TouchableOpacity
              className={`px-3 py-2 rounded-lg ${isSaving ? 'bg-gray-300' : 'bg-primary'}`}
              onPress={handleSave}
              disabled={isSaving}
            >
              <Text className="text-white text-sm font-medium">
                {isSaving ? 'Saving...' : 'Save'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className={`px-3 py-2 rounded-lg ${isExporting ? 'bg-gray-300' : 'bg-primary-600'}`}
              onPress={handleExport}
              disabled={isExporting}
            >
              <Text className="text-white text-sm font-medium">
                {isExporting ? 'Exporting...' : 'Export'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="bg-primary-700 px-3 py-2 rounded-lg"
              onPress={handleShare}
            >
              <Text className="text-white text-sm font-medium">Share</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Secondary Actions */}
        <View className="flex-row gap-2 mb-2">
          <TouchableOpacity
            className="bg-primary px-4 py-2 rounded-lg"
            onPress={() => router.push(`/claude?documentId=${documentId}`)}
          >
            <Text className="text-white text-sm font-medium">Ask Claude</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="bg-gray-200 px-3 py-2 rounded-lg"
            onPress={() => router.push(`/history/${documentId}`)}
          >
            <Text className="text-sm">History</Text>
          </TouchableOpacity>
        </View>

        {/* Sync / save status */}
        <View className="flex-row items-center justify-between">
          <SyncStatus
            isSynced={isConnected}
            lastSynced={undefined}
            lastEditor={lastEditor}
            collaboratorCount={collaboratorCount}
          />
          <Text className="text-xs text-gray-400">
            {isConnected
              ? lastSavedAt
                ? `Saved ${relativeTime}`
                : 'Saved'
              : 'Saving...'}
          </Text>
        </View>
      </View>

      {/* Formatting toolbar */}
      {!USE_BLOCKNOTE && (
        <View className="border-b border-gray-100 bg-gray-50">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 6 }}
            keyboardShouldPersistTaps="always"
          >
            {FORMAT_ACTIONS.map((action) => (
              <TouchableOpacity
                key={action.label}
                className="bg-white border border-gray-200 rounded-md px-3 py-1.5 mr-2"
                onPress={() => handleFormat(action)}
                accessibilityLabel={action.label}
              >
                <Text className="text-sm font-semibold text-primary">{action.icon}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Editor */}
      {USE_BLOCKNOTE ? (
        <BlockNoteEditor
          ref={blockNoteRef}
          initialContent={markdown}
          onContentChange={handleContentChange}
          ydoc={ydoc}
        />
      ) : (
        <MarkdownEditor
          ref={markdownEditorRef}
          initialContent={markdown}
          onContentChange={handleContentChange}
        />
      )}

      {/* Footer status bar */}
      <View className="flex-row items-center justify-between px-4 py-2 border-t border-gray-100 bg-gray-50">
        <Text className="text-xs text-gray-400">{wordCount} {wordCount === 1 ? 'word' : 'words'}</Text>
        <Text className="text-xs text-gray-400">Markdown</Text>
      </View>
    </KeyboardAvoidingView>
  );
}
