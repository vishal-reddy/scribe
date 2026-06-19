import { Hono } from 'hono';
import type { Env } from '../types';
import { hashPassword, verifyPassword } from '../lib/password';
import { issueSession, clearSession } from '../lib/session';

export const webAuthRoute = new Hono<{ Bindings: Env }>();

const HTML_SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
};

webAuthRoute.use('*', async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(HTML_SECURITY_HEADERS)) {
    c.res.headers.set(k, v);
  }
});

const esc = (s: string) =>
  s.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c] || c);

const sanitizeReturn = (r: string) => (r.startsWith('/') && !r.startsWith('//') ? r : '/');

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Inter:wght@400;500;600&family=Nunito:wght@700&display=swap" rel="stylesheet">`;

const CSS_VARS = `:root{--bg:#FAFAFA;--surface:#FFFFFF;--surface-border:#E4E4E7;--surface-hover:#F4F4F5;--text:#18181B;--muted:#71717A;--accent:#3A3A3C;--danger:#B3261E;--danger-soft:#f9dedc;--font:'Inter',-apple-system,sans-serif}`;

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

webAuthRoute.get('/login', (c) => {
  const returnTo = c.req.query('return_to') || '/';
  const error = c.req.query('error') ?? '';
  return c.html(renderAuthPage({ mode: 'login', returnTo, error }));
});

webAuthRoute.get('/register', (c) => {
  const returnTo = c.req.query('return_to') || '/';
  const error = c.req.query('error') ?? '';
  return c.html(renderAuthPage({ mode: 'register', returnTo, error }));
});

webAuthRoute.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const email = String(form.email || '').trim().toLowerCase();
  const password = String(form.password || '');
  const returnTo = sanitizeReturn(String(form.return_to || '/'));
  if (!email || !password)
    return c.redirect(`/auth/login?return_to=${encodeURIComponent(returnTo)}&error=missing_fields`, 302);

  const row = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(email).first<{ id: string; password_hash: string | null }>();
  if (!row || !row.password_hash)
    return c.redirect(`/auth/login?return_to=${encodeURIComponent(returnTo)}&error=invalid_credentials`, 302);

  const { valid, needsRehash } = await verifyPassword(password, row.password_hash);
  if (!valid)
    return c.redirect(`/auth/login?return_to=${encodeURIComponent(returnTo)}&error=invalid_credentials`, 302);

  // Upgrade hash iterations if the stored hash uses outdated parameters
  if (needsRehash) {
    const newHash = await hashPassword(password);
    await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, row.id).run();
  }

  // Invalidate all existing web sessions before issuing a new one
  await c.env.DB.prepare('DELETE FROM web_sessions WHERE user_id = ?').bind(row.id).run();
  await issueSession(c, { user_id: row.id, email });
  return c.redirect(returnTo, 302);
});

webAuthRoute.post('/register', async (c) => {
  const form = await c.req.parseBody();
  const email = String(form.email || '').trim().toLowerCase();
  const password = String(form.password || '');
  const returnTo = sanitizeReturn(String(form.return_to || '/'));

  if (!email || !password)
    return c.redirect(`/auth/register?return_to=${encodeURIComponent(returnTo)}&error=missing_fields`, 302);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return c.redirect(`/auth/register?return_to=${encodeURIComponent(returnTo)}&error=invalid_email`, 302);
  if (password.length < 8)
    return c.redirect(`/auth/register?return_to=${encodeURIComponent(returnTo)}&error=weak_password`, 302);

  const existing = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(email).first<{ id: string; password_hash: string | null }>();

  if (existing?.password_hash)
    return c.redirect(`/auth/register?return_to=${encodeURIComponent(returnTo)}&error=email_taken`, 302);

  const hash = await hashPassword(password);
  const now = Date.now();
  let userId: string;

  if (existing) {
    userId = existing.id;
    await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, userId).run();
  } else {
    userId = await sha256(email);
    await c.env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, created_at, is_verified) VALUES (?, ?, ?, ?, 1)'
    ).bind(userId, email, hash, now).run();
  }

  await issueSession(c, { user_id: userId, email });
  return c.redirect(returnTo, 302);
});

webAuthRoute.get('/logout', (c) => { clearSession(c); return c.redirect('/', 302); });
webAuthRoute.post('/logout', (c) => { clearSession(c); return c.redirect('/', 302); });

function errorMessage(code: string): string {
  switch (code) {
    case 'missing_fields': return 'Enter your email and password.';
    case 'invalid_email': return "That doesn't look like a valid email address.";
    case 'weak_password': return 'Password must be at least 8 characters.';
    case 'invalid_credentials': return "That email and password don't match. Try again or create an account.";
    case 'email_taken': return 'An account with that email already exists. Sign in instead.';
    default: return '';
  }
}

function renderAuthPage(opts: { mode: 'login' | 'register'; returnTo: string; error: string }): string {
  const { mode, returnTo, error } = opts;
  const isLogin = mode === 'login';
  const action = isLogin ? '/auth/login' : '/auth/register';
  const cta = isLogin ? 'Sign in' : 'Create account';
  const altText = isLogin ? 'No account yet?' : 'Already have an account?';
  const altLink = isLogin
    ? `<a href="/auth/register?return_to=${encodeURIComponent(returnTo)}">Create one</a>`
    : `<a href="/auth/login?return_to=${encodeURIComponent(returnTo)}">Sign in</a>`;
  const hint = isLogin ? '' : '<p class="hint">At least 8 characters.</p>';
  const errMsg = errorMessage(error);
  const errBlock = errMsg ? `<div class="error">${esc(errMsg)}</div>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<title>${isLogin ? 'Sign in' : 'Create account'} — Scribe</title>
${FONTS}
<style>
  ${CSS_VARS}
  *{box-sizing:border-box} html,body{margin:0;padding:0}
  body{font-family:var(--font);background:var(--bg);color:var(--text);
    -webkit-font-smoothing:antialiased;min-height:100vh;
    display:grid;place-items:center;padding:24px;}
  .brand-logo{display:flex;flex-direction:column;align-items:center;text-decoration:none;margin-bottom:32px}
  .brand-text{font-family:'Nunito',sans-serif;font-weight:700;font-size:28px;color:var(--text);line-height:0.9;letter-spacing:0.15em;margin-left:0.15em}
  .brand-divider{width:80px;height:3px;background:var(--accent);margin:6px 0;border-radius:2px}
  .card{background:var(--surface);border:1px solid var(--surface-border);border-radius:16px;
    padding:32px;max-width:400px;width:100%;
    backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);}
  h1{font-size:22px;font-weight:600;margin:0 0 4px;letter-spacing:-0.02em}
  .sub{color:var(--muted);font-size:15px;margin:0 0 24px}
  label{display:block;font-size:13px;font-weight:500;margin:0 0 6px;color:var(--muted)}
  input{width:100%;background:var(--surface-hover);color:var(--text);
    border:1px solid var(--surface-border);border-radius:12px;
    padding:12px 16px;font:inherit;font-size:15px}
  input:focus{outline:none;border-color:var(--accent)}
  .field{margin-bottom:16px}
  .hint{color:var(--muted);font-size:12px;margin:6px 0 0}
  button{width:100%;background:var(--accent);color:var(--bg);border:0;
    border-radius:12px;padding:14px 16px;font:inherit;font-size:15px;
    font-weight:600;cursor:pointer;margin-top:8px;
    box-shadow:0 4px 20px rgba(58,58,60,0.3);transition:transform .15s}
  button:hover{transform:scale(1.02)}
  .alt{text-align:center;margin-top:18px;font-size:14px;color:var(--muted)}
  .alt a{color:var(--accent);text-decoration:none;font-weight:500}
  .alt a:hover{text-decoration:underline}
  .error{background:var(--danger-soft);color:var(--danger);
    border:1px solid rgba(179,38,30,0.3);border-radius:12px;
    padding:12px 16px;font-size:13px;margin-bottom:16px;font-weight:500;}
  .back{text-align:center;margin-top:16px;font-size:13px}
  .back a{color:var(--muted);text-decoration:none}
  .back a:hover{color:var(--text)}
</style>
</head>
<body>
<div>
  <a href="/" class="brand-logo">
    <div class="brand-text">SCRIBE</div>
    <div class="brand-divider"></div>
  </a>
  <div class="card">
    <h1>${isLogin ? 'Sign in' : 'Create your account'}</h1>
    <p class="sub">${isLogin ? 'Welcome back.' : 'Free to get started. No card required.'}</p>
    ${errBlock}
    <form method="post" action="${action}">
      <input type="hidden" name="return_to" value="${esc(returnTo)}" />
      <div class="field">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" required autocomplete="email" autofocus />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required
          autocomplete="${isLogin ? 'current-password' : 'new-password'}"
          minlength="${isLogin ? 1 : 8}" />
        ${hint}
      </div>
      <button type="submit">${cta}</button>
    </form>
    <div class="alt">${altText} ${altLink}</div>
  </div>
  <div class="back"><a href="/">← Home</a></div>
</div>
</body>
</html>`;
}
