import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from './middleware/request-id';
import { structuredLogger } from './middleware/logger';
import { errorHandler } from './middleware/error-handler';
import { authMiddleware } from './middleware/auth';
import { claudeRateLimit, documentRateLimit, generalRateLimit } from './middleware/rate-limit';
import { bodySizeLimit, sanitizeInput } from './middleware/sanitize';
import health from './routes/health';
import sync from './routes/sync';
import documents from './routes/documents';
import tags from './routes/tags';
import claude from './routes/claude';
import auth from './routes/auth';
import { oauthRoute } from './routes/oauth';
import { webAuthRoute } from './routes/web-auth';
import { ScribeMCP } from './mcp/scribe-mcp';
import { authenticateAccessToken, authorizationServerMetadata, protectedResourceMetadata } from './lib/oauth';
import { readSession } from './lib/session';
import { renderConnectPage } from './web/connectPage';
import type { SessionData } from './lib/session';
import type { Env } from './types';

// ── Landing page ──────────────────────────────────────────────────────────────

const _esc = (s: string) =>
  s.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c] || c);

function renderLandingPage(session: SessionData | null): string {
  const origin = 'https://scribe.kecker.co';

  const navRight = session
    ? `<span class="nav-email">${_esc(session.email)}</span><a href="/auth/logout" class="nav-ghost">Sign out</a>`
    : `<a href="/auth/login" class="nav-link">Sign in</a><a href="/auth/register" class="nav-btn">Get started</a>`;

  const heroCta = session
    ? `<div class="connect-section">
        <p class="connect-label">MCP Server URL</p>
        <div class="connect-box">
          <code class="connect-url">${origin}/mcp</code>
          <button class="copy-btn" onclick="navigator.clipboard.writeText('${origin}/mcp').then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})">Copy</button>
        </div>
        <p class="connect-hint">Add this URL to Claude Desktop, claude.ai, or any MCP-compatible client.</p>
      </div>`
    : `<div class="hero-cta">
        <a href="/auth/register" class="btn-primary">Create account</a>
        <a href="/auth/login" class="btn-secondary">Sign in</a>
      </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Scribe — Documents for Claude</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@400;500;600&family=Nunito:wght@700&display=swap" rel="stylesheet">
<style>
:root{--bg:#FAFAFA;--surface:#FFFFFF;--surface-border:#E4E4E7;--surface-hover:#F4F4F5;--text:#18181B;--muted:#71717A;--accent:#3A3A3C;--font:'Inter',-apple-system,sans-serif}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:var(--font);background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;flex-direction:column}
a{color:inherit}
nav{display:flex;align-items:center;justify-content:space-between;padding:0 40px;height:64px;border-bottom:1px solid var(--surface-border);flex-shrink:0}
.brand{font-family:'Nunito',sans-serif;font-weight:700;font-size:15px;letter-spacing:0.2em;color:var(--text);text-decoration:none}
.nav-right{display:flex;align-items:center;gap:16px}
.nav-email{color:var(--muted);font-size:14px}
.nav-link{color:var(--muted);font-size:14px;font-weight:500;text-decoration:none}
.nav-link:hover{color:var(--text)}
.nav-btn{background:var(--accent);color:var(--bg);border-radius:8px;padding:8px 18px;font-size:14px;font-weight:600;text-decoration:none;transition:opacity .15s}
.nav-btn:hover{opacity:0.85}
.nav-ghost{background:transparent;border:1px solid var(--surface-border);color:var(--muted);border-radius:8px;padding:7px 14px;font-size:13px;font-weight:500;text-decoration:none}
.nav-ghost:hover{color:var(--text)}
main{flex:1}
.hero{max-width:760px;margin:88px auto 96px;padding:0 40px;text-align:center}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted);margin:0 0 28px}
h1{font-family:'EB Garamond',serif;font-size:clamp(56px,9vw,96px);font-weight:500;line-height:1.0;margin:0 0 24px;letter-spacing:-0.01em;color:var(--text)}
h1 em{font-style:italic}
.sub{font-size:18px;color:var(--muted);line-height:1.65;margin:0 auto 44px;max-width:500px}
.hero-cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.btn-primary{background:var(--accent);color:var(--bg);border-radius:10px;padding:14px 28px;font-size:16px;font-weight:600;text-decoration:none;box-shadow:0 4px 20px rgba(58,58,60,0.22);transition:transform .15s}
.btn-primary:hover{transform:scale(1.02)}
.btn-secondary{background:var(--surface);color:var(--text);border:1px solid var(--surface-border);border-radius:10px;padding:14px 28px;font-size:16px;font-weight:500;text-decoration:none;transition:background .15s}
.btn-secondary:hover{background:var(--surface-hover)}
.connect-section{max-width:460px;margin:0 auto;text-align:left}
.connect-label{font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.connect-box{display:flex;align-items:center;background:var(--surface);border:1px solid var(--surface-border);border-radius:12px;padding:14px 16px;gap:12px}
.connect-url{font-family:'SF Mono','Fira Code',ui-monospace,monospace;font-size:13px;color:var(--accent);flex:1;word-break:break-all}
.copy-btn{background:var(--accent);color:var(--bg);border:none;border-radius:8px;padding:7px 14px;font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:opacity .15s}
.copy-btn:hover{opacity:0.85}
.connect-hint{font-size:13px;color:var(--muted);margin:10px 0 0;line-height:1.55}
.divider{max-width:900px;margin:0 auto;padding:0 40px;display:flex;align-items:center;gap:16px;margin-bottom:40px}
.divider-text{font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.divider::before,.divider::after{content:'';flex:1;height:1px;background:var(--surface-border)}
.features{max-width:900px;margin:0 auto 96px;padding:0 40px}
.features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}
.feature-card{background:var(--surface);border:1px solid var(--surface-border);border-radius:16px;padding:24px}
.feature-icon{width:38px;height:38px;border-radius:10px;background:var(--surface-hover);border:1px solid var(--surface-border);display:flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:19px;line-height:1}
.feature-card h3{font-size:15px;font-weight:600;margin:0 0 8px;letter-spacing:-0.01em}
.feature-card p{font-size:13px;color:var(--muted);margin:0;line-height:1.6}
footer{border-top:1px solid var(--surface-border);padding:28px 40px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.footer-brand{font-family:'Nunito',sans-serif;font-weight:700;font-size:12px;letter-spacing:0.18em;color:var(--muted);text-decoration:none}
.footer-links{display:flex;gap:20px}
.footer-links a{font-size:13px;color:var(--muted);text-decoration:none}
.footer-links a:hover{color:var(--text)}
@media(max-width:640px){nav{padding:0 20px}.hero,.features{padding:0 20px}.hero{margin-top:56px;margin-bottom:64px}h1{font-size:clamp(44px,12vw,72px)}footer{padding:24px 20px;flex-direction:column;gap:12px;text-align:center}}
</style>
</head>
<body>
<nav>
  <a href="/" class="brand">SCRIBE</a>
  <div class="nav-right">${navRight}</div>
</nav>
<main>
  <div class="hero">
    <p class="eyebrow">Document Server · MCP</p>
    <h1>Your notes,<br><em>inside</em> Claude.</h1>
    <p class="sub">A personal document editor with a built-in MCP server. Let Claude read, write, and search your writing from any conversation.</p>
    ${heroCta}
  </div>
  <div class="divider"><span class="divider-text">What you get</span></div>
  <div class="features">
    <div class="features-grid">
      <div class="feature-card">
        <div class="feature-icon">✦</div>
        <h3>Documents</h3>
        <p>Write and organize your thoughts with full hierarchy. Nested pages, rich text, version history.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">⌘</div>
        <h3>MCP Access</h3>
        <p>Let Claude read and write your documents directly. No copy-paste, no context switching.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">↻</div>
        <h3>Version History</h3>
        <p>Every change is tracked. Create named snapshots and restore any previous version.</p>
      </div>
    </div>
  </div>
</main>
<footer>
  <a href="/" class="footer-brand">SCRIBE</a>
  <div class="footer-links">
    <a href="/health">Status</a>
    <a href="/.well-known/oauth-authorization-server">OAuth</a>
    <a href="/auth/login">Sign in</a>
  </div>
</footer>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

app.use('*', requestId);
app.use('*', structuredLogger);

app.use('*', async (c, next) => {
  const allowedRaw = c.env.ALLOWED_ORIGINS;
  const origins = allowedRaw
    ? allowedRaw.split(',').map((o) => o.trim())
    : c.env.ENVIRONMENT === 'production'
      ? ['https://scribe.kecker.co']
      : ['http://localhost:8081', 'http://localhost:19006', 'http://localhost:8787'];

  return cors({
    origin: (origin) => {
      if (origins.includes('*')) return origin || '*';
      return origins.includes(origin) ? origin : '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'CF-Authorization', 'X-Request-ID', 'X-API-Key', 'X-User-Email'],
    exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
    maxAge: 86400,
    credentials: true,
  })(c, next);
});

// Security headers — disable CSP and CORP for API routes (conflicts with CORS)
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
  })
);

app.use('*', bodySizeLimit());

app.get('/', async (c) => {
  const session = await readSession(c);
  return c.html(renderLandingPage(session));
});

// Public "Connect Claude" setup guide (no auth — it's how new users get started).
app.get('/connect', (c) => c.html(renderConnectPage()));

app.route('/', health);

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/api/auth/request-otp' || path === '/api/auth/verify-otp') {
    return next();
  }
  return authMiddleware(c, next);
});

app.use('/api/*', generalRateLimit);
app.use('/api/*', sanitizeInput);

app.get('/api/user', (c) => {
  return c.json({
    userId: c.get('userId'),
    email: c.get('userEmail'),
    name: c.get('userName'),
  });
});

app.route('/api/sync', sync);
app.route('/api/auth', auth);
app.use('/api/documents/*', documentRateLimit);
app.route('/api/documents', documents);
app.route('/api/tags', tags);
app.use('/api/claude/*', claudeRateLimit);
app.route('/api/claude', claude);
app.route('/auth', webAuthRoute);
app.route('/oauth', oauthRoute);

app.onError(errorHandler);
app.notFound((c) => c.json({ error: 'Not found' }, 404));

const mcpHandler = ScribeMCP.serve('/mcp', { binding: 'SCRIBE_MCP' });

async function validateMcpAuth(request: Request, env: Env): Promise<Response | null> {
  if (env.ENVIRONMENT && env.ENVIRONMENT !== 'production') {
    return null;
  }

  const authHeader = request.headers.get('Authorization') ?? '';
  const bearerToken = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1];

  if (bearerToken) {
    if (env.MCP_AUTH_TOKEN && bearerToken === env.MCP_AUTH_TOKEN) {
      return null;
    }
    const info = await authenticateAccessToken(env.DB, env.OAUTH_PEPPER, bearerToken);
    if (info) return null;
  }

  const origin = new URL(request.url).origin;
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Unauthorized: provide Authorization: Bearer <token> header',
      },
      id: null,
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="${origin}", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      },
    }
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const origin = url.origin;

    if (url.pathname === '/.well-known/oauth-protected-resource') {
      return new Response(
        JSON.stringify(protectedResourceMetadata(origin)),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return new Response(
        JSON.stringify(authorizationServerMetadata(origin)),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.pathname.startsWith('/mcp')) {
      const authError = await validateMcpAuth(request, env);
      if (authError) return authError;
      return mcpHandler.fetch(request, env, ctx);
    }

    return app.fetch(request, env, ctx);
  },
};

export { app };
export { DocumentSync } from './durable-objects/DocumentSync';
export { ScribeMCP } from './mcp/scribe-mcp';
