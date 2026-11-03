# Writing guidance

Scribe exists to strengthen the writer's own reasoning: their words, in their language, with better typing and speaking
over time. This is how Scribe says so to the assistants people connect to it, and how people shape that for themselves.

## Delivery: trusted channels, nothing hidden

Models are right to distrust instructions that arrive inside tool results, so Scribe uses the channels MCP provides:

| Channel | What it carries |
|---|---|
| Server `instructions` (at `initialize`) | Scribe's purpose and the "how to help the writer" rules (`src/mcp/writingGuidance.ts`) |
| Tool descriptions | Keep the user's words and language when saving or editing (`create_document`, `update_document`) |
| Prompts (user-invoked) | `coach_my_writing`, `say_it_aloud`, `think_it_through`, `use_my_language` |
| `get_writing_guidance` tool | The writer's own current settings, layered (below) |
| `set_guidance_note` tool | Attach or remove a note as guidance, only when the writer asks |

Everything is short, optional, framed around the writer's benefit, and free of anything that overrides the user or the
host or asks the model to hide something. `lintGuidance` and its test enforce that for Scribe's text, and the same lint
rejects shared instructions at save time. `WRITING_GUIDANCE=off` removes the coaching section for a deployment.

## Layers

`default` → the writer's layer for **all notes** → the note **author's** instructions (only if the writer follows them)
→ the writer's layer for **this note**.

- The writer's own layers either *append* to what is above or *replace* it.
- An author's instructions can only append, are labelled with who wrote them, and never override the writer's settings.
- Layers are stored per user (`writing_guidance`), so a layer is only ever shown to the person who wrote it, including on
  shared and unowned legacy notes.
- Guidance given when a note is created is saved with it (`guidance`, `sharedGuidance` on create).

## Notes as guidance

A writer can attach up to three of their own notes (a style guide, a rubric, a glossary) as guidance, either for **all
notes** or for **one note**. The attached note's text is read each time the guidance is resolved, so editing it changes
the guidance, and it is added after the writer's own text for that layer (`guidance_attachments`, keyed by user like the
other layers).

- The writer must be able to read the note, both when attaching and every time it is used. A deleted note, or one that
  stops being shared with them, shows as *unavailable* and contributes nothing.
- A note shared with the writer is labelled as such. It is the writer's choice to attach it, but its author can edit it
  later, so the same transparency lint that guards shared instructions runs on its text each time. A note that fails is
  *blocked* and not used.
- Long notes are cut at 4,000 characters and the writer is told. Attached notes are not followed recursively.
- Clients get the list (title, status) but never the note's text through the guidance API.

## Shared instructions and templates

A note's owner can attach instructions for its readers (`document_author_guidance`), for example a teacher's notes.
Readers see the text first and choose whether their assistant follows it (`guidance_adoptions`). An adoption only counts
for the version the reader saw, so an edit needs a fresh opt-in.

A note can be published as a **template**. Two kinds of copy:

- **Use** (`mode: "use"`): your own working copy. The author's instructions come along **locked** (nobody can edit them in
  the copy), credited to the author, and followed from the start because you reviewed them to ask for the copy. You can
  stop following them at any time.
- **Fork** (`mode: "fork"`): a new template you own. The instructions come along **editable**, credited to you with the
  original author recorded as the source. The original is untouched.

Editing a template afterwards does not rewrite copies that already exist.

## API (mobile apps and web)

```
GET/PUT  /api/guidance                          the writer's layer for all notes   { text, mode: append|replace }
GET/PUT  /api/guidance/documents/:id            the writer's layer for one note
POST     /api/guidance/attachments              { sourceDocumentId }  use a note as guidance for all notes
DELETE   /api/guidance/attachments/:sourceId
POST     /api/guidance/documents/:id/attachments        the same, for one note
DELETE   /api/guidance/documents/:id/attachments/:sourceId
PUT      /api/guidance/documents/:id/author     owner: instructions for readers (empty text removes)
POST     /api/guidance/documents/:id/adopt      { adopt, version }
POST     /api/guidance/documents/:id/template   owner: { template }
POST     /api/guidance/documents/:id/copy       { mode: use|fork, title?, acceptVersion? }
GET      /api/guidance/effective?documentId=    what the assistant will be told
```

The signed-in web page is `/guidance` (plain forms, session cookie, same-origin POSTs only).

## Testing the concept

Unit and API tests cover layering, locking, consent and the lint (`test/lib/writingGuidance.test.ts`,
`test/routes/guidance.test.ts`). Whether models actually relay the guidance is an empirical question, so
`scripts/guidance-eval/` runs fixed scenarios through other models and checks the replies.
