/**
 * "Connect Claude" setup guide — a self-contained, accessible HTML page served
 * at GET /connect. Designed against Nielsen Norman Group usability standards:
 *  - Visibility of system status (copy confirmation, numbered progress)
 *  - Match to the real world (plain language, no jargon)
 *  - Recognition over recall (ready-made example prompts)
 *  - Error prevention (one canonical URL with a copy button — no typing)
 *  - Help & recovery (troubleshooting section)
 *  - Accessibility: skip link, semantic landmarks, ARIA, visible focus,
 *    AA contrast, responsive layout, and dark-mode support.
 *
 * Parameterized so Didactic and Ovrwhlm can reuse it with their own values.
 */

export interface ConnectConfig {
  appName: string;        // "Scribe"
  brand: string;          // "SCRIBE"
  mcpUrl: string;         // "https://scribe.kecker.co/mcp"
  tagline: string;        // one short sentence on what connecting unlocks
  examplePrompts: string[];
  homeHref: string;       // "/"
  docsHref?: string;      // link to fuller docs, optional
}

export const SCRIBE_CONNECT: ConnectConfig = {
  appName: 'Scribe',
  brand: 'SCRIBE',
  mcpUrl: 'https://scribe.kecker.co/mcp',
  tagline: 'Connect Claude to Scribe once, then read, write, search, and auto-organize your notes from any conversation.',
  examplePrompts: [
    'List my Scribe documents.',
    'Create a note titled “Q3 ideas” with three bullet points.',
    'Organize my unfiled notes into the Thomistic taxonomy.',
    'Search my notes for anything about onboarding.',
  ],
  homeHref: '/',
  docsHref: '/',
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

export function renderConnectPage(cfg: ConnectConfig = SCRIBE_CONNECT): string {
  const { appName, brand, mcpUrl } = cfg;
  const promptItems = cfg.examplePrompts.map((p) => `<li>${esc(p)}</li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connect Claude to ${esc(appName)}</title>
<meta name="description" content="Step-by-step guide to connecting Claude to ${esc(appName)} as a custom connector."/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@400;500;600&family=Nunito:wght@700&display=swap" rel="stylesheet">
<style>
:root{--bg:#FAFAFA;--surface:#FFFFFF;--surface-border:#E4E4E7;--surface-hover:#F4F4F5;--text:#18181B;--muted:#5C5C66;--accent:#3A3A3C;--ring:#3A3A3C;--font:'Inter',-apple-system,sans-serif}
@media(prefers-color-scheme:dark){:root{--bg:#161618;--surface:#1F1F22;--surface-border:#2E2E32;--surface-hover:#26262A;--text:#FAFAFA;--muted:#A8A8B2;--accent:#FAFAFA;--ring:#FAFAFA}}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:var(--font);background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;flex-direction:column;line-height:1.5}
a{color:inherit}
:focus-visible{outline:3px solid var(--ring);outline-offset:2px;border-radius:6px}
.skip{position:absolute;left:-9999px;top:8px;background:var(--accent);color:var(--bg);padding:10px 16px;border-radius:8px;font-weight:600;z-index:10}
.skip:focus{left:16px}
nav{display:flex;align-items:center;justify-content:space-between;padding:0 40px;height:64px;border-bottom:1px solid var(--surface-border);flex-shrink:0}
.brand{font-family:'Nunito',sans-serif;font-weight:700;font-size:15px;letter-spacing:0.2em;color:var(--text);text-decoration:none}
.nav-back{color:var(--muted);font-size:14px;font-weight:500;text-decoration:none}
.nav-back:hover{color:var(--text)}
main{flex:1;width:100%;max-width:760px;margin:0 auto;padding:0 40px}
.hero{margin:72px 0 8px;text-align:center}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted);margin:0 0 20px}
h1{font-family:'EB Garamond',serif;font-size:clamp(40px,7vw,64px);font-weight:500;line-height:1.04;margin:0 0 20px;letter-spacing:-0.01em}
h1 em{font-style:italic}
.sub{font-size:18px;color:var(--muted);line-height:1.6;margin:0 auto;max-width:520px}
/* connection diagram */
.diagram{display:flex;align-items:center;justify-content:center;gap:14px;margin:44px auto 8px;flex-wrap:wrap}
.node{display:flex;flex-direction:column;align-items:center;gap:8px;min-width:96px}
.node-box{width:64px;height:64px;border-radius:16px;background:var(--surface);border:1px solid var(--surface-border);display:flex;align-items:center;justify-content:center;font-size:26px}
.node span{font-size:13px;color:var(--muted);font-weight:500}
.arrow{color:var(--muted);font-size:22px;line-height:1}
/* callout */
.callout{background:var(--surface);border:1px solid var(--surface-border);border-radius:14px;padding:18px 20px;margin:40px 0 8px;display:flex;gap:14px}
.callout .ic{font-size:20px;line-height:1.4}
.callout h2{font-size:14px;margin:0 0 6px;letter-spacing:0.01em}
.callout p{margin:0;font-size:14px;color:var(--muted);line-height:1.6}
/* steps */
.section-label{font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin:56px 0 18px}
ol.steps{list-style:none;counter-reset:step;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
ol.steps>li{counter-increment:step;background:var(--surface);border:1px solid var(--surface-border);border-radius:16px;padding:20px 22px;display:grid;grid-template-columns:40px 1fr;gap:16px;align-items:start}
ol.steps>li::before{content:counter(step);grid-row:1/span 2;width:36px;height:36px;border-radius:50%;background:var(--accent);color:var(--bg);font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center}
.step-t{font-size:16px;font-weight:600;margin:6px 0 4px}
.step-d{font-size:14.5px;color:var(--muted);margin:0;line-height:1.6}
.step-d kbd{font-family:var(--font);background:var(--surface-hover);border:1px solid var(--surface-border);border-radius:6px;padding:1px 7px;font-size:13px;font-weight:500;color:var(--text)}
/* copy box */
.copy-box{grid-column:1/-1;display:flex;align-items:center;background:var(--surface-hover);border:1px solid var(--surface-border);border-radius:12px;padding:12px 14px;gap:12px;margin-top:12px}
.copy-url{font-family:'SF Mono','Fira Code',ui-monospace,monospace;font-size:14px;color:var(--text);flex:1;word-break:break-all}
.copy-btn{background:var(--accent);color:var(--bg);border:none;border-radius:8px;padding:9px 16px;font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.copy-btn:hover{opacity:.85}
/* prompts */
.prompts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.prompts li{background:var(--surface);border:1px solid var(--surface-border);border-radius:12px;padding:14px 18px;font-size:15px}
.prompts li::before{content:"“";color:var(--muted);font-family:'EB Garamond',serif;font-size:22px;margin-right:2px}
.prompts li::after{content:"”";color:var(--muted);font-family:'EB Garamond',serif;font-size:22px}
/* troubleshooting */
details{background:var(--surface);border:1px solid var(--surface-border);border-radius:12px;padding:0;margin-bottom:10px;overflow:hidden}
summary{cursor:pointer;padding:16px 18px;font-weight:600;font-size:15px;list-style:none}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";float:right;color:var(--muted);font-weight:400}
details[open] summary::after{content:"–"}
details .body{padding:0 18px 16px;font-size:14.5px;color:var(--muted);line-height:1.6}
footer{border-top:1px solid var(--surface-border);padding:28px 40px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;margin-top:72px}
.footer-brand{font-family:'Nunito',sans-serif;font-weight:700;font-size:12px;letter-spacing:0.18em;color:var(--muted);text-decoration:none}
.footer-links{display:flex;gap:20px}
.footer-links a{font-size:13px;color:var(--muted);text-decoration:none}
.footer-links a:hover{color:var(--text)}
.sr-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media(max-width:640px){nav,main,footer{padding-left:20px;padding-right:20px}.hero{margin-top:48px}ol.steps>li{padding:18px}.arrow{transform:rotate(90deg)}}
</style>
</head>
<body>
<a href="#guide" class="skip">Skip to setup steps</a>
<header>
  <nav aria-label="Primary">
    <a href="${esc(cfg.homeHref)}" class="brand">${esc(brand)}</a>
    <a href="${esc(cfg.homeHref)}" class="nav-back" aria-label="Back to ${esc(appName)}">← Back to ${esc(appName)}</a>
  </nav>
</header>
<main id="main">
  <div class="hero">
    <p class="eyebrow">Setup guide · 2 minutes</p>
    <h1>Connect Claude<br>to <em>${esc(appName)}</em>.</h1>
    <p class="sub">${esc(cfg.tagline)}</p>
  </div>

  <div class="diagram" role="img" aria-label="Diagram: you talk to Claude, and Claude connects to ${esc(appName)}.">
    <div class="node"><div class="node-box" aria-hidden="true">🧑</div><span>You</span></div>
    <div class="arrow" aria-hidden="true">→</div>
    <div class="node"><div class="node-box" aria-hidden="true">✳️</div><span>Claude</span></div>
    <div class="arrow" aria-hidden="true">→</div>
    <div class="node"><div class="node-box" aria-hidden="true">✦</div><span>${esc(appName)}</span></div>
  </div>

  <div class="callout">
    <span class="ic" aria-hidden="true">📋</span>
    <div>
      <h2>Before you start</h2>
      <p>You need the <strong>Claude app</strong> (desktop, mobile, or claude.ai) on a paid plan — custom connectors are a paid feature — and a <strong>${esc(appName)} account</strong> (the same email you use in the ${esc(appName)} app).</p>
    </div>
  </div>

  <h2 class="section-label" id="guide">Connect in 5 steps</h2>
  <ol class="steps">
    <li>
      <div>
        <p class="step-t">Open Claude</p>
        <p class="step-d">Use the Claude app on your computer (Claude Desktop) or <kbd>claude.ai</kbd> in a browser.</p>
      </div>
    </li>
    <li>
      <div>
        <p class="step-t">Go to Settings → Connectors</p>
        <p class="step-d">Open Claude’s <kbd>Settings</kbd>, then the <kbd>Connectors</kbd> tab.</p>
      </div>
    </li>
    <li>
      <div>
        <p class="step-t">Add a custom connector</p>
        <p class="step-d">Click <kbd>Add custom connector</kbd>. The only field that matters is the server URL — paste ${esc(appName)}’s address below.</p>
      </div>
      <div class="copy-box">
        <code class="copy-url" id="mcpurl">${esc(mcpUrl)}</code>
        <button type="button" class="copy-btn" id="copybtn" aria-describedby="copystatus"
          onclick="navigator.clipboard.writeText('${esc(mcpUrl)}').then(()=>{var s=document.getElementById('copystatus');this.textContent='Copied';s.textContent='${esc(appName)} server URL copied to clipboard';setTimeout(()=>{this.textContent='Copy';s.textContent='';},2000)})">Copy</button>
      </div>
      <span id="copystatus" class="sr-live" role="status" aria-live="polite"></span>
    </li>
    <li>
      <div>
        <p class="step-t">Sign in to ${esc(appName)}</p>
        <p class="step-d">A ${esc(appName)} window opens. Sign in with your email and approve access. You only do this once. <strong>No token or header to paste</strong> — sign-in handles it.</p>
      </div>
    </li>
    <li>
      <div>
        <p class="step-t">You’re connected</p>
        <p class="step-d">Claude can now work with your notes. Try one of the prompts below.</p>
      </div>
    </li>
  </ol>

  <h2 class="section-label">Try saying</h2>
  <ul class="prompts">${promptItems}</ul>

  <h2 class="section-label">If something’s not working</h2>
  <details>
    <summary>Claude says it can’t find my notes</summary>
    <div class="body">Open Claude → <kbd>Settings</kbd> → <kbd>Connectors</kbd> → ${esc(appName)} and confirm it shows your email (signed in). If not, click it and sign in again.</div>
  </details>
  <details>
    <summary>I don’t see “Add custom connector”</summary>
    <div class="body">Custom connectors require a paid Claude plan (Pro, Max, Team, or Enterprise). On a free plan the option is hidden.</div>
  </details>
  <details>
    <summary>It’s asking me for a token or an authorization header</summary>
    <div class="body">You don’t need one. Use only the URL above — signing in to ${esc(appName)} grants access automatically.</div>
  </details>
  <details>
    <summary>Changes aren’t showing on my phone</summary>
    <div class="body">Pull down to refresh in the ${esc(appName)} app. Edits Claude makes sync on the next refresh.</div>
  </details>
</main>
<footer>
  <a href="${esc(cfg.homeHref)}" class="footer-brand">${esc(brand)}</a>
  <div class="footer-links">
    <a href="${esc(cfg.docsHref || cfg.homeHref)}">Docs</a>
    <a href="${esc(cfg.homeHref)}">Home</a>
  </div>
</footer>
</body>
</html>`;
}
