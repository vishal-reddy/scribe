import type { SessionData } from '../lib/session';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[c] || c);
}

export function markdownToHtml(md: string): string {
  if (!md) return '';
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let codeBuffer: string[] = [];
  let inList: 'ul' | 'ol' | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    // Fenced code blocks
    if (rawLine.trim().startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${codeBuffer.map(escapeHtml).join('\n')}</code></pre>`);
        codeBuffer = [];
        inCode = false;
      } else {
        if (inList) {
          out.push(`</${inList}>`);
          inList = null;
        }
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(rawLine);
      continue;
    }

    const trimmed = rawLine.trim();

    // Blank line
    if (!trimmed) {
      if (inList) {
        out.push(`</${inList}>`);
        inList = null;
      }
      continue;
    }

    // Headers
    const hMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      if (inList) {
        out.push(`</${inList}>`);
        inList = null;
      }
      const level = hMatch[1].length;
      out.push(`<h${level}>${formatInline(hMatch[2])}</h${level}>`);
      continue;
    }

    // Blockquotes
    if (trimmed.startsWith('>')) {
      if (inList) {
        out.push(`</${inList}>`);
        inList = null;
      }
      out.push(`<blockquote>${formatInline(trimmed.replace(/^>\s*/, ''))}</blockquote>`);
      continue;
    }

    // Unordered list
    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (inList !== 'ul') {
        if (inList) out.push(`</${inList}>`);
        out.push('<ul>');
        inList = 'ul';
      }
      out.push(`<li>${formatInline(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (inList !== 'ol') {
        if (inList) out.push(`</${inList}>`);
        out.push('<ol>');
        inList = 'ol';
      }
      out.push(`<li>${formatInline(olMatch[1])}</li>`);
      continue;
    }

    // Paragraph
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
    out.push(`<p>${formatInline(trimmed)}</p>`);
  }

  if (inCode) {
    out.push(`<pre><code>${codeBuffer.map(escapeHtml).join('\n')}</code></pre>`);
  }
  if (inList) {
    out.push(`</${inList}>`);
  }

  return out.join('\n');
}

function formatInline(text: string): string {
  let s = escapeHtml(text);
  // Code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Links
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

export function renderPublicDoc(doc: {
  id: string;
  title: string;
  markdown: string;
  created_at: number;
  updated_at: number;
  org_name: string | null;
}): string {
  const words = doc.markdown.trim().split(/\s+/).filter(Boolean).length;
  const updatedDate = new Date(doc.updated_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const htmlContent = markdownToHtml(doc.markdown);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(doc.title || 'Untitled')} — Scribe</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500;600&family=Nunito:wght@700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #FAFAFA;
      --surface: #FFFFFF;
      --border: #E4E4E7;
      --text: #18181B;
      --muted: #71717A;
      --accent: #3A3A3C;
      --accent-hover: #27272A;
      --font-body: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-serif: 'EB Garamond', Georgia, serif;
      --font-mono: ui-monospace, 'SF Mono', Menlo, Monaco, monospace;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: var(--font-body);
      background: var(--bg);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 32px;
      height: 64px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .brand {
      font-family: 'Nunito', sans-serif;
      font-weight: 700;
      font-size: 15px;
      letter-spacing: 0.2em;
      color: var(--text);
      text-decoration: none;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }
    .btn-secondary:hover { background: #F4F4F5; }
    .btn-primary {
      background: var(--accent);
      color: #FAFAFA;
      border: 1px solid var(--accent);
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }
    .btn-primary:hover { background: var(--accent-hover); }
    main {
      flex: 1;
      max-width: 720px;
      width: 100%;
      margin: 0 auto;
      padding: 56px 24px 100px;
    }
    .meta {
      display: flex;
      align-items: center;
      gap: 12px;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 20px;
    }
    .meta-tag {
      background: #F4F4F5;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 500;
    }
    h1.title {
      font-family: var(--font-serif);
      font-size: clamp(36px, 6vw, 48px);
      font-weight: 500;
      line-height: 1.15;
      letter-spacing: -0.01em;
      margin: 0 0 36px;
      color: var(--text);
    }
    article {
      font-size: 17px;
      line-height: 1.7;
      color: #27272A;
    }
    article h1, article h2, article h3, article h4 {
      font-family: var(--font-serif);
      color: var(--text);
      font-weight: 600;
      margin: 32px 0 16px;
    }
    article h1 { font-size: 32px; }
    article h2 { font-size: 26px; }
    article h3 { font-size: 21px; }
    article p { margin: 0 0 20px; }
    article blockquote {
      border-left: 3px solid var(--border);
      padding-left: 20px;
      margin: 24px 0;
      color: var(--muted);
      font-style: italic;
    }
    article ul, article ol {
      padding-left: 24px;
      margin: 0 0 20px;
    }
    article li { margin-bottom: 6px; }
    article code {
      font-family: var(--font-mono);
      font-size: 14px;
      background: #F4F4F5;
      padding: 2px 6px;
      border-radius: 4px;
    }
    article pre {
      background: #18181B;
      color: #F4F4F5;
      padding: 16px;
      border-radius: 10px;
      overflow-x: auto;
      margin: 24px 0;
    }
    article pre code {
      background: transparent;
      padding: 0;
      color: inherit;
    }
    article a {
      color: var(--accent);
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">SCRIBE</a>
    <div class="actions">
      <button class="btn-secondary" onclick="navigator.clipboard.writeText(window.location.href).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy Link',1500)})">Copy Link</button>
      <a href="scribe://documents/${escapeHtml(doc.id)}" class="btn-primary">Open in Scribe App</a>
    </div>
  </header>
  <main>
    <div class="meta">
      ${doc.org_name ? `<span class="meta-tag">${escapeHtml(doc.org_name)}</span>` : ''}
      <span>Updated ${updatedDate}</span>
      <span>•</span>
      <span>${words} words</span>
    </div>
    <h1 class="title">${escapeHtml(doc.title || 'Untitled')}</h1>
    <article>
      ${htmlContent}
    </article>
  </main>
</body>
</html>`;
}

export function renderJoinPage(
  invite: { org_name: string; role: string },
  session: SessionData | null,
  token: string
): string {
  const returnTo = encodeURIComponent(`/join?token=${token}`);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Join ${escapeHtml(invite.org_name)} — Scribe</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com">
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,500;1,400&family=Inter:wght@400;500;600&family=Nunito:wght@700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #FAFAFA;
      --surface: #FFFFFF;
      --border: #E4E4E7;
      --text: #18181B;
      --muted: #71717A;
      --accent: #3A3A3C;
      --font-body: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-serif: 'EB Garamond', Georgia, serif;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: var(--font-body);
      background: var(--bg);
      color: var(--text);
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 40px 32px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 8px 30px rgba(0,0,0,0.06);
    }
    .brand {
      font-family: 'Nunito', sans-serif;
      font-weight: 700;
      font-size: 15px;
      letter-spacing: 0.2em;
      color: var(--text);
      margin-bottom: 24px;
      display: inline-block;
    }
    h1 {
      font-family: var(--font-serif);
      font-size: 32px;
      font-weight: 500;
      margin: 0 0 10px;
      color: var(--text);
    }
    p {
      color: var(--muted);
      font-size: 15px;
      line-height: 1.5;
      margin: 0 0 28px;
    }
    .org-box {
      background: #F4F4F5;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 28px;
      text-align: left;
    }
    .label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      font-weight: 600;
      margin-bottom: 4px;
    }
    .value {
      font-size: 17px;
      font-weight: 600;
      color: var(--text);
    }
    .role {
      font-size: 13px;
      color: var(--muted);
      margin-top: 4px;
      text-transform: capitalize;
    }
    button, a.btn {
      background: var(--accent);
      color: #FAFAFA;
      border: none;
      border-radius: 10px;
      padding: 14px 24px;
      font-size: 15px;
      font-weight: 600;
      width: 100%;
      cursor: pointer;
      display: block;
      text-decoration: none;
      transition: opacity 0.15s;
    }
    button:hover, a.btn:hover { opacity: 0.88; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">SCRIBE</div>
    <h1>Join Workspace</h1>
    <p>You've been invited to collaborate in <strong>${escapeHtml(invite.org_name)}</strong> on Scribe.</p>
    <div class="org-box">
      <div class="label">Workspace</div>
      <div class="value">${escapeHtml(invite.org_name)}</div>
      <div class="role">Role: ${escapeHtml(invite.role)}</div>
    </div>
    ${session ? `
      <form method="POST">
        <input type="hidden" name="token" value="${escapeHtml(token)}"/>
        <button type="submit">Accept & Open Scribe</button>
      </form>
    ` : `
      <a href="/auth/kinde/login?return_to=${returnTo}" class="btn">Sign In to Accept</a>
    `}
  </div>
</body>
</html>`;
}
