import { Platform, Share } from 'react-native';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  ShadingType,
} from 'docx';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ExportFormat = 'md' | 'docx' | 'html' | 'txt';

interface ExportOptions {
  title: string;
  markdown: string;
  format: ExportFormat;
}

// ─── Markdown → DOCX ───────────────────────────────────────────────────────

interface ParsedLine {
  type: 'h1' | 'h2' | 'h3' | 'paragraph' | 'bullet' | 'numbered' | 'blockquote' | 'code' | 'hr' | 'empty';
  content: string;
  raw: string;
}

function parseMarkdownLines(md: string): ParsedLine[] {
  const lines = md.split('\n');
  const parsed: ParsedLine[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        parsed.push({ type: 'code', content: '', raw: line });
      }
      continue;
    }

    if (inCodeBlock) {
      // Append to last code block
      const last = parsed[parsed.length - 1];
      if (last?.type === 'code') {
        last.content += (last.content ? '\n' : '') + line;
      }
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      parsed.push({ type: 'empty', content: '', raw: line });
    } else if (trimmed.match(/^---+$|^___+$|^\*\*\*+$/)) {
      parsed.push({ type: 'hr', content: '', raw: line });
    } else if (trimmed.startsWith('### ')) {
      parsed.push({ type: 'h3', content: trimmed.slice(4), raw: line });
    } else if (trimmed.startsWith('## ')) {
      parsed.push({ type: 'h2', content: trimmed.slice(3), raw: line });
    } else if (trimmed.startsWith('# ')) {
      parsed.push({ type: 'h1', content: trimmed.slice(2), raw: line });
    } else if (trimmed.startsWith('> ')) {
      parsed.push({ type: 'blockquote', content: trimmed.slice(2), raw: line });
    } else if (trimmed.match(/^[-*+] /)) {
      parsed.push({ type: 'bullet', content: trimmed.replace(/^[-*+] /, ''), raw: line });
    } else if (trimmed.match(/^\d+\. /)) {
      parsed.push({ type: 'numbered', content: trimmed.replace(/^\d+\. /, ''), raw: line });
    } else {
      parsed.push({ type: 'paragraph', content: trimmed, raw: line });
    }
  }

  return parsed;
}

function buildInlineRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Match bold, italic, inline code, or plain text
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|([^*`]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true }));
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], italics: true }));
    } else if (match[6]) {
      runs.push(new TextRun({
        text: match[6],
        font: 'Courier New',
        size: 20, // 10pt
        shading: { type: ShadingType.SOLID, color: 'F0F0F0', fill: 'F0F0F0' },
      }));
    } else if (match[7]) {
      runs.push(new TextRun({ text: match[7] }));
    }
  }

  return runs.length ? runs : [new TextRun({ text })];
}

function markdownToDocx(title: string, md: string): Document {
  const lines = parseMarkdownLines(md);
  const children: Paragraph[] = [];

  for (const line of lines) {
    switch (line.type) {
      case 'h1':
        children.push(new Paragraph({
          children: [new TextRun({ text: line.content, bold: true, size: 48 })],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        }));
        break;

      case 'h2':
        children.push(new Paragraph({
          children: [new TextRun({ text: line.content, bold: true, size: 36 })],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        }));
        break;

      case 'h3':
        children.push(new Paragraph({
          children: [new TextRun({ text: line.content, bold: true, size: 28 })],
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
        }));
        break;

      case 'paragraph':
        children.push(new Paragraph({
          children: buildInlineRuns(line.content),
          spacing: { after: 120 },
        }));
        break;

      case 'bullet':
        children.push(new Paragraph({
          children: buildInlineRuns(line.content),
          bullet: { level: 0 },
          spacing: { after: 60 },
        }));
        break;

      case 'numbered':
        children.push(new Paragraph({
          children: buildInlineRuns(line.content),
          numbering: { reference: 'default-numbering', level: 0 },
          spacing: { after: 60 },
        }));
        break;

      case 'blockquote':
        children.push(new Paragraph({
          children: buildInlineRuns(line.content),
          indent: { left: 720 },
          border: {
            left: { style: BorderStyle.SINGLE, size: 6, color: '971B2F', space: 10 },
          },
          spacing: { after: 120 },
        }));
        break;

      case 'code':
        children.push(new Paragraph({
          children: [new TextRun({
            text: line.content,
            font: 'Courier New',
            size: 18,
          })],
          shading: { type: ShadingType.SOLID, color: 'F5F5F5', fill: 'F5F5F5' },
          spacing: { before: 120, after: 120 },
        }));
        break;

      case 'hr':
        children.push(new Paragraph({
          children: [],
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } },
          spacing: { before: 200, after: 200 },
        }));
        break;

      case 'empty':
        children.push(new Paragraph({ children: [], spacing: { after: 60 } }));
        break;
    }
  }

  return new Document({
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [{
          level: 0,
          format: 'decimal',
          text: '%1.',
          alignment: AlignmentType.START,
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  });
}

// ─── Markdown → HTML ────────────────────────────────────────────────────────

function markdownToHtml(title: string, md: string): string {
  const lines = parseMarkdownLines(md);
  let html = '';

  function inlineHtml(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  }

  for (const line of lines) {
    switch (line.type) {
      case 'h1': html += `<h1>${inlineHtml(line.content)}</h1>\n`; break;
      case 'h2': html += `<h2>${inlineHtml(line.content)}</h2>\n`; break;
      case 'h3': html += `<h3>${inlineHtml(line.content)}</h3>\n`; break;
      case 'paragraph': html += `<p>${inlineHtml(line.content)}</p>\n`; break;
      case 'bullet': html += `<ul><li>${inlineHtml(line.content)}</li></ul>\n`; break;
      case 'numbered': html += `<ol><li>${inlineHtml(line.content)}</li></ol>\n`; break;
      case 'blockquote': html += `<blockquote>${inlineHtml(line.content)}</blockquote>\n`; break;
      case 'code': html += `<pre><code>${line.content.replace(/</g, '&lt;')}</code></pre>\n`; break;
      case 'hr': html += '<hr>\n'; break;
      case 'empty': break;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  body { font-family: Georgia, serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1E1E1E; line-height: 1.6; }
  h1, h2, h3 { font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #333; }
  h1 { font-size: 2em; border-bottom: 2px solid #971B2F; padding-bottom: 8px; }
  h2 { font-size: 1.5em; }
  h3 { font-size: 1.2em; }
  blockquote { border-left: 3px solid #971B2F; margin-left: 0; padding-left: 16px; color: #555; font-style: italic; }
  pre { background: #f5f5f5; padding: 16px; border-radius: 6px; overflow-x: auto; }
  code { font-family: 'Courier New', monospace; font-size: 0.9em; background: #f0f0f0; padding: 2px 4px; border-radius: 3px; }
  pre code { background: none; padding: 0; }
  hr { border: none; border-top: 1px solid #ddd; margin: 24px 0; }
  a { color: #971B2F; }
</style>
</head>
<body>
${html}
</body>
</html>`;
}

// ─── Markdown → Plain Text ──────────────────────────────────────────────────

function markdownToPlainText(md: string): string {
  return md
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^[-*+] /gm, '• ')
    .replace(/^> /gm, '  ')
    .replace(/^---+$/gm, '────────────────');
}

// ─── Download helper (web) ──────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function getFormatLabel(format: ExportFormat): string {
  switch (format) {
    case 'md': return 'Markdown (.md)';
    case 'docx': return 'Word (.docx)';
    case 'html': return 'HTML (.html)';
    case 'txt': return 'Plain Text (.txt)';
  }
}

export function getFormatIcon(format: ExportFormat): string {
  switch (format) {
    case 'md': return 'document-text-outline';
    case 'docx': return 'document-outline';
    case 'html': return 'code-slash-outline';
    case 'txt': return 'reader-outline';
  }
}

export const EXPORT_FORMATS: ExportFormat[] = ['md', 'docx', 'html', 'txt'];

export async function exportDocument({ title, markdown, format }: ExportOptions): Promise<void> {
  const safeName = title.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'document';

  switch (format) {
    case 'md': {
      if (Platform.OS === 'web') {
        downloadBlob(new Blob([markdown], { type: 'text/markdown' }), `${safeName}.md`);
      } else {
        await Share.share({ message: markdown, title: `${safeName}.md` });
      }
      break;
    }

    case 'docx': {
      const doc = markdownToDocx(title, markdown);

      if (Platform.OS === 'web') {
        const blob = await Packer.toBlob(doc);
        downloadBlob(blob, `${safeName}.docx`);
      } else {
        const buffer = await Packer.toBuffer(doc);
        const base64 = bufferToBase64(buffer);
        await Share.share({
          message: `Export: ${safeName}.docx`,
          title: `${safeName}.docx`,
          url: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64}`,
        });
      }
      break;
    }

    case 'html': {
      const html = markdownToHtml(title, markdown);
      if (Platform.OS === 'web') {
        downloadBlob(new Blob([html], { type: 'text/html' }), `${safeName}.html`);
      } else {
        await Share.share({ message: html, title: `${safeName}.html` });
      }
      break;
    }

    case 'txt': {
      const text = markdownToPlainText(markdown);
      if (Platform.OS === 'web') {
        downloadBlob(new Blob([text], { type: 'text/plain' }), `${safeName}.txt`);
      } else {
        await Share.share({ message: text, title: `${safeName}.txt` });
      }
      break;
    }
  }
}

function bufferToBase64(buffer: Buffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
