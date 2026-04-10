import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  useMemo,
} from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Platform,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ─── Theme ────────────────────────────────────────────────────────────────────

const BURGUNDY = '#971B2F';
const COLORS = {
  text: '#1E1E1E',
  textMuted: '#7A7672',
  textLight: '#9E9A96',
  bg: '#FAFAF7',
  bgHover: '#F5F3F0',
  bgCode: '#F0EDE8',
  border: '#E5E1DC',
  accent: BURGUNDY,
  link: '#2563EB',
  blockquoteBorder: BURGUNDY,
  blockquoteBg: 'rgba(151,27,47,0.04)',
  hrColor: '#D5D1CC',
};

// ─── Block types ──────────────────────────────────────────────────────────────

type BlockType =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'paragraph'
  | 'bullet'
  | 'numbered'
  | 'blockquote'
  | 'code'
  | 'hr'
  | 'empty';

interface Block {
  id: string;
  type: BlockType;
  content: string; // Display content (without markdown prefix)
  raw: string; // Full raw markdown line(s)
  indent?: number; // For nested lists
  codeLanguage?: string; // For code blocks
}

// ─── Markdown parser ──────────────────────────────────────────────────────────

let blockIdCounter = 0;
function nextBlockId(): string {
  return `b-${++blockIdCounter}-${Date.now()}`;
}

function parseMarkdownToBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      const rawLines = [line];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        rawLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) rawLines.push(lines[i]); // closing ```
      blocks.push({
        id: nextBlockId(),
        type: 'code',
        content: codeLines.join('\n'),
        raw: rawLines.join('\n'),
        codeLanguage: lang || undefined,
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      blocks.push({ id: nextBlockId(), type: 'hr', content: '', raw: line });
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({
        id: nextBlockId(),
        type: `h${level}` as BlockType,
        content: headingMatch[2],
        raw: line,
      });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ') || line === '>') {
      const quoteLines: string[] = [];
      const rawLines: string[] = [];
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        rawLines.push(lines[i]);
        i++;
      }
      blocks.push({
        id: nextBlockId(),
        type: 'blockquote',
        content: quoteLines.join('\n'),
        raw: rawLines.join('\n'),
      });
      continue;
    }

    // Bullet list item
    const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (bulletMatch) {
      blocks.push({
        id: nextBlockId(),
        type: 'bullet',
        content: bulletMatch[2],
        raw: line,
        indent: Math.floor(bulletMatch[1].length / 2),
      });
      i++;
      continue;
    }

    // Numbered list item
    const numberedMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
    if (numberedMatch) {
      blocks.push({
        id: nextBlockId(),
        type: 'numbered',
        content: numberedMatch[2],
        raw: line,
        indent: Math.floor(numberedMatch[1].length / 2),
      });
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      blocks.push({ id: nextBlockId(), type: 'empty', content: '', raw: '' });
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty, non-special lines
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('> ') &&
      !lines[i].startsWith('- ') &&
      !lines[i].startsWith('* ') &&
      !lines[i].startsWith('+ ') &&
      !/^\d+\.\s/.test(lines[i]) &&
      !lines[i].trimStart().startsWith('```') &&
      !/^(\s*[-*_]\s*){3,}$/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({
      id: nextBlockId(),
      type: 'paragraph',
      content: paraLines.join('\n'),
      raw: paraLines.join('\n'),
    });
  }

  return blocks;
}

function blocksToMarkdown(blocks: Block[]): string {
  return blocks.map((b) => b.raw).join('\n');
}

function blockPrefixForType(type: BlockType): string {
  switch (type) {
    case 'h1': return '# ';
    case 'h2': return '## ';
    case 'h3': return '### ';
    case 'bullet': return '- ';
    case 'numbered': return '1. ';
    case 'blockquote': return '> ';
    default: return '';
  }
}

function rebuildRawFromContent(block: Block): string {
  switch (block.type) {
    case 'h1': return `# ${block.content}`;
    case 'h2': return `## ${block.content}`;
    case 'h3': return `### ${block.content}`;
    case 'bullet': return `${'  '.repeat(block.indent || 0)}- ${block.content}`;
    case 'numbered': return `${'  '.repeat(block.indent || 0)}1. ${block.content}`;
    case 'blockquote': return block.content.split('\n').map((l) => `> ${l}`).join('\n');
    case 'code': return `\`\`\`${block.codeLanguage || ''}\n${block.content}\n\`\`\``;
    case 'hr': return '---';
    case 'empty': return '';
    default: return block.content;
  }
}

// ─── Inline markdown renderer ─────────────────────────────────────────────────

interface InlineSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
}

function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  // Pattern: **bold**, *italic*, `code`, [link](url)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }
    if (match[2]) segments.push({ text: match[2], bold: true });
    else if (match[3]) segments.push({ text: match[3], italic: true });
    else if (match[4]) segments.push({ text: match[4], code: true });
    else if (match[5]) segments.push({ text: match[5], link: match[6] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }
  return segments.length === 0 ? [{ text }] : segments;
}

function InlineText({ content, style }: { content: string; style?: any }) {
  const segments = useMemo(() => parseInline(content), [content]);
  return (
    <Text style={style}>
      {segments.map((seg, i) => {
        if (seg.code) {
          return (
            <Text
              key={i}
              style={{
                fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
                fontSize: 13.5,
                backgroundColor: COLORS.bgCode,
                color: BURGUNDY,
                paddingHorizontal: 4,
                borderRadius: 3,
              }}
            >
              {seg.text}
            </Text>
          );
        }
        if (seg.link) {
          return (
            <Text key={i} style={{ color: COLORS.link, textDecorationLine: 'underline' }}>
              {seg.text}
            </Text>
          );
        }
        return (
          <Text
            key={i}
            style={{
              fontWeight: seg.bold ? '700' : undefined,
              fontStyle: seg.italic ? 'italic' : undefined,
            }}
          >
            {seg.text}
          </Text>
        );
      })}
    </Text>
  );
}

// ─── Block renderers ──────────────────────────────────────────────────────────

function RenderedBlock({ block }: { block: Block }) {
  switch (block.type) {
    case 'h1':
      return (
        <InlineText
          content={block.content}
          style={styles.h1}
        />
      );
    case 'h2':
      return (
        <InlineText
          content={block.content}
          style={styles.h2}
        />
      );
    case 'h3':
      return (
        <InlineText
          content={block.content}
          style={styles.h3}
        />
      );
    case 'paragraph':
      return (
        <InlineText
          content={block.content}
          style={styles.paragraph}
        />
      );
    case 'bullet':
      return (
        <View style={[styles.listRow, { paddingLeft: (block.indent || 0) * 20 }]}>
          <Text style={styles.bullet}>•</Text>
          <InlineText content={block.content} style={styles.listContent} />
        </View>
      );
    case 'numbered':
      return (
        <View style={[styles.listRow, { paddingLeft: (block.indent || 0) * 20 }]}>
          <Text style={styles.numberedMarker}>1.</Text>
          <InlineText content={block.content} style={styles.listContent} />
        </View>
      );
    case 'blockquote':
      return (
        <View style={styles.blockquote}>
          <InlineText content={block.content} style={styles.blockquoteText} />
        </View>
      );
    case 'code':
      return (
        <View style={styles.codeBlock}>
          {block.codeLanguage ? (
            <Text style={styles.codeLang}>{block.codeLanguage}</Text>
          ) : null}
          <Text style={styles.codeText}>{block.content}</Text>
        </View>
      );
    case 'hr':
      return <View style={styles.hr} />;
    case 'empty':
      return <View style={styles.emptyBlock} />;
    default:
      return <Text style={styles.paragraph}>{block.content}</Text>;
  }
}

// ─── Editable block ───────────────────────────────────────────────────────────

interface EditableBlockProps {
  block: Block;
  isEditing: boolean;
  onTap: () => void;
  onChangeContent: (content: string) => void;
  onBlur: () => void;
  onKeyPress: (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => void;
  onSubmit: () => void;
  inputRef: React.RefObject<TextInput | null>;
}

function EditableBlock({
  block,
  isEditing,
  onTap,
  onChangeContent,
  onBlur,
  onKeyPress,
  onSubmit,
  inputRef,
}: EditableBlockProps) {
  if (block.type === 'hr') {
    return (
      <TouchableOpacity
        onPress={onTap}
        activeOpacity={0.7}
        style={[styles.blockWrapper, isEditing && styles.blockEditing]}
      >
        <View style={styles.hr} />
      </TouchableOpacity>
    );
  }

  if (isEditing) {
    const isMultiline = block.type === 'code' || block.type === 'blockquote' || block.type === 'paragraph';
    return (
      <View style={[styles.blockWrapper, styles.blockEditing]}>
        {/* Show type indicator */}
        {block.type !== 'paragraph' && block.type !== 'empty' && (
          <Text style={styles.typeIndicator}>
            {block.type === 'h1' ? 'H1' :
             block.type === 'h2' ? 'H2' :
             block.type === 'h3' ? 'H3' :
             block.type === 'bullet' ? '•' :
             block.type === 'numbered' ? '1.' :
             block.type === 'blockquote' ? '❝' :
             block.type === 'code' ? '</>' :
             String(block.type).toUpperCase()}
          </Text>
        )}
        <TextInput
          ref={inputRef}
          style={[
            styles.editInput,
            block.type === 'code' && styles.editInputCode,
            block.type === 'h1' && { fontSize: 28, fontWeight: '800' as const },
            block.type === 'h2' && { fontSize: 22, fontWeight: '700' as const },
            block.type === 'h3' && { fontSize: 18, fontWeight: '600' as const },
          ]}
          value={block.content}
          onChangeText={onChangeContent}
          onBlur={onBlur}
          onKeyPress={onKeyPress}
          onSubmitEditing={isMultiline ? undefined : onSubmit}
          multiline={isMultiline}
          autoFocus
          placeholder={block.type === 'empty' ? 'Type something...' : `${block.type}...`}
          placeholderTextColor={COLORS.textLight}
          selectionColor={BURGUNDY}
        />
      </View>
    );
  }

  // Rendered (non-editing) state
  if (block.type === 'empty') {
    return (
      <TouchableOpacity
        onPress={onTap}
        activeOpacity={1}
        style={styles.blockWrapper}
      >
        <View style={styles.emptyBlock} />
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onTap}
      activeOpacity={0.85}
      style={styles.blockWrapper}
    >
      <RenderedBlock block={block} />
    </TouchableOpacity>
  );
}

// ─── Main Editor ──────────────────────────────────────────────────────────────

export interface NotionEditorRef {
  insertAtCursor: (before: string, after?: string) => void;
  getContent: () => string;
  focus: () => void;
}

interface NotionEditorProps {
  initialContent?: string;
  onContentChange?: (markdown: string) => void;
  editable?: boolean;
}

const NotionEditor = React.forwardRef<NotionEditorRef, NotionEditorProps>(
  ({ initialContent = '', onContentChange, editable = true }, ref) => {
    const [blocks, setBlocks] = useState<Block[]>(() =>
      parseMarkdownToBlocks(initialContent)
    );
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const inputRef = useRef<TextInput>(null);
    const scrollRef = useRef<ScrollView>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const contentRef = useRef(initialContent);

    // Sync when initialContent changes externally (e.g. polling)
    useEffect(() => {
      if (editingIndex !== null) return; // Don't overwrite while editing
      if (initialContent !== contentRef.current) {
        contentRef.current = initialContent;
        setBlocks(parseMarkdownToBlocks(initialContent));
      }
    }, [initialContent, editingIndex]);

    const emitChange = useCallback(
      (newBlocks: Block[]) => {
        const md = blocksToMarkdown(newBlocks);
        contentRef.current = md;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          onContentChange?.(md);
        }, 400);
      },
      [onContentChange]
    );

    useEffect(() => {
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }, []);

    const handleTap = useCallback(
      (index: number) => {
        if (!editable) return;
        setEditingIndex(index);
      },
      [editable]
    );

    const handleChangeContent = useCallback(
      (index: number, newContent: string) => {
        setBlocks((prev) => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            content: newContent,
            raw: rebuildRawFromContent({ ...updated[index], content: newContent }),
          };
          emitChange(updated);
          return updated;
        });
      },
      [emitChange]
    );

    const handleBlur = useCallback(() => {
      setEditingIndex(null);
    }, []);

    const handleKeyPress = useCallback(
      (index: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        const key = e.nativeEvent.key;

        // Enter on a single-line block → create new paragraph below
        if (key === 'Enter' && blocks[index]?.type !== 'code' && blocks[index]?.type !== 'blockquote') {
          e.preventDefault?.();
          const newBlock: Block = {
            id: nextBlockId(),
            type: 'paragraph',
            content: '',
            raw: '',
          };
          setBlocks((prev) => {
            const updated = [...prev];
            updated.splice(index + 1, 0, newBlock);
            emitChange(updated);
            return updated;
          });
          // Focus the new block
          setTimeout(() => setEditingIndex(index + 1), 50);
        }

        // Backspace on empty block → delete it
        if (key === 'Backspace' && blocks[index]?.content === '' && blocks.length > 1) {
          setBlocks((prev) => {
            const updated = prev.filter((_, i) => i !== index);
            emitChange(updated);
            return updated;
          });
          setEditingIndex(index > 0 ? index - 1 : 0);
        }
      },
      [blocks, emitChange]
    );

    const handleSubmit = useCallback(
      (index: number) => {
        // Create new block below on submit
        const newBlock: Block = {
          id: nextBlockId(),
          type: 'paragraph',
          content: '',
          raw: '',
        };
        setBlocks((prev) => {
          const updated = [...prev];
          updated.splice(index + 1, 0, newBlock);
          emitChange(updated);
          return updated;
        });
        setTimeout(() => setEditingIndex(index + 1), 50);
      },
      [emitChange]
    );

    // Handle tap on empty area below blocks → add new block
    const handleTapBelow = useCallback(() => {
      if (!editable) return;
      const newBlock: Block = {
        id: nextBlockId(),
        type: 'paragraph',
        content: '',
        raw: '',
      };
      setBlocks((prev) => {
        const updated = [...prev, newBlock];
        emitChange(updated);
        return updated;
      });
      setEditingIndex(blocks.length);
    }, [editable, blocks.length, emitChange]);

    // ── Block type switcher (slash commands) ───────────────────────────────

    const changeBlockType = useCallback(
      (index: number, newType: BlockType) => {
        setBlocks((prev) => {
          const updated = [...prev];
          const block = { ...updated[index], type: newType };
          block.raw = rebuildRawFromContent(block);
          updated[index] = block;
          emitChange(updated);
          return updated;
        });
      },
      [emitChange]
    );

    // ── Imperative handle ──────────────────────────────────────────────────

    useImperativeHandle(ref, () => ({
      insertAtCursor(before: string, after = '') {
        if (editingIndex === null) return;
        handleChangeContent(editingIndex, blocks[editingIndex].content + before + after);
      },
      getContent() {
        return blocksToMarkdown(blocks);
      },
      focus() {
        if (blocks.length > 0) setEditingIndex(0);
      },
    }));

    // ── Format toolbar for current block ───────────────────────────────────

    const renderBlockTypeBar = () => {
      if (editingIndex === null) return null;
      const currentType = blocks[editingIndex]?.type;
      if (!currentType) return null;

      const types: { type: BlockType; label: string; icon: string }[] = [
        { type: 'paragraph', label: 'Text', icon: 'text-outline' },
        { type: 'h1', label: 'H1', icon: 'text-outline' },
        { type: 'h2', label: 'H2', icon: 'text-outline' },
        { type: 'h3', label: 'H3', icon: 'text-outline' },
        { type: 'bullet', label: 'Bullet', icon: 'list-outline' },
        { type: 'numbered', label: 'Number', icon: 'list-outline' },
        { type: 'blockquote', label: 'Quote', icon: 'chatbox-outline' },
        { type: 'code', label: 'Code', icon: 'code-slash-outline' },
      ];

      return (
        <View style={styles.typeBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 8 }}
            keyboardShouldPersistTaps="always"
          >
            {types.map((t) => (
              <TouchableOpacity
                key={t.type}
                style={[
                  styles.typeChip,
                  currentType === t.type && styles.typeChipActive,
                ]}
                onPress={() => changeBlockType(editingIndex, t.type)}
              >
                <Ionicons
                  name={t.icon as any}
                  size={14}
                  color={currentType === t.type ? '#FFF' : COLORS.textMuted}
                  style={{ marginRight: 4 }}
                />
                <Text
                  style={[
                    styles.typeChipLabel,
                    currentType === t.type && styles.typeChipLabelActive,
                  ]}
                >
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      );
    };

    // ── Render ─────────────────────────────────────────────────────────────

    return (
      <View style={styles.container}>
        {renderBlockTypeBar()}
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {blocks.map((block, index) => (
            <EditableBlock
              key={block.id}
              block={block}
              isEditing={editingIndex === index}
              onTap={() => handleTap(index)}
              onChangeContent={(c) => handleChangeContent(index, c)}
              onBlur={handleBlur}
              onKeyPress={(e) => handleKeyPress(index, e)}
              onSubmit={() => handleSubmit(index)}
              inputRef={editingIndex === index ? inputRef : { current: null }}
            />
          ))}
          {/* Tap area below content to add new blocks */}
          <TouchableOpacity
            style={styles.tapBelow}
            onPress={handleTapBelow}
            activeOpacity={0.5}
          >
            <Text style={styles.tapBelowText}>+</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }
);

NotionEditor.displayName = 'NotionEditor';
export default NotionEditor;

// ─── Styles ───────────────────────────────────────────────────────────────────

const FONT_SERIF = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'Georgia, "Times New Roman", serif',
});

const FONT_MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: '"SF Mono", Menlo, Consolas, monospace',
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 120,
  },

  // Block wrapper
  blockWrapper: {
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 4,
    marginVertical: 1,
  },
  blockEditing: {
    backgroundColor: 'rgba(151,27,47,0.04)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(151,27,47,0.15)',
  },

  // Typography
  h1: {
    fontSize: 30,
    fontWeight: '800',
    color: COLORS.text,
    lineHeight: 38,
    letterSpacing: -0.5,
    marginTop: 12,
    marginBottom: 4,
  },
  h2: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 32,
    letterSpacing: -0.3,
    marginTop: 10,
    marginBottom: 2,
  },
  h3: {
    fontSize: 19,
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: 26,
    marginTop: 8,
    marginBottom: 2,
  },
  paragraph: {
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 26,
    fontFamily: FONT_SERIF,
  },

  // Lists
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingRight: 8,
  },
  bullet: {
    fontSize: 16,
    color: BURGUNDY,
    width: 20,
    textAlign: 'center',
    lineHeight: 26,
    fontWeight: '700',
  },
  numberedMarker: {
    fontSize: 15,
    color: COLORS.textMuted,
    width: 24,
    textAlign: 'right',
    lineHeight: 26,
    marginRight: 6,
    fontWeight: '600',
  },
  listContent: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 26,
  },

  // Blockquote
  blockquote: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.blockquoteBorder,
    backgroundColor: COLORS.blockquoteBg,
    paddingLeft: 16,
    paddingVertical: 12,
    paddingRight: 12,
    marginVertical: 8,
    borderRadius: 4,
  },
  blockquoteText: {
    fontSize: 16,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    lineHeight: 26,
    fontFamily: FONT_SERIF,
  },

  // Code
  codeBlock: {
    backgroundColor: '#2D2D2D',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginVertical: 6,
  },
  codeLang: {
    fontSize: 11,
    color: '#999',
    marginBottom: 8,
    fontFamily: FONT_MONO,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  codeText: {
    fontSize: 13.5,
    color: '#E0E0E0',
    fontFamily: FONT_MONO,
    lineHeight: 22,
  },

  // HR
  hr: {
    height: 1,
    backgroundColor: COLORS.hrColor,
    marginVertical: 16,
  },

  // Empty block
  emptyBlock: {
    height: 8,
  },
  emptyBlockTouchable: {
    minHeight: 32,
    justifyContent: 'center',
  },
  emptyPlaceholder: {
    fontSize: 16,
    color: COLORS.textLight,
    fontStyle: 'italic',
  },

  // Edit input
  editInput: {
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 24,
    padding: 0,
    minHeight: 28,
    fontFamily: FONT_SERIF,
  },
  editInputCode: {
    fontFamily: FONT_MONO,
    fontSize: 13.5,
    backgroundColor: '#2D2D2D',
    color: '#E0E0E0',
    borderRadius: 8,
    padding: 12,
    minHeight: 60,
  },

  // Type indicator
  typeIndicator: {
    fontSize: 10,
    color: BURGUNDY,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
    opacity: 0.6,
  },

  // Block type bar
  typeBar: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
    paddingVertical: 6,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0EDE8',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
  },
  typeChipActive: {
    backgroundColor: BURGUNDY,
  },
  typeChipLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  typeChipLabelActive: {
    color: '#FFFFFF',
  },

  // Tap-below area
  tapBelow: {
    minHeight: 200,
    paddingTop: 16,
    alignItems: 'flex-start',
    paddingLeft: 4,
    opacity: 0.25,
  },
  tapBelowText: {
    fontSize: 16,
    color: COLORS.textLight,
  },
});
