import type { Context } from 'hono';
import { isLocalDev } from './lib/env';
import { verifyDevAutomationToken } from './lib/devAutomation';
import { copyDocument } from './lib/guidanceCopy';
import { renderGuidancePage, type GuidancePageData } from './web/guidancePage';
import { getDocumentPermission } from './lib/documentShares';
import { resolveScope } from './lib/orgs';
import {
  GUIDANCE_MAX_LENGTH,
  LockedGuidanceError,
  authorGuidanceFor,
  isTemplate,
  setTemplate,
  cleanGuidanceText,
  defaultGuidance,
  effectiveGuidance,
  getGuidanceLayer,
  parseGuidanceMode,
  setAdoption,
  setAuthorGuidance,
  setGuidanceLayer,
  validateAuthorText,
} from './lib/writingGuidance';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from './middleware/request-id';
import { structuredLogger } from './middleware/logger';
import { errorHandler } from './middleware/error-handler';
import { authMiddleware, timingSafeEqual } from './middleware/auth';
import { claudeRateLimit, documentRateLimit, generalRateLimit } from './middleware/rate-limit';
import { bodySizeLimit, sanitizeInput } from './middleware/sanitize';
import health from './routes/health';
import sync from './routes/sync';
import documents from './routes/documents';
import feed from './routes/feed';
import tags from './routes/tags';
import settings from './routes/settings';
import { guidance } from './routes/guidance';
import orgs from './routes/orgs';
import claude from './routes/claude';
import auth from './routes/auth';
import { oauthRoute } from './routes/oauth';
import { webAuthRoute } from './routes/web-auth';
import { ScribeMCP, type ScribeMcpProps } from './mcp/scribe-mcp';
import { authenticateAccessToken, authorizationServerMetadata, protectedResourceMetadata } from './lib/oauth';
import { isKindeJwt, verifyKindeAccessToken, resolveAndUpsertKindeUser, userIdForIdentity } from './lib/kinde';
import { readSession } from './lib/session';
import { lookupOrgInvite, acceptOrgInvite } from './lib/orgInvites';
import { expireEphemeralDocuments } from './services/ephemeral';
import { renderConnectPage, SCRIBE_CONNECT } from './web/connectPage';
import { appBaseUrl } from './lib/urls';
import { renderPublicDoc, renderJoinPage } from './web/reader';
import type { SessionData } from './lib/session';
import type { Env } from './types';

// ── Landing page ──────────────────────────────────────────────────────────────

const _esc = (s: string) =>
  s.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c] || c);

function renderLandingPage(session: SessionData | null, origin: string): string {

  const navRight = session
    ? `<a href="/connect" class="nav-link">Connect Claude</a><a href="/guidance" class="nav-link">Writing guidance</a><span class="nav-email">${_esc(session.email)}</span><a href="/auth/logout" class="nav-ghost">Sign out</a>`
    : `<a href="/connect" class="nav-link">Connect Claude</a><a href="/auth/kinde/login" class="nav-link">Sign in</a><a href="/auth/kinde/login" class="nav-btn">Get started</a>`;

  const heroCta = session
    ? `<a href="/connect" class="btn-primary connect-cta">Connect Claude to Scribe →</a>
       <div class="connect-section">
        <p class="connect-or">or copy the server URL</p>
        <div class="connect-box">
          <code class="connect-url">${origin}/mcp</code>
          <button class="copy-btn" onclick="navigator.clipboard.writeText('${origin}/mcp').then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})">Copy</button>
        </div>
      </div>`
    : `<div class="hero-cta">
        <a href="/connect" class="btn-primary">Connect Claude →</a>
        <a href="/auth/kinde/login" class="btn-secondary">Create account</a>
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
.connect-cta{display:block;width:100%;max-width:460px;margin:0 auto 18px;text-align:center}
.connect-or{text-align:center;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}
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
    <a href="/auth/kinde/login">Sign in</a>
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
    : c.env.APP_BASE_URL || c.env.ENVIRONMENT === 'production'
      ? [appBaseUrl(c.env)]
      : ['http://localhost:8081', 'http://localhost:19006', 'http://localhost:8787'];

  return cors({
    origin: (origin) => {
      return origins.includes(origin) ? origin : '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'CF-Authorization', 'X-Request-ID', 'X-API-Key', 'X-User-Email', 'X-Org-Id'],
    exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
    maxAge: 86400,
    credentials: true,
  })(c, next);
});

// Security headers — disable CORP/COEP/COOP for API routes (conflicts with CORS).
// CSP is not set by hono's secureHeaders unless directives are provided, so we
// simply omit it (passing `false` is rejected by the types and is redundant).
app.use(
  '*',
  secureHeaders({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
  })
);

app.use('*', bodySizeLimit());

app.get('/', async (c) => {
  const session = await readSession(c);
  return c.html(renderLandingPage(session, appBaseUrl(c.env)));
});

// ── Writing guidance (signed-in web page) ─────────────────────────────────────────────────────────────────────────
// The same layers the mobile apps edit through /api/guidance, as plain forms. Auth is the web session cookie.
async function guidanceView(c: Context<{ Bindings: Env }>, userId: string, email: string, docId: string | null, notice: string | null, error: string | null) {
  const activeOrgId = await resolveScope(c.env, userId);
  const rows = await c.env.DB.prepare(
    `SELECT id, title FROM documents WHERE user_id = ? OR org_id = ? OR user_id IS NULL ORDER BY updated_at DESC LIMIT 100`
  ).bind(userId, activeOrgId).all<{ id: string; title: string }>();

  let selected: GuidancePageData['selected'] = null;
  if (docId) {
    const perm = await getDocumentPermission(c.env, docId, userId, activeOrgId);
    const doc = perm.canRead
      ? await c.env.DB.prepare('SELECT id, title, user_id AS userId FROM documents WHERE id = ?').bind(docId).first<{ id: string; title: string; userId: string | null }>()
      : null;
    if (doc) {
      selected = {
        id: doc.id,
        title: doc.title,
        layer: await getGuidanceLayer(c.env, userId, doc.id),
        author: await authorGuidanceFor(c.env, userId, doc.id),
        isOwner: doc.userId === userId,
        isTemplate: await isTemplate(c.env, doc.id),
      };
    }
  }
  return renderGuidancePage({
    email,
    defaultText: defaultGuidance(c.env),
    userLayer: await getGuidanceLayer(c.env, userId),
    documents: rows.results ?? [],
    selected,
    effective: (await effectiveGuidance(c.env, userId, selected?.id)).text,
    notice,
    error,
  });
}

// The page is plain forms with inline styles: no scripts, no third-party loads, never framed. A CSP backs up the escaping.
app.use('/guidance', async (c, next) => {
  await next();
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  );
});

app.get('/guidance', async (c) => {
  const session = await readSession(c);
  if (!session) return c.redirect('/auth/kinde/login?return_to=%2Fguidance');
  const notice = c.req.query('saved') ? 'Saved.' : null;
  return c.html(await guidanceView(c, session.user_id, session.email, c.req.query('doc') || null, notice, null));
});

app.post('/guidance', async (c) => {
  const session = await readSession(c);
  if (!session) return c.redirect('/auth/kinde/login?return_to=%2Fguidance');
  // The session cookie is SameSite=Lax, and a form post must also come from this site.
  const origin = c.req.header('Origin');
  if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.text('Forbidden', 403);

  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, string>;
  const userId = session.user_id;
  const docId = (body.doc || '').trim() || null;
  const back = (msg?: string, err?: string) =>
    msg ? c.redirect(`/guidance?${docId ? `doc=${encodeURIComponent(docId)}&` : ''}saved=1`) : null;

  const fail = async (error: string) => c.html(await guidanceView(c, userId, session.email, docId, null, error), 400);
  const mode = parseGuidanceMode(body.mode ?? 'append');

  switch (body.action) {
    case 'save_user': {
      const text = cleanGuidanceText(body.text ?? '');
      if (text === null || !mode) return fail(`Guidance can be up to ${GUIDANCE_MAX_LENGTH} characters.`);
      await setGuidanceLayer(c.env, userId, '', text, mode);
      return back('ok')!;
    }
    case 'save_doc':
    case 'save_author':
    case 'adopt':
    case 'unadopt':
    case 'set_template':
    case 'copy_use':
    case 'copy_fork': {
      if (!docId) return fail('Choose a note first.');
      const activeOrgId = await resolveScope(c.env, userId);
      if (!(await getDocumentPermission(c.env, docId, userId, activeOrgId)).canRead) return fail('That note was not found.');

      if (body.action === 'save_doc') {
        const text = cleanGuidanceText(body.text ?? '');
        if (text === null || !mode) return fail(`Guidance can be up to ${GUIDANCE_MAX_LENGTH} characters.`);
        await setGuidanceLayer(c.env, userId, docId, text, mode);
      } else if (body.action === 'set_template') {
        const owner = await c.env.DB.prepare('SELECT user_id AS userId FROM documents WHERE id = ?').bind(docId).first<{ userId: string | null }>();
        if (!owner || owner.userId !== userId) return fail("Only the note's owner can publish it as a template.");
        await setTemplate(c.env, docId, body.template === 'true');
      } else if (body.action === 'copy_use' || body.action === 'copy_fork') {
        const out = await copyDocument(
          c.env,
          { userId, email: session.email, name: session.email.split('@')[0], activeOrgId },
          docId,
          body.action === 'copy_use' ? 'use' : 'fork',
          { acceptVersion: Number(body.version) }
        );
        if (!out.ok) return fail(out.error);
        return c.redirect(`/guidance?doc=${encodeURIComponent(out.documentId)}&saved=1`);
      } else if (body.action === 'save_author') {
        const owner = await c.env.DB.prepare('SELECT user_id AS userId FROM documents WHERE id = ?').bind(docId).first<{ userId: string | null }>();
        if (!owner || owner.userId !== userId) return fail("Only the note's owner can attach instructions for its readers.");
        const checked = validateAuthorText(body.text ?? '');
        if ('error' in checked) return fail(checked.error);
        try {
          await setAuthorGuidance(c.env, docId, userId, session.email.split('@')[0], checked.text);
        } catch (e) {
          if (e instanceof LockedGuidanceError) return fail(e.message);
          throw e;
        }
      } else {
        const result = await setAdoption(c.env, userId, docId, body.action === 'adopt', Number(body.version));
        if (result === 'stale') return fail('The instructions changed. Review the new version first.');
        if (result === 'none') return fail('This note has no shared instructions.');
      }
      return back('ok')!;
    }
    default:
      return fail('Unknown action.');
  }
});

// Public "Connect Claude" setup guide (no auth — it's how new users get started).
app.get('/connect', (c) => c.html(renderConnectPage({ ...SCRIBE_CONNECT, mcpUrl: `${appBaseUrl(c.env)}/mcp` })));

// Public workspace join invite landing page
app.get('/join', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.text('No invite token provided', 400);

  const invite = await lookupOrgInvite(c.env, token);
  if (!invite) return c.text('Invalid or expired invitation', 404);

  const session = await readSession(c);
  return c.html(renderJoinPage(invite, session, token));
});

app.post('/join', async (c) => {
  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
  const token = (c.req.query('token') || body['token']) as string | undefined;
  if (!token) return c.text('No invite token provided', 400);

  const invite = await lookupOrgInvite(c.env, token);
  if (!invite) return c.text('Invalid or expired invitation', 404);

  const session = await readSession(c);
  if (!session) {
    const returnTo = encodeURIComponent(`/join?token=${token}`);
    return c.redirect(`/auth/kinde/login?return_to=${returnTo}`);
  }

  try {
    await acceptOrgInvite(c.env, invite.id, session.user_id);
    return c.redirect('/');
  } catch (e) {
    return c.text(e instanceof Error ? e.message : 'Failed to accept invitation', 400);
  }
});

// Public shareable document reader
app.get('/d/:id', async (c) => {
  const docId = c.req.param('id');
  const doc = await c.env.DB.prepare(
    `SELECT d.id, d.title, d.markdown, d.created_at, d.updated_at, d.created_by, o.name as org_name
     FROM documents d
     LEFT JOIN organizations o ON o.id = d.org_id
     WHERE d.id = ?`
  ).bind(docId).first<{
    id: string;
    title: string;
    markdown: string;
    created_at: number;
    updated_at: number;
    created_by: string;
    org_name: string | null;
  }>();

  if (!doc) {
    return c.text('Document not found', 404);
  }

  return c.html(renderPublicDoc(doc));
});

app.route('/', health);

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/api/auth/request-otp' || path === '/api/auth/verify-otp' || path === '/api/auth/refresh') {
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
app.route('/api/feed', feed);
app.route('/api/tags', tags);
app.route('/api/settings', settings);
app.route('/api/guidance', guidance);
app.route('/api/orgs', orgs);
app.use('/api/claude/*', claudeRateLimit);
app.route('/api/claude', claude);
app.route('/auth', webAuthRoute);
app.route('/oauth', oauthRoute);

app.onError(errorHandler);
app.notFound((c) => c.json({ error: 'Not found' }, 404));

const mcpHandler = ScribeMCP.serve('/mcp', { binding: 'SCRIBE_MCP' });

function mcpUnauthorized(request: Request): Response {
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

/**
 * Resolves a real {userId, email} for every /mcp request — this used to
 * just check "is this bearer token valid at all" and return null/Response,
 * never attaching an identity to ctx.props at all. ScribeMCP's tool
 * handlers had no userId to scope queries by, so every caller saw every
 * user's documents. See scribe-mcp.ts for the handler-side fix.
 */
async function resolveMcpIdentity(request: Request, env: Env): Promise<ScribeMcpProps | Response> {
  if (isLocalDev(env)) {
    // Local wrangler dev only — unscoped. Deployed environments (including dev) always authenticate.
    return { userId: '', email: '' };
  }

  const authHeader = request.headers.get('Authorization') ?? '';
  const bearerToken = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1];
  if (!bearerToken) return mcpUnauthorized(request);

  if (env.MCP_AUTH_TOKEN && (await timingSafeEqual(bearerToken, env.MCP_AUTH_TOKEN))) {
    // Fixed admin identity — same convention as the REST API's X-API-Key
    // branch (middleware/auth.ts) for this static, personal-use credential.
    const email = 'vishal@scribe.app';
    const userId = await userIdForIdentity({ sub: '', email });
    return { userId, email };
  }

  if (isKindeJwt(bearerToken, env.KINDE_DOMAIN)) {
    const identity = await verifyKindeAccessToken(env, bearerToken);
    if (!identity) {
      // Dev Worker only: a client-credentials token for the fixed test user (no-op everywhere else).
      const automation = await verifyDevAutomationToken(env, bearerToken);
      return automation ?? mcpUnauthorized(request);
    }
    return resolveAndUpsertKindeUser(env, identity);
  }

  // Legacy opaque MCP OAuth token (third-party clients that consented
  // before the Kinde migration) — already scoped to a real users.id.
  const info = await authenticateAccessToken(env.DB, env.OAUTH_PEPPER, bearerToken);
  if (info) return { userId: info.user_id, email: '' };

  return mcpUnauthorized(request);
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
      const identity = await resolveMcpIdentity(request, env);
      if (identity instanceof Response) return identity;
      (ctx as unknown as { props: ScribeMcpProps }).props = identity;
      return mcpHandler.fetch(request, env, ctx);
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(expireEphemeralDocuments(env));
  },
};

export { app };
export { DocumentSync } from './durable-objects/DocumentSync';
export { ScribeMCP } from './mcp/scribe-mcp';
