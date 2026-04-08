import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';

/**
 * Check if document was recently edited by user
 */
export async function hasRecentUserEdit(
  documentId: string,
  db: any,
  withinSeconds: number = 60
): Promise<boolean> {
  const doc = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .get();
  
  if (!doc) return false;
  
  const lastEditTime = new Date(doc.updatedAt).getTime();
  const now = Date.now();
  const isRecent = (now - lastEditTime) / 1000 < withinSeconds;
  
  return isRecent && doc.lastEditedBy === 'user';
}
