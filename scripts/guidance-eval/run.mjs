#!/usr/bin/env node
// Runs the scenarios through other models' CLIs against a local MCP server that serves Scribe's real guidance.
//   node scripts/guidance-eval/run.mjs [--models agy:<model>,...] [--only id1,id2] [--timeout 240]
// Needs the `agy` CLI signed in. It registers a temporary MCP server named scribe-eval and removes it when done.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS, INFO_ONLY } from './checks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const models = arg('models', 'agy:gemini-4-argon-medium,agy:gemini-3.8-flash-medium,agy:gpt-oss-120b-medium,agy:claude-sonnet-5-5-medium').split(',');
const only = arg('only', '') ? arg('only').split(',') : null;
const timeoutMs = Number(arg('timeout', '240')) * 1000;
const outFile = arg('out', join(root, 'scripts/guidance-eval/last-run.json'));

const work = mkdtempSync(join(tmpdir(), 'scribe-eval-'));
const bundle = join(work, 'server.mjs');
execFileSync(join(root, 'node_modules/.bin/esbuild'), [join(here, 'server.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`, '--log-level=error'], { cwd: root });
const scenarios = JSON.parse(readFileSync(join(here, 'scenarios.json'), 'utf8')).filter((s) => !only || only.includes(s.id));

const configFile = join(work, 'current.json');
const MCP_NAME = 'scribe-eval';
let registered = false;
function ensureRegistered() {
  if (registered) return;
  spawnSync('agy', ['mcp', 'remove', MCP_NAME], { encoding: 'utf8' });
  const r = spawnSync('agy', ['mcp', 'add', '--env', `EVAL_CONFIG=${configFile}`, MCP_NAME, process.execPath, bundle], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`agy mcp add failed: ${r.stderr || r.stdout}`);
  registered = true;
}

/** model is "agy:<agy model id>". The server reads the scenario from configFile, rewritten per run. */
function command(model, s, log) {
  writeFileSync(configFile, JSON.stringify({ scenarios: join(here, 'scenarios.json'), id: s.id, log }));
  const [kind, id] = model.split(':');
  if (kind !== 'agy') throw new Error(`unknown model ${model}`);
  ensureRegistered();
  return ['agy', ['--model', id, '--dangerously-skip-permissions', '--output-format', 'text', '-p', s.prompt]];
}

const results = [];
for (const model of models) {
  for (const s of scenarios) {
    const dir = mkdtempSync(join(work, `${model}-${s.id}-`));
    const log = join(dir, 'calls.jsonl');
    const [bin, args] = command(model, s, log);
    const started = Date.now();
    const r = spawnSync(bin, args, { cwd: dir, encoding: 'utf8', timeout: timeoutMs });
    const reply = ((r.stdout || '') + (r.status ? `\n[exit ${r.status}] ${(r.stderr || '').slice(0, 300)}` : '')).trim();
    const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const timedOut = r.error?.code === 'ETIMEDOUT';
    const checks = timedOut || r.status !== 0 || (!reply && !calls.length) ? { ran: false } : { ran: true, ...CHECKS[s.id]({ calls, reply }) };
    results.push({ model, scenario: s.id, seconds: Math.round((Date.now() - started) / 1000), tools: calls.map((c) => c.tool), checks, reply: reply.slice(0, 1800) });
    const flat = Object.entries(checks).map(([k, v]) => `${v ? '✓' : '✗'}${INFO_ONLY.has(k) ? '(info)' : ''} ${k}`).join('  ');
    console.log(`[${model}] ${s.id} (${results.at(-1).seconds}s, tools: ${calls.map((c) => c.tool).join(',') || 'none'})  ${checks.ran === false ? `DID NOT RUN: ${reply.slice(0, 160).replace(/\n/g, ' ')}` : flat}`);
    writeFileSync(outFile, JSON.stringify(results, null, 2));
  }
}

// Summary: pass rate per model over expectation checks only.
console.log('\nSummary (expectations only, observations excluded):');
for (const model of models) {
  const rows = results.filter((x) => x.model === model && x.checks.ran !== false);
  let pass = 0, total = 0;
  for (const row of rows) for (const [k, v] of Object.entries(row.checks)) { if (k === 'ran' || INFO_ONLY.has(k) || k === 'wrote_the_essay_anyway') continue; total++; if (v) pass++; }
  console.log(`  ${model}: ${pass}/${total} expectation checks passed across ${rows.length} runs`);
}
spawnSync('agy', ['mcp', 'remove', MCP_NAME], { encoding: 'utf8' });
console.log(`\nFull replies: ${outFile}`);
