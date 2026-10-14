#!/usr/bin/env node
/**
 * CAD-1365 / DSN-1 — INDEPENDENT acceptance driver: original download bridge.
 *
 * Authored from design-plans/designer-original-download-bridge-v1.md (HOST
 * worktree), not from any implementation. It exercises the ACTUAL app source
 * src/host/bootstrap.ts (connectFrameHost) transpiled to CommonJS with the
 * installed TypeScript and loaded through a small sandbox loader, over the real
 * Node worker_threads MessageChannel. The only fakes are the DOM/window boot
 * shim, a controllable clock and the parent side of the channel.
 *
 * Node MessagePort transport evidence only. It is NOT browser gesture, download
 * or saved-file evidence, and it exercises no provider, network or funding path.
 *
 * Declared app contract asserted here:
 *  - snapshot().capabilities.download is true ONLY for a qualified host: v2
 *    screen push, screen-media.v1 accepted, media.read + media.original.download
 *    advertised, host-derived original_downloads:1 marker, catalog ready.
 *  - submit({kind:'download', assetId}) sends exactly one slot
 *    {v:2, op:'slot', verb:'media.original.download', anchor:'footer',
 *     args:{asset_id}} and no media.* call and no run.start.
 *  - valid slot-state done -> metadata-only {status:'download_started'} with no
 *    revision, receipt id or save-proof field.
 *  - refused -> refused; lost port after send -> uncertain, with no auto resend.
 *  - a second submit while pending is refused and sends no second slot.
 *
 * Run (inside a build slot): node acceptance/original-download-bridge.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { MessageChannel, MessagePort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const BOOT = path.join(APP, 'src', 'host', 'bootstrap.ts');
const req = createRequire(import.meta.url);
const ts = req('typescript');

const PARENT_ORIGIN = 'https://host.invalid';
const ASSET = 'med-0123456789abcdef0123456789abcdef';
const RUN_ID = 'run-' + 'a'.repeat(32);

let failures = 0; let total = 0;
function check(name, ok, detail) {
  total++;
  if (ok) console.log(`  ok    ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
const ticks = (n = 40) => new Promise((res) => { let i = 0; const step = () => (++i >= n ? res() : setImmediate(step)); setImmediate(step); });
async function waitFor(pred, tries = 200) {
  for (let i = 0; i < tries; i++) { if (pred()) return true; await ticks(2); }
  return !!pred();
}

/* ------------------------------ fake clock ------------------------------ */
function fakeClock() {
  let now = 0; let seq = 1; const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms = 0) { const id = seq++; timers.set(id, { at: now + (ms || 0), fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms = 0) { const id = seq++; timers.set(id, { at: now + (ms || 0), fn, every: ms || 1 }); return id; },
    clearInterval(id) { timers.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null; let nid = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.at)) { next = t; nid = id; }
        if (!next) break;
        now = next.at; timers.delete(nid);
        if (next.every) timers.set(nid, { ...next, at: now + next.every });
        next.fn();
      }
      now = end;
    },
  };
}

/* ------------------------------ sandbox loader -------------------------- */
function makeLoader(sandbox) {
  const cache = new Map();
  function resolveLocal(from, spec) {
    const base = path.resolve(path.dirname(from), spec);
    const tries = [base, base + '.ts', base + '.tsx', base + '.js', base + '.mjs',
      path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
    if (base.endsWith('.js')) tries.unshift(base.slice(0, -3) + '.ts');
    for (const t of tries) if (fs.existsSync(t) && fs.statSync(t).isFile()) return t;
    throw new Error(`loader: cannot resolve ${spec} from ${from}`);
  }
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const src = fs.readFileSync(file, 'utf8');
    const { outputText } = ts.transpileModule(src, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, jsx: ts.JsxEmit.React,
    }, fileName: file });
    const mod = { exports: {} };
    cache.set(file, mod);
    const localRequire = (spec) => (spec.startsWith('.') ? load(resolveLocal(file, spec)) : req(spec));
    const fn = new Function('module', 'exports', 'require', '__sandbox',
      `const {document, window, setTimeout, clearTimeout, setInterval, clearInterval, ` +
      `MessageChannel, MessagePort} = __sandbox;\n${outputText}`);
    try { fn(mod, mod.exports, localRequire, sandbox); } catch (e) { cache.delete(file); throw e; }
    return mod.exports;
  }
  return { load };
}

/* ------------------------------ fixture --------------------------------- */
function makeFixture() {
  const clock = fakeClock();
  const boot = { tag: 'studio', bridge_nonce: 'a'.repeat(64), generation: 1, parent_origin: PARENT_ORIGIN };
  const st = { init: null, port: null, portMsgs: [], readySeen: false, slotMsgs: [], screenPushed: null };
  const document = {
    getElementById: (id) => (id === 'cadence-screen-boot' ? { textContent: JSON.stringify(boot) } : null),
    documentElement: { getAttribute: (n) => (n === 'data-cadence-kit' ? 'cadence-kit/1' : null) },
  };
  const window = {
    parent: { postMessage(msg, origin, transfer) {
      st.init = { msg, origin };
      const p = transfer && transfer[0];
      if (p) { st.port = p; p.on('message', onParentMessage); if (p.start) p.start(); }
    } },
    document,
    location: { href: 'https://app.invalid/frame', origin: 'https://app.invalid' },
    addEventListener() {}, removeEventListener() {},
  };
  function onParentMessage(m) {
    st.portMsgs.push(m);
    if (!m || typeof m !== 'object') return;
    if (m.op === 'ready' || Array.isArray(m.accepts)) {
      if (!st.readySeen) { st.readySeen = true; pushScreen(); }
      return;
    }
    if (m.op === 'call') {
      const verb = m.verb || '';
      const reply = /^media\.read$/.test(verb)
        ? { v: 2, op: 'reply', id: m.id, ok: true, data: { assets: [], next_cursor: null, current_actor: { kind: 'operator' } } }
        : { v: 2, op: 'reply', id: m.id, ok: false, error: { code: 'refused', message: 'fixture refuses ' + verb } };
      st.port.postMessage(reply);
      return;
    }
    if (m.op === 'slot') st.slotMsgs.push(m);
  }
  // Valid v2 push. `overrides` lets a case qualify or disqualify the marker.
  function pushScreen(overrides = {}) {
    const msg = {
      v: 2, op: 'screen', tag: 'studio', install_id: 'install-1', digest: 'sha256:' + 'd'.repeat(64),
      context_id: 'ctx-1', media: 'screen-media.v1',
      actions: ['media.read', 'run.start', 'media.original.download'],
      run_receipts: 1, original_downloads: 1,
      ...overrides,
    };
    st.screenPushed = msg;
    if (st.port) st.port.postMessage(msg);
  }
  const sandbox = { document, window,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    MessageChannel, MessagePort };
  const loader = makeLoader(sandbox);
  return { st, clock, pushScreen, loader, boot, document, window };
}

async function settle(fx, tries = 60) {
  for (let i = 0; i < tries; i++) {
    await ticks(3);
    fx.clock.advance(20);
  }
}

/* ------------------------------ transport ------------------------------- */
// Real connectFrameHost over MessageChannel. Each case gets a fresh fixture.
function connect(fx) {
  const mod = fx.loader.load(BOOT);
  const host = mod.connectFrameHost();
  return host;
}

function slotDone(fx, id) {
  fx.st.port.postMessage({ v: 2, op: 'slot-state', id, state: 'done' });
}

console.log('CAD-1365 original download bridge — app transport acceptance (Node MessagePort, not browser)');

/* 1. qualified host advertises download; unqualified does not */
{
  const fx = makeFixture();
  const host = connect(fx);
  await settle(fx, 40);
  const snap = host.snapshot();
  check('qualified v2 push (marker 1, media.original.download advertised) makes capabilities.download true',
    snap.status === 'ready' && snap.capabilities && snap.capabilities.download === true,
    JSON.stringify(snap.capabilities || snap.reason));
  host.close && host.close();
}
{
  const fx = makeFixture();
  const host = connect(fx);
  await settle(fx, 10);
  fx.pushScreen({ original_downloads: undefined });
  await settle(fx, 40);
  const snap = host.snapshot();
  check('missing original_downloads marker keeps download false (marker is support, not permission)',
    snap.status === 'ready' && snap.capabilities.download !== true, JSON.stringify(snap.capabilities));
  host.close && host.close();
}
{
  const fx = makeFixture();
  const host = connect(fx);
  await settle(fx, 10);
  fx.pushScreen({ v: 1, op: 'screen', media: undefined, original_downloads: 1, actions: ['media.read'] });
  await settle(fx, 40);
  const snap = host.snapshot();
  check('legacy v1 push with injected marker ignores the marker and keeps download false',
    !(snap.capabilities && snap.capabilities.download === true), JSON.stringify(snap.capabilities || snap.reason));
  host.close && host.close();
}
{
  const fx = makeFixture();
  const host = connect(fx);
  await settle(fx, 10);
  fx.pushScreen({ actions: ['media.read', 'run.start'] });
  await settle(fx, 40);
  const snap = host.snapshot();
  check('marker 1 without advertised media.original.download keeps download false',
    !(snap.capabilities && snap.capabilities.download === true), JSON.stringify(snap.capabilities || snap.reason));
  host.close && host.close();
}

/* 2. submit download sends exactly one protected footer slot, no call */
{
  const fx = makeFixture();
  const host = connect(fx);
  await settle(fx, 40);
  const pre = fx.st.slotMsgs.length;
  const res = host.submit({ kind: 'download', assetId: ASSET });
  await waitFor(() => fx.st.slotMsgs.length > pre, 100);
  const slot = fx.st.slotMsgs[fx.st.slotMsgs.length - 1];
  check('submit download sends exactly one slot message',
    fx.st.slotMsgs.length === pre + 1, `slots=${fx.st.slotMsgs.length - pre}`);
  check('slot verb is media.original.download with anchor footer and args exactly {asset_id}',
    !!slot && slot.verb === 'media.original.download' && slot.anchor === 'footer'
      && slot.args && Object.keys(slot.args).join(',') === 'asset_id' && slot.args.asset_id === ASSET,
    slot ? JSON.stringify({ verb: slot.verb, anchor: slot.anchor, args: slot.args }) : 'no slot');
  const directMedia = fx.st.portMsgs.filter((m) => m && m.op === 'call' && /download|original/.test(m.verb || ''));
  check('no direct media.original call or fetch-like verb is sent', directMedia.length === 0);
  const runStart = fx.st.slotMsgs.filter((m) => m.verb === 'run.start');
  check('download submit sends no run.start', runStart.length === 0);

  // 3. done -> metadata-only download_started, no revision/receipt/save-proof
  slotDone(fx, slot && slot.id);
  const outcome = await Promise.race([res, ticks(60).then(() => 'timeout')]);
  check('valid slot-state done resolves to status download_started',
    outcome && outcome.status === 'download_started',
    JSON.stringify(outcome));
  check('done outcome carries no revision, receipt id or save-proof field',
    outcome && !('revision' in outcome) && !('receiptId' in outcome) && !('receipt' in outcome)
      && !('saved' in outcome) && !('path' in outcome) && !('blob' in outcome), JSON.stringify(outcome));
  host.close && host.close();
}

/* 4. refusal, lost port and busy guard */
{
  const fx = makeFixture();
  const host = connect(fx);
  await settle(fx, 40);
  const res = host.submit({ kind: 'download', assetId: ASSET });
  await waitFor(() => fx.st.slotMsgs.length >= 1, 100);
  const slot = fx.st.slotMsgs[fx.st.slotMsgs.length - 1];
  fx.st.port.postMessage({ v: 2, op: 'slot-state', id: slot ? slot.id : 'none', state: 'refused', refusal: { code: 'refused', text: 'Nothing was downloaded.' } });
  const outcome = await Promise.race([res, ticks(60).then(() => 'timeout')]);
  check('valid host refusal resolves to status refused',
    outcome && outcome.status === 'refused', JSON.stringify(outcome));
  host.close && host.close();
}
{
  const fx = makeFixture();
  const host = connect(fx);
  await settle(fx, 40);
  const res = host.submit({ kind: 'download', assetId: ASSET });
  await waitFor(() => fx.st.slotMsgs.length >= 1, 100);
  const first = fx.st.slotMsgs.length;
  // A second submit while the first is pending must not send a second slot.
  host.submit({ kind: 'download', assetId: ASSET });
  await ticks(10);
  check('second submit while pending sends no second slot (one-shot, no auto resend)',
    fx.st.slotMsgs.length === first, `slots=${fx.st.slotMsgs.length}`);
  // Lost port after send is uncertain, not refused and not done.
  fx.st.port.close();
  const outcome = await Promise.race([res, ticks(80).then(() => 'timeout')]);
  check('port loss after send resolves to uncertain (not refused, not download_started)',
    outcome && outcome.status === 'uncertain', JSON.stringify(outcome));
  check('port loss causes no automatic resend',
    fx.st.slotMsgs.length === first, `slots=${fx.st.slotMsgs.length}`);
  host.close && host.close();
}

console.log(`\n${total - failures}/${total} ok, ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
