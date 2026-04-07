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
    <View className="flex-1 p-4">
      <TextInput
        ref={inputRef}
        className="flex-1 text-base"
        style={{ fontFamily: 'System' }}
        value={content}
        onChangeText={handleChange}
        onSelectionChange={handleSelectionChange}
        multiline
        editable={editable}
        placeholder="Start writing..."
        textAlignVertical="top"
      />
    </View>
  );
});

MarkdownEditor.displayName = 'MarkdownEditor';

export default MarkdownEditor;
