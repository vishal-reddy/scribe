import { GUIDANCE_MAX_LENGTH, type AuthorGuidanceView } from '../lib/writingGuidance';

const esc = (s: string) =>
  s.replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch] || ch);

export interface GuidancePageData {
  email: string;
  defaultText: string | null;
  userLayer: { text: string; mode: 'append' | 'replace' } | null;
  documents: { id: string; title: string }[];
  selected: {
    id: string;
    title: string;
    layer: { text: string; mode: 'append' | 'replace' } | null;
    author: AuthorGuidanceView | null;
    isOwner: boolean;
    isTemplate: boolean;
  } | null;
  effective: string;
  notice: string | null;
  error: string | null;
}

function modeRadios(name: string, mode: 'append' | 'replace') {
  return `<fieldset class="modes"><legend>How this combines with Scribe's defaults</legend>
    <label><input type="radio" name="${name}" value="append" ${mode === 'append' ? 'checked' : ''}> Add to Scribe's defaults</label>
    <label><input type="radio" name="${name}" value="replace" ${mode === 'replace' ? 'checked' : ''}> Replace the defaults</label>
  </fieldset>`;
}

/** The writer's page for customizing how an assistant helps them write. Plain forms: it works without JavaScript. */
export function renderGuidancePage(d: GuidancePageData): string {
  const s = d.selected;
  const docOptions = d.documents
    .map((x) => `<option value="${esc(x.id)}" ${s?.id === x.id ? 'selected' : ''}>${esc(x.title || 'Untitled')}</option>`)
    .join('');

  const adoptForm = (locked: boolean) =>
    s?.author
      ? `<form method="post" action="/guidance">
            <input type="hidden" name="action" value="${s.author.adopted ? 'unadopt' : 'adopt'}">
            <input type="hidden" name="doc" value="${esc(s.id)}"><input type="hidden" name="version" value="${s.author.version}">
            <h3>Instructions from ${esc(s.author.authorName || "this note's author")}${locked ? ' (locked)' : ''}</h3>
            <pre class="shared">${esc(s.author.text)}</pre>
            <p class="hint">${locked ? "These came with the template this note was copied from, so they can't be edited here. " : ''}${s.author.adopted ? 'Your assistant is following these. ' : 'Your assistant ignores these until you choose to follow them. '}You can change your mind any time.</p>
            <button>${s.author.adopted ? 'Stop following' : 'Have my assistant follow these'}</button>
          </form>`
      : '';

  const authorBlock = !s
    ? ''
    : s.author?.locked
      ? adoptForm(true)
      : s.isOwner
        ? `<form method="post" action="/guidance">
          <input type="hidden" name="action" value="save_author"><input type="hidden" name="doc" value="${esc(s.id)}">
          <h3>Instructions for readers of this note</h3>
          <p class="hint">For example a teacher's notes for an assignment. Readers see this text first and choose whether their assistant follows it. They can stop at any time, and they can't make it override their own settings. Leave empty to remove.</p>
          <textarea name="text" aria-label="Instructions for readers of this note" maxlength="${GUIDANCE_MAX_LENGTH}" rows="5">${esc(s.author?.text ?? '')}</textarea>
          <button>Save instructions for readers</button>
        </form>
        <form method="post" action="/guidance">
          <input type="hidden" name="action" value="set_template"><input type="hidden" name="doc" value="${esc(s.id)}">
          <input type="hidden" name="template" value="${s.isTemplate ? 'false' : 'true'}">
          <h3>Template</h3>
          <p class="hint">${s.isTemplate ? 'This note is a template. People who can read it can use a copy, where your instructions stay locked, or make their own version with instructions they can edit.' : 'Publish this note as a template so people can copy it. In their copies your instructions are locked.'}</p>
          <button>${s.isTemplate ? 'Stop being a template' : 'Publish as a template'}</button>
        </form>`
        : s.isTemplate
          ? `<h3>Template${s.author ? ` from ${esc(s.author.authorName || 'its author')}` : ''}</h3>
          ${s.author ? `<pre class="shared">${esc(s.author.text)}</pre><p class="hint">Using the template gives you your own copy. These instructions come with it, locked, and your assistant follows them until you stop. Making your own version copies them as text you can edit.</p>` : '<p class="hint">This template has no instructions.</p>'}
          <form method="post" action="/guidance"><input type="hidden" name="action" value="copy_use"><input type="hidden" name="doc" value="${esc(s.id)}"><input type="hidden" name="version" value="${s.author?.version ?? 0}"><button>Use this template</button></form>
          <form method="post" action="/guidance"><input type="hidden" name="action" value="copy_fork"><input type="hidden" name="doc" value="${esc(s.id)}"><button>Make my own version of this template</button></form>`
          : s.author
            ? adoptForm(false)
            : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Writing guidance · Scribe</title>
<style>
  body{font:16px/1.55 -apple-system,Inter,sans-serif;max-width:720px;margin:0 auto;padding:24px 20px 80px;color:#18181b;background:#fafafa}
  a{color:#3a3a3c} h1{font-weight:600;margin:.2em 0} h2{margin-top:2em} h3{margin:1.4em 0 .2em}
  textarea,select{width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid #d4d4d8;border-radius:8px;background:#fff}
  button{margin-top:10px;font:inherit;padding:9px 16px;border:0;border-radius:8px;background:#3a3a3c;color:#fff;cursor:pointer}
  .hint{color:#5c5c66;font-size:14px;margin:.3em 0 .6em} .modes{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0;font-size:14px}
  pre{white-space:pre-wrap;background:#fff;border:1px solid #e4e4e7;border-radius:8px;padding:12px;font:13px/1.5 ui-monospace,monospace}
  .notice{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:8px 12px} .error{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px}
  details{margin:.8em 0} fieldset.modes{border:0;padding:0;margin:8px 0} fieldset.modes legend{font-size:14px;color:#5c5c66;padding:0}
  label[for=doc-pick]{display:block;font-weight:600;margin-bottom:4px}
  a:focus-visible,button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #2563eb;outline-offset:2px}
  @media (prefers-color-scheme:dark){body{background:#121214;color:#f4f4f5} a{color:#d4d4d8} textarea,select,pre{background:#1c1c1f;color:#f4f4f5;border-color:#3f3f46} button{background:#e4e4e7;color:#18181b} .hint,fieldset.modes legend{color:#a1a1aa} .notice{background:#052e1f;border-color:#065f46} .error{background:#3b0d0d;border-color:#7f1d1d}}
</style></head><body>
<main>
<nav aria-label="Account"><a href="/">← Scribe</a> · ${esc(d.email)}</nav>
<h1>Writing guidance</h1>
<p class="hint">Scribe helps you write in your own words and language, and to type and speak more clearly. This is how the assistant you connect to Scribe is told to help you. Change it for all your notes, or for one note.</p>
<div role="status" aria-live="polite">${d.notice ? `<p class="notice">${esc(d.notice)}</p>` : ''}${d.error ? `<p class="error" role="alert">${esc(d.error)}</p>` : ''}</div>

<details><summary>Scribe's defaults</summary><pre>${esc(d.defaultText ?? 'Scribe\'s own coaching is turned off for this deployment.')}</pre></details>

<h2>All my notes</h2>
<form method="post" action="/guidance">
  <input type="hidden" name="action" value="save_user">
  <textarea name="text" aria-label="Your guidance for all notes" maxlength="${GUIDANCE_MAX_LENGTH}" rows="5" placeholder="For example: Always reply in Español. Ask me questions before you suggest wording.">${esc(d.userLayer?.text ?? '')}</textarea>
  ${modeRadios('mode', d.userLayer?.mode ?? 'append')}
  <button>Save</button> <span class="hint">Leave empty to go back to the defaults.</span>
</form>

<h2>One note</h2>
<form method="get" action="/guidance"><label for="doc-pick">Note</label><select id="doc-pick" name="doc"><option value="">Choose a note…</option>${docOptions}</select> <button>Open</button></form>
${
  s
    ? `<form method="post" action="/guidance">
        <input type="hidden" name="action" value="save_doc"><input type="hidden" name="doc" value="${esc(s.id)}">
        <h3>Your guidance for “${esc(s.title || 'Untitled')}”</h3>
        <textarea name="text" aria-label="Your guidance for this note" maxlength="${GUIDANCE_MAX_LENGTH}" rows="4">${esc(s.layer?.text ?? '')}</textarea>
        ${modeRadios('mode', s.layer?.mode ?? 'append')}
        <button>Save for this note</button>
      </form>${authorBlock}`
    : ''
}

<h2>What the assistant will be told${s ? ' for this note' : ''}</h2>
<pre>${esc(d.effective || "(Scribe's coaching is off and you have no guidance set.)")}</pre>
</main>
</body></html>`;
}
