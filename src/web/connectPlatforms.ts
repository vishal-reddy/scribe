/**
 * Per-platform setup instructions for connecting an AI assistant to a Kecker MCP server.
 *
 * Every Kecker app is a standard remote MCP server (Streamable HTTP, OAuth sign-in), so any assistant that
 * supports remote MCP works. This is the one list of platforms: keep it provider-neutral and keep the same
 * file in every app that serves a /connect page (ovrwhlm-mcp, scribe, didactic, deacon, ...).
 *
 * Menus and plan limits change often; each entry says where to look rather than promising an exact label.
 */

export interface PlatformGuide {
  id: string;
  name: string;
  group: 'chat' | 'dev';
  /** HTML; the only placeholders are {{name}} (a safe server key like "ovrwhlm") and {{url}}. */
  html: string;
}

export const PLATFORM_GUIDES: PlatformGuide[] = [
  {
    id: 'chatgpt', name: 'ChatGPT', group: 'chat',
    html: `<ol>
<li>In ChatGPT open <kbd>Settings</kbd> → <kbd>Connectors</kbd> → <kbd>Advanced</kbd> and turn on <kbd>Developer mode</kbd>. It is limited to some plans, and on Business and Enterprise an admin may need to allow it first.</li>
<li>Back in <kbd>Connectors</kbd> choose <kbd>Create</kbd>. Name it, paste the server URL, and set authentication to <kbd>OAuth</kbd>.</li>
<li>Start a chat, open the <kbd>+</kbd> menu, choose <kbd>Developer mode</kbd> and switch the connector on. Sign in to {{app}} when asked.</li>
</ol>`,
  },
  {
    id: 'claude', name: 'Claude (web, Desktop, mobile)', group: 'chat',
    html: `<ol>
<li>Use claude.ai in a browser or Claude Desktop. Custom connectors can’t be added from the mobile app, but once added they work there too.</li>
<li>Open <kbd>Settings</kbd> → <kbd>Connectors</kbd> (newer versions label it <kbd>Customize</kbd> → <kbd>Connectors</kbd>) and choose <kbd>Add custom connector</kbd>.</li>
<li>Paste the server URL and add it. Sign in to {{app}} when the window opens, then switch the connector on in a chat.</li>
</ol>
<p>The free plan allows one custom connector. On Team and Enterprise an organization owner adds it first, then each member clicks <kbd>Connect</kbd>.</p>`,
  },
  {
    id: 'perplexity', name: 'Perplexity', group: 'chat',
    html: `<ol>
<li>Open <kbd>Settings</kbd> → <kbd>Connectors</kbd> and choose <kbd>+ Custom connector</kbd>, then <kbd>Remote</kbd>. It needs a paid plan, and on Enterprise an admin must allow it.</li>
<li>Enter a name and the server URL, choose <kbd>Streamable HTTP</kbd> if asked, and set authentication to <kbd>OAuth</kbd>.</li>
<li>Finish the {{app}} sign-in in the browser tab, then enable the connector in a thread.</li>
</ol>`,
  },
  {
    id: 'mistral', name: 'Mistral Le Chat', group: 'chat',
    html: `<ol>
<li>In Le Chat open the side panel, then <kbd>Intelligence</kbd> → <kbd>Connectors</kbd>, and choose <kbd>+ Add Connector</kbd>.</li>
<li>Switch to the <kbd>Custom MCP Connector</kbd> tab, enter a name and the server URL, and choose <kbd>Connect</kbd>.</li>
<li>Sign in to {{app}}, then enable the connector in a new chat. Adding one needs an admin on team workspaces.</li>
</ol>`,
  },
  {
    id: 'claude-code', name: 'Claude Code', group: 'dev',
    html: `<pre><code>claude mcp add --transport http {{name}} {{url}}</code></pre>
<p>Then run <kbd>/mcp</kbd> inside a session and choose <kbd>Authenticate</kbd> (or run <code>claude mcp login {{name}}</code> in your shell) to sign in to {{app}}. Check with <code>claude mcp list</code>.</p>`,
  },
  {
    id: 'codex', name: 'OpenAI Codex CLI', group: 'dev',
    html: `<p>Add this to <code>~/.codex/config.toml</code>:</p>
<pre><code>[mcp_servers.{{name}}]
url = "{{url}}"</code></pre>
<p>Then run <code>codex mcp login {{name}}</code> to sign in to {{app}}. <code>codex mcp list</code> shows what is configured.</p>`,
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI', group: 'dev',
    html: `<pre><code>gemini mcp add -s user --transport http {{name}} {{url}}</code></pre>
<p>Restart Gemini CLI and run <kbd>/mcp</kbd> to check the connection. If it asks you to sign in, follow the browser prompt. Prefer editing by hand? Put <code>"{{name}}": { "httpUrl": "{{url}}" }</code> under <code>mcpServers</code> in <code>~/.gemini/settings.json</code>.</p>`,
  },
  {
    id: 'antigravity', name: 'Google Antigravity CLI (agy)', group: 'dev',
    html: `<pre><code>agy mcp add {{name}} {{url}}</code></pre>
<p>The address is recognised as an HTTP server automatically. Run <code>agy mcp list</code> to confirm, then sign in to {{app}} if prompted.</p>`,
  },
  {
    id: 'cursor', name: 'Cursor', group: 'dev',
    html: `<p>Add this to <code>~/.cursor/mcp.json</code> (or <code>.cursor/mcp.json</code> inside one project):</p>
<pre><code>{
  "mcpServers": {
    "{{name}}": { "url": "{{url}}" }
  }
}</code></pre>
<p>Cursor opens a browser tab to sign in to {{app}} the first time a tool is used. Restart Cursor if the server doesn’t show up.</p>`,
  },
  {
    id: 'vscode', name: 'VS Code (GitHub Copilot)', group: 'dev',
    html: `<p>Press <kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>, run <kbd>MCP: Add Server</kbd>, pick <kbd>HTTP</kbd> and paste the URL. Or add this to <code>.vscode/mcp.json</code>:</p>
<pre><code>{
  "servers": {
    "{{name}}": { "type": "http", "url": "{{url}}" }
  }
}</code></pre>
<p>Note the key is <code>servers</code>, not <code>mcpServers</code>. Use Copilot Chat in <kbd>Agent</kbd> mode, trust the server, and sign in to {{app}} when the browser opens.</p>`,
  },
  {
    id: 'windsurf', name: 'Windsurf', group: 'dev',
    html: `<p>Open the MCP config from the Cascade panel (<kbd>…</kbd> menu → MCP config) and add:</p>
<pre><code>{
  "mcpServers": {
    "{{name}}": { "serverUrl": "{{url}}" }
  }
}</code></pre>
<p>Refresh the MCPs list, or restart Windsurf, then sign in to {{app}} when prompted.</p>`,
  },
  {
    id: 'zed', name: 'Zed', group: 'dev',
    html: `<p>Open <kbd>Settings</kbd> → <kbd>AI</kbd> → <kbd>MCP Servers</kbd>, or add this to <code>settings.json</code>:</p>
<pre><code>{
  "context_servers": {
    "{{name}}": { "url": "{{url}}" }
  }
}</code></pre>
<p>Zed starts the sign-in to {{app}} for you. The key must be <code>context_servers</code>.</p>`,
  },
  {
    id: 'other', name: 'Any other MCP client', group: 'dev',
    html: `<p>Add a <strong>remote MCP server</strong> (Streamable HTTP) with the URL above. Sign-in uses standard OAuth, so there is no token or key to copy. If your client only supports local (stdio) servers, bridge it with <code>npx mcp-remote {{url}}</code>.</p>`,
  },
];

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'kecker';
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** Renders the collapsible per-platform guides for [appName] at [mcpUrl]. Escapes everything it interpolates. */
export function renderPlatformGuides(appName: string, mcpUrl: string): string {
  const fill = (html: string) => html
    .replace(/\{\{name\}\}/g, escHtml(slug(appName)))
    .replace(/\{\{url\}\}/g, escHtml(mcpUrl))
    .replace(/\{\{app\}\}/g, escHtml(appName));
  const group = (title: string, g: PlatformGuide['group']) => `<h3 class="platform-group">${title}</h3>` +
    PLATFORM_GUIDES.filter((p) => p.group === g).map((p) =>
      `<details id="${p.id}"><summary>${escHtml(p.name)}</summary><div class="body">${fill(p.html)}</div></details>`,
    ).join('\n');
  return group('Chat apps', 'chat') + '\n' + group('Coding tools and CLIs', 'dev');
}
