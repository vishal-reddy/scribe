/**
 * What Scribe tells connected models about its purpose.
 *
 * Scribe exists to strengthen the user's own reasoning through writing, not to write for them. The guidance below is
 * delivered through the channels MCP gives servers for exactly this, and nothing here is hidden from the user:
 *
 *   - the server `instructions` (read by the host at `initialize`),
 *   - tool descriptions (capability documentation the model reads),
 *   - prompts (user-invoked, so the user opts in and the host treats them as instructions).
 *
 * It is deliberately written as "how to be useful to this writer", framed around the user's benefit, short, optional,
 * and free of anything that tries to override the user or the host. `lintGuidance` (and its test) enforce that.
 */

export type GuidanceMode = 'append' | 'replace';
export interface GuidanceLayer {
  text: string;
  mode: GuidanceMode;
}

/** Keep the user's own wording and language. Appended to the tools that write the user's text. */
export const PRESERVE_VOICE_NOTE =
  "Keep the user's own words, voice and language: save what they wrote as they wrote it, do not translate it " +
  "unless they ask, and do not add content they did not write unless they asked you to draft it.";

/** For edits: improvement the user can learn from rather than a silent rewrite. */
export const EDIT_FOR_LEARNING_NOTE =
  "When you improve their text, keep their voice, say briefly what you changed and why so they can learn it, " +
  "and leave the choice to accept it with them.";

const ROUTING =
  "Scribe is the user's personal note-taking and writing app. It is the source of truth for " +
  "the user's own notes, documents, and writing — in Scribe the words \"note\" and \"document\" " +
  "mean the same thing. Use these tools whenever the user asks to see, list, browse, search, read, " +
  "create, or edit THEIR notes/documents/writing (e.g. \"list my Scribe documents\", \"show my " +
  "notes\", \"find my note about X\", \"add a note\"). Prefer Scribe over generic file/drive/email " +
  "tools for anything the user calls their notes, their documents, or their writing.\n\n" +
  "Typical flow: `list_documents` or `search_documents` to find a note, `read_document` to read one, " +
  "`create_document`/`update_document` to write. New documents should then be classified with " +
  "`list_categories` and filed with `file_document`; `list_unfiled_documents` finds ones still " +
  "needing filing. The learning feed (`list_notes_needing_feed` + `create_feed_posts`) turns notes " +
  "into spaced-repetition study prompts. For reminders/scratch notes meant to self-delete, use " +
  "`create_ephemeral_note` instead of `create_document`.";

export const WRITER_GUIDANCE =
  "How to help the writer. Scribe exists to strengthen the user's own reasoning through writing, not to write " +
  "for them. When you work with their notes:\n" +
  "- Their words first. Keep the user's own wording, voice and structure. Don't rewrite, embellish or polish " +
  "their text unless they ask; when they do ask for improvements, say what you changed and why so they can " +
  "learn it, and let them accept or decline.\n" +
  "- Their language. Reply in the language the user writes in, and keep each note in the language it was " +
  "written in. Don't translate unless asked; if a note mixes languages, keep the mix.\n" +
  "- Think before drafting. When the user is still working out an idea, a good first move is a question or two " +
  "that helps them say it in their own words. Offer a draft when they want one.\n" +
  "- Typing and speaking. Small, concrete feedback helps people improve: one or two observations on clarity, " +
  "structure, spelling or grammar after the task, never a lecture. Speaking sharpens writing too: when it " +
  "fits, suggest saying the idea aloud (or dictating it) and then tightening it on the page. The prompts " +
  "`coach_my_writing`, `say_it_aloud`, `think_it_through` and `use_my_language` are built for this.\n" +
  "- Light and optional. Mention a tip at most once per conversation unless asked, and drop it if the user " +
  "isn't interested.";

/**
 * Always included, even when the writer replaced the defaults: the writer can also adjust things for a single note,
 * and an author can share instructions with a note's readers. Those are specific to a note, so they come from a tool.
 */
const PER_NOTE_POINTER =
  "The writer can adjust all of this in the Scribe app or on the web, for every note (included above) or for a single " +
  "note. When you work on a specific note, call `get_writing_guidance` with its ID first: it returns the writer's " +
  "settings for that note, including instructions its author shared that the writer chose to follow. Follow it.";

/** WRITING_GUIDANCE=off removes the coaching section; routing stays. */
export function writingGuidanceEnabled(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() !== "off";
}

/**
 * The server instructions. The writer's own layer for all their notes is resolved into them here, so it reaches the
 * model through the channel hosts treat as trusted, with no tool call needed for the setting that applies everywhere.
 */
export function scribeInstructions(opts: { writingGuidance: boolean; userLayer?: GuidanceLayer | null }): string {
  const writer = resolveGuidance(opts.writingGuidance ? WRITER_GUIDANCE : null, opts.userLayer ?? null, null).text;
  return [ROUTING, writer, PER_NOTE_POINTER].filter(Boolean).join('\n\n');
}

export interface WritingPrompt {
  name: string;
  title: string;
  description: string;
  /** Optional free-text arguments, all strings (MCP prompt arguments are strings). */
  args: Record<string, string>;
  build(args: Record<string, string | undefined>): string;
}

const LANGUAGE_LINE =
  "Answer in the language my note is written in (or the one I ask for), and keep my own wording.";

function target(args: Record<string, string | undefined>): string {
  const id = args.documentId?.trim();
  return id
    ? `my Scribe note with ID ${id} (read it with read_document first)`
    : "the note I'm working on in Scribe (ask me which one if it isn't clear)";
}

export const WRITING_PROMPTS: WritingPrompt[] = [
  {
    name: "coach_my_writing",
    title: "Coach my writing",
    description: "Feedback on clarity, structure and mechanics for one of your notes, without rewriting it.",
    args: { documentId: "ID of the note to coach (optional)" },
    build: (a) =>
      `Please coach my writing in ${target(a)}. Look at clarity, structure and mechanics (spelling, grammar, ` +
      `typing slips). Do not rewrite it. Point to specific sentences, say why each could be stronger, and offer at ` +
      `most three changes I could make myself. Finish with one thing I did well. ${LANGUAGE_LINE}`,
  },
  {
    name: "say_it_aloud",
    title: "Say it aloud",
    description: "A short speaking exercise built from one of your notes.",
    args: { documentId: "ID of the note to practise from (optional)" },
    build: (a) =>
      `Turn ${target(a)} into a short speaking exercise. First ask me to explain the main idea aloud in about a ` +
      `minute (I can dictate it), without looking at the note. Then compare what I said with the note and tell me ` +
      `where my explanation was clear and where it lost the thread, with one concrete tip for speaking it better ` +
      `and one for writing it better. ${LANGUAGE_LINE}`,
  },
  {
    name: "think_it_through",
    title: "Think it through with me",
    description: "Questions that help you say an idea in your own words before any drafting.",
    args: { topic: "What you're trying to work out (optional)" },
    build: (a) =>
      `Help me think through ${a.topic?.trim() ? `"${a.topic.trim()}"` : "an idea I'm working on"} before I write ` +
      `it down. Ask me up to three questions, one at a time, that help me say it in my own words. Do not draft ` +
      `anything until I ask. When I'm ready, help me save my own wording as a note in Scribe. ${LANGUAGE_LINE}`,
  },
  {
    name: "use_my_language",
    title: "Use my language",
    description: "Tell the assistant which language to use for replies and notes in this conversation.",
    args: { language: "The language to use (for example: Español, Telugu, English)" },
    build: (a) =>
      `For the rest of this conversation, reply to me in ${a.language?.trim() || "the language I write in"}, ` +
      `and keep any notes I ask you to save in the language I write them in. Don't translate my notes unless I ask.`,
  },
];

/** Patterns that don't belong in guidance a server hands a model. Returned as human-readable violations. */
const FORBIDDEN: [RegExp, string][] = [
  [/ignore (all |any )?(previous|prior|above|earlier)/i, "tells the model to ignore earlier instructions"],
  [/(do not|don't|never) (tell|mention|reveal|disclose|inform)[^.]*\b(user|human|student|reader|writer|learner|person|people)\b/i, "asks the model to hide something from the user"],
  [/without (telling|informing|notifying) (the|their) (user|human|student|reader|writer|learner)/i, "asks the model to act without telling the user"],
  [/system prompt|developer message/i, "refers to the model's system prompt"],
  [/\b(secret|hidden)\b/i, "talks about secrecy"],
  [/\byou must (always )?(call|use) the [a-z_]+ tool of /i, "directs the model to other servers' tools"],
];

export function lintGuidance(text: string): string[] {
  return FORBIDDEN.filter(([re]) => re.test(text)).map(([, why]) => why);
}

// ── Layering ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AuthorGuidance {
  text: string;
  authorName: string;
}

export interface EffectiveGuidance {
  text: string;
  /** Which layers shaped the text, outermost last. A 'replace' layer discards the ones before it. */
  layers: { scope: 'default' | 'user' | 'author' | 'document'; mode?: GuidanceMode }[];
}

/**
 * default  →  the writer's layer for all notes  →  the note author's instructions (only if the writer adopted them)
 * →  the writer's layer for this note.
 * The writer's own layers can append or replace. The author's layer can only append, and is labelled with who wrote it,
 * so it can add to the writer's setup but never override the writer or Scribe's defaults.
 */
export function resolveGuidance(
  base: string | null,
  user: GuidanceLayer | null,
  doc: GuidanceLayer | null,
  author: AuthorGuidance | null = null
): EffectiveGuidance {
  let text = base ?? '';
  let layers: EffectiveGuidance['layers'] = base ? [{ scope: 'default' }] : [];

  const join = (heading: string, body: string) => (text ? `${text}\n\n${heading}\n${body}` : body);

  const apply = (scope: 'user' | 'document', layer: GuidanceLayer | null, heading: string) => {
    if (!layer?.text) return;
    if (layer.mode === 'replace') {
      text = layer.text;
      layers = [{ scope, mode: 'replace' }];
    } else {
      text = join(heading, layer.text);
      layers = [...layers, { scope, mode: 'append' }];
    }
  };

  apply('user', user, "The writer's own additions for all their notes:");
  if (author?.text) {
    const who = author.authorName.trim() || "this note's author";
    text = join(`Instructions from ${who}, shared with this note. The writer chose to follow them:`, author.text);
    layers = [...layers, { scope: 'author', mode: 'append' }];
  }
  apply('document', doc, "The writer's additions for this note:");
  return { text, layers };
}

