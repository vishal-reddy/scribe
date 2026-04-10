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
  ActionSheetIOS,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDocument } from '../../lib/hooks/use-documents';
import { useYjsDocument } from '../../lib/hooks/use-yjs-document';
import { useCollaboration } from '../../lib/hooks/use-collaboration';
import BlockNoteEditor, { BlockNoteEditorRef } from '../../components/BlockNoteEditor';
import MarkdownEditor, { MarkdownEditorRef } from '../../components/MarkdownEditor';
import SyncStatus from '../../components/SyncStatus';
import ClaudeEditingBanner from '../../components/ClaudeEditingBanner';
import { documentsService } from '../../lib/services/documents';

// Use MarkdownEditor on all platforms for now (BlockNote via WebView is unreliable)
const USE_BLOCKNOTE = false;

const BURGUNDY = '#971B2F';
const CREAM_BG = '#FAFAF7';

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

  const handleOverflowMenu = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Save Version', 'Export', 'Share', 'History', 'Ask Claude', 'Cancel'],
          cancelButtonIndex: 5,
        },
        (index) => {
          if (index === 0) handleSave();
          else if (index === 1) handleExport();
          else if (index === 2) handleShare();
          else if (index === 3) router.push(`/history/${documentId}`);
          else if (index === 4) router.push(`/claude?documentId=${documentId}`);
        }
      );
    } else {
      Alert.alert('Actions', undefined, [
        { text: 'Save Version', onPress: handleSave },
        { text: 'Export', onPress: handleExport },
        { text: 'Share', onPress: handleShare },
        { text: 'History', onPress: () => router.push(`/history/${documentId}`) },
        { text: 'Ask Claude', onPress: () => router.push(`/claude?documentId=${documentId}`) },
        { text: 'Cancel', style: 'cancel' },
      ]);
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
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: CREAM_BG }}>
        <ActivityIndicator size="large" color={BURGUNDY} />
      </View>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: CREAM_BG }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Claude editing banner */}
      <ClaudeEditingBanner visible={isClaudeEditing} onDismiss={dismissClaudeEditing} />

      {/* Clean minimal header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 12,
          paddingVertical: 10,
          backgroundColor: '#FFFFFF',
          borderBottomWidth: 0.5,
          borderBottomColor: '#E5E1DC',
        }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ padding: 6 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color="#1E1E1E" />
        </TouchableOpacity>

        <View style={{ flex: 1, alignItems: 'center', marginHorizontal: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#1E1E1E' }} numberOfLines={1}>
            {docData?.title || 'Untitled'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <SyncStatus
              isSynced={isConnected}
              lastSynced={undefined}
              lastEditor={lastEditor}
              collaboratorCount={collaboratorCount}
            />
          </View>
        </View>

        <TouchableOpacity
          onPress={handleOverflowMenu}
          style={{ padding: 6 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color="#1E1E1E" />
        </TouchableOpacity>
      </View>

      {/* Formatting toolbar */}
      {!USE_BLOCKNOTE && (
        <View style={{ backgroundColor: '#F7F5F2', borderBottomWidth: 0.5, borderBottomColor: '#E5E1DC' }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 8 }}
            keyboardShouldPersistTaps="always"
          >
            {FORMAT_ACTIONS.map((action) => (
              <TouchableOpacity
                key={action.label}
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  marginRight: 6,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.04,
                  shadowRadius: 2,
                  elevation: 1,
                }}
                onPress={() => handleFormat(action)}
                accessibilityLabel={action.label}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: BURGUNDY }}>{action.icon}</Text>
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
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 8,
          backgroundColor: '#F7F5F2',
          borderTopWidth: 0.5,
          borderTopColor: '#E5E1DC',
        }}
      >
        <Text style={{ fontSize: 12, color: '#9E9A96' }}>
          {wordCount} {wordCount === 1 ? 'word' : 'words'}
        </Text>
        <Text style={{ fontSize: 12, color: '#9E9A96' }}>
          {isConnected
            ? lastSavedAt
              ? `Saved ${relativeTime}`
              : 'Synced'
            : 'Saving...'}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}
