import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
  Alert,
  Share,
  KeyboardAvoidingView,
  ActionSheetIOS,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDocument } from '../../lib/hooks/use-documents';
import { useYjsDocument } from '../../lib/hooks/use-yjs-document';
import { useCollaboration } from '../../lib/hooks/use-collaboration';
import NotionEditor, { NotionEditorRef } from '../../components/NotionEditor';
import SyncStatus from '../../components/SyncStatus';
import ClaudeEditingBanner from '../../components/ClaudeEditingBanner';
import { documentsService } from '../../lib/services/documents';
import { exportDocument, EXPORT_FORMATS, getFormatLabel, type ExportFormat } from '../../lib/export';

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

// ─── Screen ───────────────────────────────────────────────────────────────

export default function DocumentEditorScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const documentId = Array.isArray(id) ? id[0] : id;
  const blockNoteRef = useRef<NotionEditorRef>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showOverflowModal, setShowOverflowModal] = useState(false);
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

  const handleExport = async (format: ExportFormat = 'md') => {
    setIsExporting(true);
    try {
      const markdownContent = blockNoteRef.current?.getContent() || markdown;
      await exportDocument({
        title: docData?.title || 'Untitled',
        markdown: markdownContent,
        format,
      });
    } catch (error) {
      console.error('Export error:', error);
      const msg = 'Failed to export document';
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Error', msg);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportMenu = () => {
    if (Platform.OS === 'ios') {
      const options = EXPORT_FORMATS.map(getFormatLabel);
      options.push('Cancel');
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1, title: 'Export As' },
        (index) => {
          if (index < EXPORT_FORMATS.length) handleExport(EXPORT_FORMATS[index]);
        }
      );
    } else if (Platform.OS === 'web') {
      // Show a simple dropdown using native confirm for each format
      // Web gets a format picker via the export modal
      setShowExportModal(true);
    } else {
      Alert.alert('Export As', 'Choose a format', [
        ...EXPORT_FORMATS.map((f) => ({
          text: getFormatLabel(f),
          onPress: () => handleExport(f),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  const handleShare = async () => {
    try {
      const markdownContent = blockNoteRef.current?.getContent() || markdown;

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
    if (Platform.OS === 'web') {
      setShowOverflowModal(true);
    } else if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Save Version', 'Export', 'Share', 'History', 'Ask Claude', 'Cancel'],
          cancelButtonIndex: 5,
        },
        (index) => {
          if (index === 0) handleSave();
          else if (index === 1) handleExportMenu();
          else if (index === 2) handleShare();
          else if (index === 3) router.push(`/history/${documentId}`);
          else if (index === 4) router.push(`/claude?documentId=${documentId}`);
        }
      );
    } else {
      Alert.alert('Actions', undefined, [
        { text: 'Save Version', onPress: handleSave },
        { text: 'Export', onPress: handleExportMenu },
        { text: 'Share', onPress: handleShare },
        { text: 'History', onPress: () => router.push(`/history/${documentId}`) },
        { text: 'Ask Claude', onPress: () => router.push(`/claude?documentId=${documentId}`) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

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

      {/* Notion-style block editor */}
      <NotionEditor
        ref={blockNoteRef}
        initialContent={markdown}
        onContentChange={handleContentChange}
      />

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

      {/* Export format picker (web) */}
      {showExportModal && (
        <View
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 100,
          }}
        >
          <View
            style={{
              backgroundColor: '#FFFDF9',
              borderRadius: 12,
              padding: 24,
              width: 320,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 12,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#1E1E1E', marginBottom: 16 }}>
              Export As
            </Text>
            {EXPORT_FORMATS.map((fmt) => (
              <TouchableOpacity
                key={fmt}
                onPress={() => {
                  setShowExportModal(false);
                  handleExport(fmt);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  marginBottom: 4,
                }}
              >
                <Text style={{ fontSize: 16, color: '#1E1E1E', flex: 1 }}>
                  {getFormatLabel(fmt)}
                </Text>
                <Ionicons name="download-outline" size={18} color="#971B2F" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => setShowExportModal(false)}
              style={{
                marginTop: 8,
                paddingVertical: 10,
                alignItems: 'center',
                borderRadius: 8,
                backgroundColor: '#F7F5F2',
              }}
            >
              <Text style={{ fontSize: 14, color: '#666' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Overflow actions menu (web) */}
      {showOverflowModal && (
        <View
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
            justifyContent: 'flex-start',
            alignItems: 'flex-end',
            paddingTop: 56,
            paddingRight: 12,
            zIndex: 100,
          }}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setShowOverflowModal(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <View
            style={{
              backgroundColor: '#FFFDF9',
              borderRadius: 10,
              paddingVertical: 6,
              width: 200,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 12,
            }}
          >
            {([
              { label: 'Save Version', icon: 'save-outline' as const, onPress: handleSave },
              { label: 'Export', icon: 'download-outline' as const, onPress: () => { setShowOverflowModal(false); handleExportMenu(); } },
              { label: 'Share', icon: 'share-outline' as const, onPress: handleShare },
              { label: 'History', icon: 'time-outline' as const, onPress: () => router.push(`/history/${documentId}`) },
              { label: 'Ask Claude', icon: 'chatbubble-ellipses-outline' as const, onPress: () => router.push(`/claude?documentId=${documentId}`) },
            ]).map((item, i) => (
              <TouchableOpacity
                key={item.label}
                onPress={() => {
                  setShowOverflowModal(false);
                  item.onPress();
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 11,
                  paddingHorizontal: 16,
                  borderBottomWidth: i < 4 ? 0.5 : 0,
                  borderBottomColor: '#E5E1DC',
                }}
              >
                <Ionicons name={item.icon} size={18} color="#666" style={{ marginRight: 12 }} />
                <Text style={{ fontSize: 15, color: '#1E1E1E' }}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
