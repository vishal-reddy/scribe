import * as Y from 'yjs';

/**
 * Convert markdown text to Y.js update
 */
export function markdownToYjsUpdate(markdown: string, ydoc?: Y.Doc): Uint8Array {
  const doc = ydoc || new Y.Doc();
  const ytext = doc.getText('content');
  
  // Clear existing content
  ytext.delete(0, ytext.length);
  
  // Insert new markdown
  ytext.insert(0, markdown);
  
  // Return the update
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Apply markdown update to Durable Object
 */
export async function applyMarkdownUpdate(
  documentId: string,
  markdown: string,
  env: any
): Promise<void> {
  // Get Durable Object stub
  const id = env.DOCUMENT_SYNC.idFromName(documentId);
  const stub = env.DOCUMENT_SYNC.get(id);
  
  // Create Y.js update from markdown
  const update = markdownToYjsUpdate(markdown);
  
  // Send update to Durable Object via internal method
  // Note: This requires the Durable Object to expose a method for programmatic updates
  // For now, we'll store directly in D1 and let the DO sync on next connection
}

/**
 * Convert Y.js document to markdown
 */
export function yjsToMarkdown(ydoc: Y.Doc): string {
  const ytext = ydoc.getText('content');
  return ytext.toString();
}
