import { and, eq, isNull, sql, or } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { Db } from './notes';

/**
 * Auto-organization of documents into the Thomistic division of the sciences
 * and arts (Aquinas, In Boethii De Trinitate q.5; the liberal and mechanical
 * arts after Hugh of St. Victor's Didascalicon; sacra doctrina).
 *
 * The *classification decision* is made by Claude through the MCP server — i.e.
 * using the user's Claude subscription, not a server-side API key. This module
 * owns only the *filing mechanics*: validating a chosen category and placing the
 * document under a folder for that leaf (nested beneath its division). Folders
 * are ordinary documents marked createdBy 'system', so they appear in the
 * hierarchy tree like any other folder.
 */

interface Leaf {
  /** The leaf category — also the folder title. Unique across the tree. */
  category: string;
  /** Parent division folder, or undefined for a top-level science/art. */
  division?: string;
  /** One-line guidance for the classifier (Claude, via MCP). */
  hint: string;
}

/** The classification leaves. Category names double as folder titles. */
export const THOMISTIC_TAXONOMY: Leaf[] = [
  {
    category: 'Sacred Theology',
    hint: 'Revealed theology, Scripture, doctrine, liturgy, prayer, the spiritual life — God as known through faith.',
  },
  // Speculative sciences — knowledge for its own sake, by degree of abstraction.
  {
    category: 'Natural Philosophy',
    division: 'Speculative Sciences',
    hint: 'The physical and living world: physics, biology, chemistry, cosmology, ecology, the empirical sciences.',
  },
  {
    category: 'Mathematics',
    division: 'Speculative Sciences',
    hint: 'Quantity and formal structure: arithmetic, geometry, algebra, statistics, computation and number theory.',
  },
  {
    category: 'Metaphysics',
    division: 'Speculative Sciences',
    hint: 'Being as being, first principles, causality, the soul, ontology, God as known by natural reason.',
  },
  // Practical sciences — knowledge ordered to action.
  {
    category: 'Ethics',
    division: 'Practical Sciences',
    hint: 'The good life and virtue of the individual; moral philosophy of personal conduct and character.',
  },
  {
    category: 'Economics',
    division: 'Practical Sciences',
    hint: 'Governance of the household and estate; management of personal and domestic resources, finance, work.',
  },
  {
    category: 'Politics',
    division: 'Practical Sciences',
    hint: 'Governance of the community: law, the state, justice, political order, civic and social life.',
  },
  // The instrument of reason.
  {
    category: 'Logic',
    hint: 'The art of reasoning itself: argument, inference, dialectic, method, proof.',
  },
  // The liberal arts (trivium/quadrivium beyond what the sciences above cover).
  {
    category: 'Grammar',
    division: 'Liberal Arts',
    hint: 'Language and letters: writing, philology, the structure and correct use of language.',
  },
  {
    category: 'Rhetoric',
    division: 'Liberal Arts',
    hint: 'Persuasion and eloquence: speech, composition, style, argumentation for effect.',
  },
  {
    category: 'Music',
    division: 'Liberal Arts',
    hint: 'Harmony and proportion in sound: the theory, practice, and appreciation of music.',
  },
  {
    category: 'Astronomy',
    division: 'Liberal Arts',
    hint: 'The heavens and celestial motion; observational astronomy and the measurement of time.',
  },
  // The mechanical arts — productive crafts ordered to making and provision.
  {
    category: 'Medicine',
    division: 'Mechanical Arts',
    hint: 'Health, the body, healing; medical, clinical, and therapeutic arts.',
  },
  {
    category: 'Agriculture',
    division: 'Mechanical Arts',
    hint: 'Cultivation, husbandry, food production, the land and growing things.',
  },
  {
    category: 'Architecture',
    division: 'Mechanical Arts',
    hint: 'Building and making: construction, engineering, design of structures, tools, and machines.',
  },
  {
    category: 'Commerce',
    division: 'Mechanical Arts',
    hint: 'Trade, navigation, exchange, business, markets, and the moving of goods.',
  },
  {
    category: 'Fabric & Craft',
    division: 'Mechanical Arts',
    hint: 'Making of goods: textiles, manufacture, handcraft, and the productive trades.',
  },
  {
    category: 'Theatrics',
    division: 'Mechanical Arts',
    hint: 'The performing and recreational arts: drama, games, entertainment, sport, leisure.',
  },
  {
    category: 'Hunting & Provision',
    division: 'Mechanical Arts',
    hint: 'Hunting, fishing, foraging, cooking; the provisioning and preparing of food.',
  },
];

/** The set of valid leaf category names. */
export const TAXONOMY_CATEGORIES: string[] = THOMISTIC_TAXONOMY.map((l) => l.category);

/** A human/LLM-readable rendering of the taxonomy with hints. */
export function taxonomyList(): string {
  return THOMISTIC_TAXONOMY
    .map((l) => `- ${l.category}${l.division ? ` [${l.division}]` : ''}: ${l.hint}`)
    .join('\n');
}

/** Guidance string embedded in MCP tool descriptions / responses so Claude classifies consistently. */
export const TAXONOMY_GUIDANCE =
  'Classify the document into exactly one leaf of the Thomistic division of the sciences and arts, ' +
  'then file it with file_document. When a document is theoretical or expository about a subject, ' +
  'prefer the speculative science; when it is about a practice or craft, prefer the corresponding art.\n\n' +
  'Categories:\n' +
  taxonomyList();

function ownerFilter(userId: string | null | undefined) {
  if (!userId) return isNull(schema.documents.userId);
  return or(eq(schema.documents.userId, userId), isNull(schema.documents.userId));
}

/** Resolve a possibly-loose category string to a canonical leaf, or null. */
export function resolveCategory(input: string): Leaf | null {
  const raw = input.trim().replace(/[.\s]+$/, '');
  const exact = THOMISTIC_TAXONOMY.find((l) => l.category === raw);
  if (exact) return exact;
  const lc = raw.toLowerCase();
  return THOMISTIC_TAXONOMY.find((l) => l.category.toLowerCase() === lc) ?? null;
}

/** Find an existing system folder by title for this owner, or create one. */
async function findOrCreateFolder(
  db: Db,
  title: string,
  parentId: string | null,
  userId: string | null,
): Promise<string> {
  const existing = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(and(eq(schema.documents.title, title), eq(schema.documents.createdBy, 'system'), ownerFilter(userId)))
    .get();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.documents).values({
    id,
    title,
    content: '',
    markdown: '',
    createdAt: now,
    updatedAt: now,
    createdBy: 'system',
    lastEditedBy: 'system',
    userId,
    parentId,
  } as schema.NewDocument);
  return id;
}

export interface FileResult {
  category: string;
  folderId: string;
  divisionId: string | null;
}

/**
 * File a document under the folder for the given taxonomy category, creating the
 * leaf folder (and its division folder) if needed. Returns null if the category
 * is unrecognized or the document does not exist / is not owned by this user.
 */
export async function fileDocumentInCategory(
  db: Db,
  documentId: string,
  category: string,
  userId: string | null,
): Promise<FileResult | null> {
  const leaf = resolveCategory(category);
  if (!leaf) return null;

  const doc = await db
    .select({ id: schema.documents.id, userId: schema.documents.userId })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .get();
  if (!doc) return null;
  if (userId && doc.userId && doc.userId !== userId) return null;

  const owner = userId ?? doc.userId ?? null;
  const divisionId = leaf.division ? await findOrCreateFolder(db, leaf.division, null, owner) : null;
  const folderId = await findOrCreateFolder(db, leaf.category, divisionId, owner);

  await db
    .update(schema.documents)
    .set({ parentId: folderId, updatedAt: new Date() })
    .where(eq(schema.documents.id, documentId));

  return { category: leaf.category, folderId, divisionId };
}

/**
 * List documents that have not yet been filed under any folder (parentId NULL)
 * and are not themselves system folders — i.e. the unsorted inbox Claude can
 * organize in an MCP session. Excludes the taxonomy folders themselves.
 */
export async function listUnfiledDocuments(db: Db, userId: string | null, limit = 50) {
  return db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      markdown: schema.documents.markdown,
      updatedAt: schema.documents.updatedAt,
    })
    .from(schema.documents)
    .where(
      and(
        isNull(schema.documents.parentId),
        sql`${schema.documents.createdBy} != 'system'`,
        ownerFilter(userId),
      ),
    )
    .orderBy(sql`${schema.documents.updatedAt} DESC`)
    .limit(limit);
}
