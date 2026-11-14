# Organization philosophy

By default Scribe files notes under the Thomistic division of the sciences and arts. A **philosophy** replaces that with your own
plain-language rule for how documents are grouped, for example "Group by client, then by project; keep meeting notes with the
project they belong to."

## Levels and precedence

A philosophy can be set for a **user** (personal), an **organization**, or a **workspace**. For a document in workspace W the one in
effect is the most specific that is set:

1. the workspace's philosophy
2. the workspace's organization's philosophy (shared workspaces only)
3. the signed-in person's own philosophy
4. the built-in Thomistic scheme

Nothing set anywhere means nothing changes: filing behaves exactly as before.

## Who can change what

| Action | Who |
|---|---|
| Set or clear your own philosophy | Anyone |
| Set or clear an organization's or workspace's philosophy | Organization/workspace owners and admins |
| Bulk restructure a shared workspace | Owners and admins |
| Bulk restructure your own personal workspace | You |
| File one of your own notes | Any member |

Organization and workspace text is read by other people's assistants, so it goes through the same transparency check as shared
writing guidance and is limited to 4000 characters.

## MCP tools

Classification is done by your own assistant, not by a server key, so a philosophy is guidance handed to it.

- `get_philosophy`: the one in effect, which level it came from, and each level's text.
- `set_philosophy { scope: user | org | workspace, text }` and `reset_philosophy { scope }`. Org and workspace need an owner or admin.
- `list_categories`: now returns the philosophy in effect (or the default taxonomy).
- `file_document { documentId, category }`: with a custom philosophy, `category` is a folder path of up to 4 levels, e.g.
  `Projects/Alpha`. Missing folders are created. The default scheme still takes a taxonomy leaf.
- `restructure_documents`: step 1, call with a `command` (and optionally a one-off `philosophy`) to get the workspace's documents and
  where each sits; step 2, call with `moves: [{ documentId, path }]`. All moves in a call apply together or not at all; the reply says
  how many moved. At most 200 moves per call (page with `offset`).

## REST (for the app settings screens)

- `GET /api/philosophy[?workspaceId=]`: every layer, what the caller can edit (`canEdit`), and what is in effect (including the default).
- `PUT /api/philosophy { scope, text, workspaceId? }` and `DELETE /api/philosophy?scope=&workspaceId=`.

Data lives in the `philosophies` table (migration `0015_philosophies.sql`).
