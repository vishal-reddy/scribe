# Getting Started with Scribe

Scribe is your AI-powered writing companion. Write, edit, and collaborate with Claude — on any device.

## Sign Up

1. Open Scribe in your browser or mobile app
2. Enter your email address
3. Check your inbox for a 6-digit verification code
4. Enter the code to create your account

Your account is tied to your email — no passwords needed. Each time you sign in from a new device, we'll send a fresh verification code.

## Your First Document

1. Tap **+** (or "New Document") on the home screen
2. Give your document a title
3. Start writing — the editor works like Notion:
   - Click any block to edit it
   - Use the type bar to switch between headings, paragraphs, lists, quotes, and code blocks
   - Press **Enter** to create a new block
   - Press **Backspace** on an empty block to delete it

## Formatting

Scribe uses Markdown under the hood. You can write naturally and the editor renders it:

| Syntax | Result |
|--------|--------|
| `# Heading` | Large heading |
| `## Heading` | Medium heading |
| `### Heading` | Small heading |
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `` `code` `` | `code` |
| `> quote` | Blockquote |
| `- item` | Bullet list |
| `1. item` | Numbered list |
| `---` | Horizontal rule |

## Working with Claude

Claude is your AI writing assistant. Use the **Claude** tab to:

- **Ask Claude to write**: "Write an introduction to quantum computing"
- **Edit your work**: Select a document, then ask "Simplify the third paragraph"
- **Get suggestions**: "Add examples to illustrate the main points"
- **Create outlines**: "Create an outline for a blog post about remote work"

Quick actions are available when you have a document open:
- Expand section
- Simplify text
- Add examples
- Fix grammar
- Summarize

## Version History

Every edit is tracked. To view history:

1. Open a document
2. Tap the menu (⋯) → **Version History**
3. Browse previous versions
4. Compare changes with the diff viewer
5. Restore any previous version

## Exporting

Share your work:

- **Markdown**: Download the raw `.md` file
- **Share**: Use your device's share sheet to send via email, messages, etc.

## Connecting Claude Desktop / Claude Code

Developers and power users can connect Claude directly via MCP:

1. In Claude Desktop, go to Settings → MCP Servers
2. Add a new server with URL: `https://scribe.sapiagent-proxy.workers.dev/mcp`
3. Set the authorization header: `Authorization: Bearer <your-mcp-token>`
4. Claude can now read and write your Scribe documents directly

## Tips

- Documents auto-save every few seconds
- The sync indicator shows when changes are saved
- Claude's edits appear with a special banner notification
- Use the Artifacts tab to see everything Claude has created
