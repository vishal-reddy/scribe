import React, { useState, useEffect, useRef, useImperativeHandle, useCallback } from 'react';
import { TextInput, View, NativeSyntheticEvent, TextInputSelectionChangeEventData } from 'react-native';

interface MarkdownEditorProps {
  initialContent?: string;
  onContentChange?: (markdown: string) => void;
  editable?: boolean;
}

export interface MarkdownEditorRef {
  insertAtCursor: (before: string, after?: string) => void;
  getContent: () => string;
  focus: () => void;
}

const MarkdownEditor = React.forwardRef<MarkdownEditorRef, MarkdownEditorProps>(({
  initialContent = '',
  onContentChange,
  editable = true,
}, ref) => {
  const [content, setContent] = useState(initialContent);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const inputRef = useRef<TextInput>(null);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // Update content when initialContent changes
  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  const handleChange = (text: string) => {
    setContent(text);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      onContentChange?.(text);
    }, 500);
  };

  const handleSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      selectionRef.current = e.nativeEvent.selection;
    },
    []
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useImperativeHandle(ref, () => ({
    insertAtCursor(before: string, after = '') {
      const { start, end } = selectionRef.current;
      const selected = content.substring(start, end);
      const newText =
        content.substring(0, start) + before + selected + after + content.substring(end);
      setContent(newText);
      onContentChange?.(newText);
      inputRef.current?.focus();
    },
    getContent() {
      return content;
    },
    focus() {
      inputRef.current?.focus();
    },
  }));

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <TextInput
        ref={inputRef}
        style={{
          flex: 1,
          fontSize: 16,
          lineHeight: 24,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          color: '#1E1E1E',
          textAlignVertical: 'top',
          padding: 0,
        }}
        value={content}
        onChangeText={handleChange}
        onSelectionChange={handleSelectionChange}
        multiline
        editable={editable}
        placeholder="Start writing..."
        placeholderTextColor="#B0ACA8"
        textAlignVertical="top"
      />
    </View>
  );
});

MarkdownEditor.displayName = 'MarkdownEditor';

export default MarkdownEditor;
