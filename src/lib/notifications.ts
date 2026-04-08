interface EditNotification {
  documentId: string;
  editedBy: 'user' | 'claude';
  timestamp: Date;
  summary: string;
}

/**
 * Create a notification for Claude edits
 */
export function createClaudeEditNotification(
  documentId: string,
  prompt: string
): EditNotification {
  return {
    documentId,
    editedBy: 'claude',
    timestamp: new Date(),
    summary: `Claude edited based on: "${prompt.substring(0, 50)}..."`,
  };
}

/**
 * Store notification (could be in D1 or sent via websocket)
 */
export async function storeNotification(
  notification: EditNotification,
  env: any
): Promise<void> {
  // For now, just log it
  console.log('Edit notification:', notification);
  
  // TODO: Store in database or send via WebSocket to active clients
}
