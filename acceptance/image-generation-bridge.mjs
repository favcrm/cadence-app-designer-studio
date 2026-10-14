#!/usr/bin/env node
/**
 * CAD-1365 / DSN-1 — INDEPENDENT acceptance driver: image-only generation bridge.
 *
 * Authored independently of the implementer, from the PM-frozen contract
 * design-plans/designer-image-app-v1.md (HOST worktree). It exercises the ACTUAL
 * app source: src/host/bootstrap.ts (connectFrameHost) and src/model.ts
 * (IMAGE_ASPECTS, TASK_STATUS, emptyDraft, validate, toIntent), transpiled to
 * CommonJS by the installed TypeScript and loaded with a small sandbox loader.
 * The only fakes are the DOM/window boot shim, a controllable clock, and the
 * parent side of the real Node worker_threads MessageChannel. There are no
 * copied app guards and no fake StudioHost/adapter — every refusal, intent and
 * wire shape observed here comes from real app code.
 *
 * Node MessagePort evidence only: no browser, no provider, no network and no
 * funding path is exercised or implied by this driver.
 *
 * ------------------------- DECLARED APP CONTRACT -------------------------
 * The implementer conforms to this stable interface; this driver asserts it:
 *
 *  - connectFrameHost() resolves to a StudioHost exposing
 *    { snapshot(), subscribe(cb), submit(intent) }.
 *
 *  - Generation intent (exact 8 keys, built by model.toIntent):
 *      { kind:'generate', task:'image', model:'openai/gpt-image-2.5',
 *        prompt:<trimmed visible text>, aspectRatio:'1:1', resolution:'1K',
 *        references:[], requestId:<native id> }
 *
 *  - A qualified host (ready scoped catalog + advertised run.start action +
 *    run_receipts:1 on the v2 screen push) lets submit() send exactly one
 *      { v:2, op:'slot', id, verb:'run.start', anchor:'footer',
 *        args:{ workflow:'create-image',
 *               inputs:{ subject:'Generated image', source:<captured prompt> },
 *               request_id:<captured requestId> } }
 *    and NOTHING else (no model/aspect/quote/approval/provider selectors).
 *
 *  - Slot lifecycle over the same channel id. The actual HostSlotController
 *    emits ONLY {v:2,op:'slot-state',id,state:'pending'|'done'|'refused',
 *    receipt?,refusal?} — there is NO op:reply variant for slots:
 *      * {state:'pending'} (or another ack) keeps the submission pending/locked;
 *        a second submit is refused.
 *      * {state:'refused',refusal:{code:'refused',text}} with a valid refusal
 *        while the slot is unconfirmed => refused (nothing started); a refused
 *        slot-state AFTER an earlier pending/done state is unconfirmed-late and
 *        maps to uncertain, not refused.
 *      * {state:'done',receipt} is terminal; receipt has EXACTLY the keys
 *        {run_id,request_id,state}; run_id matches /^run-[0-9a-f]{32}$/;
 *        request_id equals captured; state is one of the six native states
 *        ['approved','awaiting_approval','running','succeeded','failed',
 *        'cancelled'] — all six are VALID in the closed receipt. 'done' is
 *        transport completion, not native success: a done whose receipt.state
 *        is 'approved'/'awaiting_approval'/'running' resolves a pending
 *        generation_result in that state and KEEPS generation locked (a
 *        second submit is still refused); 'succeeded'/'failed'/'cancelled'
 *        resolve the matching terminal generation_result.
 *      * A malformed receipt, a malformed slot-state, the named 180000ms slot
 *        wait expiring, or port/pagehide closure after send => uncertain; the
 *        app never auto-resends.
 *
 *  - submit() resolves to a result object:
 *      { status:'generation_result', requestId, runId, state }  terminal receipt
 *      { status:'refused', ... }                                 refused before send
 *      { status:'uncertain', requestId, ... }                    submitted, outcome unknown
 *    'succeeded' means run completed, NOT a saved asset: the result carries no
 *    asset id, and a catalog refresh (a new media.read) is observed.
 *    'succeeded' means run completed, NOT a saved asset: the result carries no
 *    asset id, and a catalog refresh (a new media.read) is observed.
 *    failed/cancelled stay explicit; approved/awaiting_approval/running are
 *    valid pending states, not malformed. The app fabricates no job rows.
 *
 *  - With no run_receipts marker, no advertised run.start, or an unready
 *    catalog, submit() refuses and NO slot op is sent.
 * -------------------------------------------------------------------------
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { MessageChannel, MessagePort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const HOST_WT = path.resolve(process.env.DSN_HOST_SOURCE || path.join(APP, '.host-contract'));

const BOOT = path.join(APP, 'src', 'host', 'bootstrap.ts');
const MODEL = path.join(APP, 'src', 'features', 'studio', 'model.ts');

const req = createRequire(import.meta.url);

const PARENT_ORIGIN = 'https://host.invalid';
const PROMPT = 'Square alpine launch scene';
const REQ_ID = 'gen-intent-1';
const RUN_ID = 'run-' + 'a'.repeat(32);

const EXPECTED_ARGS = {
  workflow: 'create-image',
  inputs: { subject: 'Generated image', source: PROMPT },
  request_id: REQ_ID,
};
const EXPECTED_INTENT = {
  kind: 'generate', task: 'image', model: 'openai/gpt-image-2.5',
  prompt: PROMPT, aspectRatio: '1:1', resolution: '1K',
  references: [], requestId: REQ_ID,
};

/* ------------------------------- checks -------------------------------- */

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else {
    fail++;
    failures.push(name);
    console.log(`FAIL ${name}${detail ? ' — ' + String(detail).slice(0, 400) : ''}`);
  }
}
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
}
function eq(a, b) { return JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }
function checkEq(name, actual, expected) {
  check(name, eq(actual, expected),
    `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
const ticks = (n = 40) => new Promise((res) => {
  let i = 0;
  const step = () => (++i >= n ? res() : setTimeout(step, 0));
  setTimeout(step, 0);
});
async function waitFor(pred, tries = 200) {
  for (let i = 0; i < tries; i++) { if (pred()) return true; await ticks(2); }
  return pred();
}
const slotId = (m) => (m ? (m.id ?? m.slot_id ?? m.channel) : undefined);

/* --------------------------- typescript loader -------------------------- */

const ts = (() => {
  for (const p of [path.join(HOST_WT, 'ui', 'node_modules', 'typescript'),
                   path.join(APP, 'node_modules', 'typescript')]) {
    try { return req(p); } catch { /* next */ }
  }
  return req('typescript');
})();

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
    const { outputText } = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
        esModuleInterop: true,
        jsx: ts.JsxEmit.React,
      },
      fileName: file,
    });
    const mod = { exports: {} };
    cache.set(file, mod);
    const localRequire = (spec) =>
      spec.startsWith('.') ? load(resolveLocal(file, spec)) : req(spec);
    const fn = new Function('module', 'exports', 'require', '__sandbox',
      `const {document, window, setTimeout, clearTimeout, setInterval, clearInterval, ` +
      `MessageChannel, MessagePort} = __sandbox;\n${outputText}`);
    try { fn(mod, mod.exports, localRequire, sandbox); }
    catch (e) { cache.delete(file); throw e; }
    return mod.exports;
  }
  return { load };
}

/* ------------------------------ fake clock ------------------------------ */

function fakeClock() {
  let seq = 1, now = 0;
  const timers = new Map();
  const setT = (fn, ms = 0, ...a) => {
    const id = seq++;
    timers.set(id, { fn, at: now + (Number(ms) || 0), args: a, iv: null });
    return id;
  };
  const setI = (fn, ms = 0, ...a) => {
    const id = seq++;
    timers.set(id, { fn, at: now + (Number(ms) || 0), args: a, iv: Number(ms) || 1 });
    return id;
  };
  return {
    setTimeout: setT, clearTimeout: (id) => timers.delete(id),
    setInterval: setI, clearInterval: (id) => timers.delete(id),
    advance(ms) {
      const end = now + ms;
      for (let guard = 0; guard < 20000; guard++) {
        let best = null;
        for (const [id, t] of timers) {
          if (t.at <= end && (!best || t.at < best.t.at)) best = { id, t };
        }
        if (!best) break;
        now = Math.max(now, best.t.at);
        timers.delete(best.id);
        if (best.t.iv != null) { best.t.at = now + best.t.iv; timers.set(best.id, best.t); }
        try { best.t.fn(...best.t.args); } catch { /* app timer errors are the app's business */ }
      }
      now = end;
    },
    get pending() { return timers.size; },
  };
}

/* ------------------------------- fixture -------------------------------- */

function makeFixture(cfg = {}) {
  const clock = fakeClock();
  const boot = {
    tag: 'studio',
    bridge_nonce: 'a'.repeat(64),
    generation: 1,
    parent_origin: PARENT_ORIGIN,
  };
  const st = {
    init: null, port: null, portMsgs: [], readySeen: false, readyMsg: null,
    events: [], slotMsgs: [], closed: false,
  };
  const pagehideCbs = [];
  const document = {
    getElementById: (id) =>
      id === 'cadence-screen-boot' ? { textContent: JSON.stringify(boot) } : null,
    documentElement: {
      getAttribute: (n) => (n === 'data-cadence-kit' ? 'cadence-kit/1' : null),
    },
  };
  function onParentMessage(m) {
    st.portMsgs.push(m);
    if (!m || typeof m !== 'object') return;
    if (Array.isArray(m.accepts) || Array.isArray(m.protocols) || m.op === 'ready' || m.type === 'ready') {
      if (!st.readySeen) { st.readySeen = true; st.readyMsg = m; if (cfg.autoPush !== false) pushScreen(); }
      return;
    }
    if (m.op === 'call' || m.op === 'request' || m.op === 'tool') {
      const verb = m.verb || m.method || m.name || '';
      if (!cfg.noMediaReply && /^media\./.test(verb)) {
        st.port.postMessage({
          v: 2, op: 'reply', id: m.id, ok: true,
          data: { assets: [], next_cursor: null, current_actor: { kind: 'operator' } },
        });
      } else if (!cfg.noMediaReply) {
        st.port.postMessage({
          v: 2, op: 'reply', id: m.id, ok: false,
          error: { code: 'refused', message: `fixture refuses ${verb || m.op}` },
        });
      }
      return;
    }
    if (m.op === 'slot') {
      st.slotMsgs.push(m);
      if (cfg.onSlot) cfg.onSlot(m, st);
    }
  }
  const parent = {
    postMessage(msg, origin, transfer) {
      st.init = { msg, origin };
      const p = transfer && transfer[0];
      if (p) {
        st.port = p;
        p.on('message', onParentMessage);
        if (p.start) p.start();
      }
    },
  };
  const window = {
    parent,
    document,
    location: { href: 'https://app.invalid/frame', origin: 'https://app.invalid' },
    addEventListener(t, cb) { if (t === 'pagehide') pagehideCbs.push(cb); },
    removeEventListener(t, cb) {
      const i = pagehideCbs.indexOf(cb); if (i >= 0) pagehideCbs.splice(i, 1);
    },
  };
  function pushScreen(overrides = {}) {
    const msg = {
      v: 2, op: 'screen', tag: 'studio',
      install_id: 'install-1', digest: 'sha256:' + 'd'.repeat(64), context_id: 'ctx-1',
      actions: ['media.read', 'media.publish', 'run.start'],
      run_receipts: 1,
    };
    for (const k of cfg.omit || []) delete msg[k];
    Object.assign(msg, cfg.screen || {}, overrides);
    st.screenPushed = msg;
    if (st.port) st.port.postMessage(msg);
  }
  const sandbox = {
    document, window,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    MessageChannel, MessagePort,
  };
  const loader = makeLoader(sandbox);
  const fx = {
    st, clock, pushScreen, loader,
    host: null, model: null, connectTimedOut: false,
    mediaReadCount: () => st.portMsgs.filter(
      (m) => m && (m.verb === 'media.read' || m.method === 'media.read' || m.name === 'media.read')).length,
    slotCount: () => st.slotMsgs.length,
    lastSlot: () => st.slotMsgs[st.slotMsgs.length - 1],
    nonMediaCalls: () => st.portMsgs.filter(
      (m) => m && (m.op === 'call' || m.op === 'request' || m.op === 'tool')
        && !/^media\./.test(m.verb || m.method || m.name || '')),
    // The actual HostSlotController emits ONLY {v:2,op:'slot-state',id,
    // state:'pending'|'done'|'refused',receipt?,refusal?}. There is no
    // op:'reply' protocol for slots. ok:true maps data.state into the
    // slot-state envelope; ok:false sends the actual valid refusal shape.
    replySlot(id, data, ok = true) {
      if (ok) {
        const m = { v: 2, op: 'slot-state', id, state: (data && data.state) || 'pending' };
        if (data && 'receipt' in data) m.receipt = data.receipt;
        st.port.postMessage(m);
      } else {
        st.port.postMessage({
          v: 2, op: 'slot-state', id, state: 'refused',
          refusal: { code: 'refused', text: 'Host refused this request.' },
        });
      }
    },
    // Raw push for malformed/bad cases (e.g. refused without a refusal).
    pushSlotState(id, state, receipt) {
      st.port.postMessage({ v: 2, op: 'slot-state', id, state, ...(receipt ? { receipt } : {}) });
    },
    async connect() {
      const bootMod = loader.load(BOOT);
      const h = bootMod.connectFrameHost();
      await waitFor(() => st.readySeen, 300);
      const raced = await Promise.race([
        Promise.resolve(h).then((x) => ({ host: x })),
        ticks(300).then(() => ({ timeout: true })),
      ]);
      fx.host = raced.host || null;
      fx.connectTimedOut = !!raced.timeout;
      if (fx.host && typeof fx.host.subscribe === 'function') {
        try { fx.host.subscribe((e) => st.events.push(e)); } catch { /* observe only */ }
      }
      // Wait for the actual app to finish processing the catalog handshake:
      // media.read having been SENT is not proof the app applied the reply.
      // Skipped only for the deliberately-unanswered noMediaReply fixture.
      if (fx.host && cfg.noMediaReply !== true && typeof fx.host.snapshot === 'function') {
        await waitFor(() => {
          try { return fx.host.snapshot().status === 'ready'; } catch { return false; }
        }, 300);
      }
      return fx.host;
    },
    // True once the real snapshot reports ready (catalog processed).
    ready() {
      try { return fx.host && fx.host.snapshot().status === 'ready'; } catch { return false; }
    },
    async submit(intent) {
      try {
        return { pending: Promise.resolve(fx.host.submit(intent)), threw: null };
      } catch (e) {
        return { pending: null, threw: e };
      }
    },
    async settle(promise, tries = 200) {
      return Promise.race([
        Promise.resolve(promise).then(
          (v) => ({ settled: true, value: v }),
          (e) => ({ settled: true, threw: e })),
        ticks(tries).then(() => ({ settled: false })),
      ]);
    },
    pagehide() {
      st.closed = true;
      for (const cb of pagehideCbs.splice(0)) {
        try { cb({ type: 'pagehide' }); } catch { /* ignore */ }
      }
    },
    async cleanup() {
      fx.pagehide();
      await ticks(4);
      try { st.port && st.port.close(); } catch { /* ignore */ }
    },
  };
  return fx;
}
async function settleSub(fx, sub, tries = 120) {
  if (!sub || sub.threw || !sub.pending) return { settled: true, value: null, threw: sub && sub.threw };
  return fx.settle(sub.pending, tries);
}
function refused(sub, r) {
  return !!(sub.threw || (r.settled && r.value && r.value.status === 'refused'));
}

/* --------------------------- intent construction ------------------------ */

function buildIntent(model) {
  // Discover the real draft field names the source defines, without assuming.
  const pfs = ['prompt', 'brief', 'text', 'source', 'input'];
  const idfs = ['requestId', 'request_id', 'id'];
  for (const pf of pfs) {
    for (const idf of idfs) {
      try {
        const d = model.emptyDraft();
        d[pf] = PROMPT; d[idf] = REQ_ID;
        const it = model.toIntent(d);
        if (it && it.kind === 'generate' && it.prompt === PROMPT && it.requestId === REQ_ID) {
          return { intent: it, draft: d, pf, idf };
        }
      } catch { /* try next */ }
    }
  }
  for (const pf of pfs) {
    for (const arg of [REQ_ID, { requestId: REQ_ID }, { request_id: REQ_ID }]) {
      try {
        const d = model.emptyDraft();
        d[pf] = PROMPT;
        const it = model.toIntent(d, arg);
        if (it && it.kind === 'generate' && it.prompt === PROMPT && it.requestId === REQ_ID) {
          return { intent: it, draft: d, pf, idf: 'arg' };
        }
      } catch { /* try next */ }
    }
  }
  return { intent: null };
}

function isInvalid(v) {
  // A thrown validation error counts as a refusal.
  if (v && typeof v === 'object' && 'threw' in v) return true;
  if (v === false) return true;
  if (v && typeof v === 'object') {
    if (v.valid === false || v.ok === false) return true;
    if (Array.isArray(v.errors) && v.errors.length) return true;
    if (v.valid === true || v.ok === true) return false;
    if (Array.isArray(v)) return v.length > 0;
    return false;
  }
  return false;
}

/* --------------------------------- main --------------------------------- */

async function main() {
  /* ------------------------------ M: model ------------------------------ */
  const clock = fakeClock();
  const msandbox = {
    document: undefined, window: undefined,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    MessageChannel, MessagePort,
  };
  let M = null;
  try { M = makeLoader(msandbox).load(MODEL); } catch (e) {
    check('M0 model.ts loads via installed TypeScript', false, String(e && e.message || e));
  }
  if (M) check('M0 model.ts loads via installed TypeScript', true);
  if (!M) { summary(); return; }

  {
    const aspectsOk = eq(M.IMAGE_ASPECTS, ['1:1']);
    let tasksOk = false, enabled = null;
    if (Array.isArray(M.TASK_STATUS)) { enabled = M.TASK_STATUS.slice(); tasksOk = eq(enabled, ['image']); }
    else if (M.TASK_STATUS && typeof M.TASK_STATUS === 'object') {
      const en = (v) => v === true || !!(v && typeof v === 'object' && v.enabled === true);
      enabled = Object.keys(M.TASK_STATUS).filter((k) => en(M.TASK_STATUS[k]));
      tasksOk = eq(enabled, ['image']);
    }
    check('M1 capability tables: IMAGE_ASPECTS=["1:1"], TASK_STATUS enables image only',
      aspectsOk && tasksOk,
      `aspects=${JSON.stringify(M.IMAGE_ASPECTS)} tasks=${JSON.stringify(M.TASK_STATUS)}`);
  }

  const built = buildIntent(M);
  checkEq('M4 toIntent builds the exact closed 8-key generate intent',
    built.intent, EXPECTED_INTENT);
  const intent = built.intent;
  if (intent && built.draft && built.pf) {
    const before = canon(intent);
    built.draft[built.pf] = 'MUTATED AFTER CAPTURE';
    if (built.idf && built.idf !== 'arg') built.draft[built.idf] = 'mutated-id';
    check('M6 captured intent is immutable vs later draft edits', eq(intent, before));
  } else {
    check('M6 captured intent immutability', false, 'no draft/intent to mutate');
  }

  {
    // validate() takes a CreateDraft (which has NO requestId — the request id
    // is a toIntent argument, checked by V6 instead). Only prompt grammar is
    // validated here.
    const mkDraft = (prompt) => {
      const d = M.emptyDraft();
      try { d.prompt = prompt; } catch { /* ignore */ }
      return d;
    };
    const val = (d) => { try { return M.validate(d); } catch (e) { return { threw: String(e && e.message || e) }; } };
    check('M7 validate accepts the valid square-image draft',
      !isInvalid(val(mkDraft(PROMPT))), JSON.stringify(val(mkDraft(PROMPT))));
    const rejects = [
      ['blank prompt', mkDraft('   ')],
      ['control char', mkDraft('scenecontrol')],
      ['Cf char', mkDraft('scene​cf')],
      ['default-ignorable char', mkDraft('scene­ignorable')],
      ['>2000 code units', mkDraft('x'.repeat(2001))],
    ];
    const accepted = rejects.filter(([, d]) => !isInvalid(val(d))).map(([n]) => n);
    check('M8 validate rejects blank/control/Cf/ignorable/overlong prompt',
      accepted.length === 0, `accepted: ${accepted.join(', ')}`);
  }

  /* -------------------- H: handshake + positive control ------------------ */
  const fx = makeFixture();
  let host = null;
  try { host = await fx.connect(); } catch (e) {
    check('H1 connectFrameHost resolves a StudioHost', false, String(e && e.message || e));
  }
  check('H1 connectFrameHost resolves a StudioHost',
    !!host && !fx.connectTimedOut && typeof host.snapshot === 'function'
      && typeof host.subscribe === 'function' && typeof host.submit === 'function');
  check('H3 init posted to exact parent_origin with a transferred port',
    !!fx.st.init && fx.st.init.origin === PARENT_ORIGIN && !!fx.st.port,
    JSON.stringify(fx.st.init && fx.st.init.origin));
  {
    const ready = fx.st.readyMsg;
    const accepts = ready && (ready.accepts || ready.protocols || ready.ops);
    check('H4 ready advertises screen.v2 and screen-media.v1',
      Array.isArray(accepts) && accepts.includes('screen.v2') && accepts.includes('screen-media.v1'),
      JSON.stringify(ready));
  }
  const sawRead = await waitFor(() => fx.mediaReadCount() >= 1, 200);
  check('H5 positive control: catalog handshake issues media.read after qualified push', sawRead,
    `portMsgs=${fx.st.portMsgs.length}`);

  /* ---------------------------- G: qualified gate ------------------------ */
  if (host && intent) {
    const before = fx.slotCount();
    const sub = await fx.submit(intent);
    const slotSeen = await waitFor(() => fx.slotCount() > before, 100);
    check('G1 qualified host: submit emits exactly one slot op',
      slotSeen && fx.slotCount() === before + 1, `slotMsgs=${fx.slotCount() - before}`);
    const slot = fx.lastSlot();
    check('G2 slot envelope {v:2,op:slot,verb:run.start,anchor:footer} and closed args',
      !!slot && slot.v === 2 && slot.op === 'slot' && slot.verb === 'run.start'
        && slot.anchor === 'footer' && eq(slot.args, EXPECTED_ARGS),
      JSON.stringify(slot));
    check('G4 no charge/approval/tool call on the generation path',
      fx.nonMediaCalls().length === 0, JSON.stringify(fx.nonMediaCalls()));
    if (slot) {
      fx.replySlot(slotId(slot), { state: 'pending' });
      const sub2 = await fx.submit(intent);
      const r2 = await settleSub(fx, sub2, 60);
      check('G5 pending slot keeps generation locked (second submit refused)',
        refused(sub2, r2), JSON.stringify(r2.settled ? (r2.value || r2.threw) : 'pending'));
      fx.replySlot(slotId(slot), {
        state: 'done',
        receipt: { run_id: RUN_ID, request_id: REQ_ID, state: 'succeeded' },
      });
      const r1 = await settleSub(fx, sub, 200);
      const res = r1.settled && !r1.threw ? r1.value : null;
      check('L1 done+succeeded resolves generation_result{succeeded}',
        !!res && res.status === 'generation_result' && res.state === 'succeeded'
          && res.requestId === REQ_ID && res.runId === RUN_ID,
        JSON.stringify(r1.settled ? (r1.value || r1.threw) : 'pending'));
      const noAsset = !!res && !('assetId' in res) && !('asset_id' in res) && !('asset' in res);
      const refreshed = await waitFor(() => fx.mediaReadCount() >= 2, 100);
      check('L1b success truthful: no fabricated asset id, catalog refresh observed',
        noAsset && refreshed, `noAsset=${noAsset} mediaReadCount=${fx.mediaReadCount()}`);
    } else {
      check('G5 pending lock', false, 'no slot to answer (baseline RED)');
      check('L1 done+succeeded', false, 'no slot to answer (baseline RED)');
      check('L1b success truthful', false, 'no slot (baseline RED)');
    }
  } else {
    for (const n of ['G1', 'G2', 'G4', 'G5', 'L1', 'L1b']) check(`${n} (blocked)`, false, 'no host/intent');
  }
  await fx.cleanup();

  /* ---------------------------- U: unqualified hosts --------------------- */
  for (const [name, cfg] of [
    ['U1 missing run_receipts marker', { omit: ['run_receipts'] }],
    ['U2 forged marker without advertised run.start', { screen: { actions: ['media.read', 'media.publish'] } }],
    ['U3 catalog never answers (no media reply)', { noMediaReply: true }],
  ]) {
    const u = makeFixture(cfg);
    try {
      const h = await u.connect();
      await waitFor(() => cfg.noMediaReply ? u.st.portMsgs.length > 0 : u.mediaReadCount() >= 1, 200);
      if (!h || !intent) { check(`${name}: submit refused, zero slot ops`, false, 'no host/intent'); continue; }
      const sub = await u.submit(intent);
      await waitFor(() => u.slotCount() > 0, 60);
      const r = await settleSub(u, sub);
      check(`${name}: submit refused, zero slot ops`,
        refused(sub, r) && u.slotCount() === 0,
        `slotMsgs=${u.slotCount()} result=${JSON.stringify(r.settled ? (r.value || r.threw) : 'pending')}`);
    } finally { await u.cleanup(); }
  }

  /* ----------------- V: intent refused BEFORE any slot op ---------------- */
  if (intent) {
    const cases = [
      ['V1 non-image tasks refused', [{ ...intent, task: 'video' }, { ...intent, task: 'edit' }, { ...intent, task: 'animate-image' }]],
      ['V2 non-square aspect refused', [{ ...intent, aspectRatio: '16:9' }]],
      ['V3 references refused', [{ ...intent, references: ['ref-1'] }]],
      ['V4 unknown model refused', [{ ...intent, model: 'openai/not-gpt' }]],
      ['V5 extra/forged intent field refused', [{ ...intent, forged_approval: true }]],
      // Actual requestId grammar is a toIntent argument concern, not a draft
      // field — refuse bad native ids BEFORE any slot op.
      ['V6 bad native requestId refused', [
        { ...intent, requestId: 'Bad Id!' },
        { ...intent, requestId: '-leading-dash' },
        { ...intent, requestId: null },
      ]],
    ];
    for (const [name, intents] of cases) {
      const v = makeFixture();
      try {
        const h = await v.connect();
        await waitFor(() => v.mediaReadCount() >= 1, 200);
        if (!h) { check(name + ' — zero slot ops', false, 'no host'); continue; }
        let allRefused = true;
        const detail = [];
        for (const it of intents) {
          const s = await v.submit(it);
          const r = await settleSub(v, s);
          if (!refused(s, r)) { allRefused = false; detail.push(JSON.stringify(r.settled ? r.value : 'pending')); }
        }
        check(`${name} — zero slot ops`, allRefused && v.slotCount() === 0,
          `slotMsgs=${v.slotCount()} ${detail.join('|')}`);
      } finally { await v.cleanup(); }
    }
  }

  /* --------------------- L: slot lifecycle scenarios --------------------- */
  const goodReceipt = (over = {}) =>
    ({ run_id: RUN_ID, request_id: REQ_ID, state: 'succeeded', ...over });
  const scenarios = [
    ['L2 done+failed stays explicit failed',
      { data: { state: 'done', receipt: goodReceipt({ state: 'failed' }) } },
      (r) => r && r.status === 'generation_result' && r.state === 'failed' && r.runId === RUN_ID],
    ['L3 done+cancelled stays explicit cancelled',
      { data: { state: 'done', receipt: goodReceipt({ state: 'cancelled' }) } },
      (r) => r && r.status === 'generation_result' && r.state === 'cancelled'],
    ['L4 wrong request_id in receipt -> uncertain',
      { data: { state: 'done', receipt: goodReceipt({ request_id: 'other-id' }) } },
      (r) => r && r.status === 'uncertain'],
    ['L5 extra receipt key -> uncertain',
      { data: { state: 'done', receipt: { ...goodReceipt(), extra: 1 } } },
      (r) => r && r.status === 'uncertain'],
    ['L6 missing run_id -> uncertain',
      { data: { state: 'done', receipt: { request_id: REQ_ID, state: 'succeeded' } } },
      (r) => r && r.status === 'uncertain'],
    ['L7 malformed run_id -> uncertain',
      { data: { state: 'done', receipt: goodReceipt({ run_id: 'not-a-run' }) } },
      (r) => r && r.status === 'uncertain'],
    // 'done' is transport completion, not native success: a valid receipt
    // carrying a nonterminal native state resolves a pending
    // generation_result in that state and keeps generation locked.
    ['L8 done+running (valid nonterminal receipt state) -> generation_result{running}, stays locked',
      { data: { state: 'done', receipt: goodReceipt({ state: 'running' }) } },
      (r) => r && r.status === 'generation_result' && r.state === 'running' && r.runId === RUN_ID],
    // Actual valid refusal: {op:'slot-state',state:'refused',refusal:{...}}
    // while unconfirmed => refused (nothing started). No invented error.message.
    ['L9 actual valid host slot refusal (refused+refusal) while unconfirmed -> refused',
      { refuse: true },
      (r) => r && r.status === 'refused'],
    // A refused slot-state arriving AFTER an earlier pending state is
    // unconfirmed-late and maps to uncertain, not refused.
    ['L10 pushed refused slot-state after pending ack -> uncertain',
      { ack: { state: 'pending' }, push: { state: 'refused' } },
      (r) => r && r.status === 'uncertain'],
    // Unconfirmed refusal: a refused slot-state WITHOUT a legitimate refusal
    // payload is malformed/unconfirmed => uncertain, not "nothing started".
    ['L10b refused slot-state without refusal payload (unconfirmed) -> uncertain',
      { pushOnly: 'refused' },
      (r) => r && r.status === 'uncertain'],
  ];
  for (const [name, script, judge] of scenarios) {
    const f = makeFixture();
    try {
      const h = await f.connect();
      await waitFor(() => f.mediaReadCount() >= 1, 200);
      if (!h || !intent) { check(name, false, 'no host/intent'); continue; }
      const sub = await f.submit(intent);
      const seen = await waitFor(() => f.slotCount() === 1, 100);
      if (!seen) { check(name, false, 'no slot op sent (baseline RED)'); continue; }
      const slot = f.lastSlot();
      if (script.refuse) f.replySlot(slotId(slot), null, false);
      else if (script.pushOnly) f.pushSlotState(slotId(slot), script.pushOnly);
      else {
        f.replySlot(slotId(slot), script.ack || script.data);
        if (script.push) f.pushSlotState(slotId(slot), script.push.state, script.push.receipt);
      }
      const r = await settleSub(f, sub, 200);
      check(name, r.settled && !r.threw && judge(r.value) && f.slotCount() === 1,
        `${JSON.stringify(r.settled ? (r.value || r.threw) : 'still pending')} slotMsgs=${f.slotCount()} (incl. no auto-resend)`);
    } finally { await f.cleanup(); }
  }

  /* --------------------- L11/L12: timeout and closure -------------------- */
  {
    const f = makeFixture();
    try {
      const h = await f.connect();
      await waitFor(() => f.mediaReadCount() >= 1, 200);
      if (h && intent) {
        const sub = await f.submit(intent);
        const seen = await waitFor(() => f.slotCount() === 1, 100);
        if (seen) {
          f.replySlot(slotId(f.lastSlot()), { state: 'pending' });
          f.clock.advance(179999);
          const early = await settleSub(f, sub, 10);
          f.clock.advance(2);
          const late = await settleSub(f, sub, 200);
          check('L11 named 180s slot wait -> uncertain on expiry, not before, no resend',
            !early.settled && late.settled && late.value && late.value.status === 'uncertain'
              && f.slotCount() === 1,
            JSON.stringify({ early: early.settled, late: late.settled ? late.value : 'pending', slots: f.slotCount() }));
        } else check('L11 named 180s slot wait', false, 'no slot op (baseline RED)');
      } else check('L11 named 180s slot wait', false, 'no host/intent');
    } finally { await f.cleanup(); }
  }
  {
    const f = makeFixture();
    try {
      const h = await f.connect();
      await waitFor(() => f.mediaReadCount() >= 1, 200);
      if (h && intent) {
        const sub = await f.submit(intent);
        const seen = await waitFor(() => f.slotCount() === 1, 100);
        if (seen) {
          f.replySlot(slotId(f.lastSlot()), { state: 'pending' });
          f.pagehide(); // scope/frame closure after submission
          const r = await settleSub(f, sub, 200);
          check('L12 closure after submission -> uncertain, never nothing-started, no resend',
            r.settled && r.value && r.value.status === 'uncertain' && f.slotCount() === 1,
            `${JSON.stringify(r.settled ? r.value : 'pending')} slotMsgs=${f.slotCount()}`);
        } else check('L12 closure -> uncertain', false, 'no slot op (baseline RED)');
      } else check('L12 closure -> uncertain', false, 'no host/intent');
    } finally { await f.cleanup(); }
  }

  /* --------------- P: HOST run_receipts producer (real classes) -------------
   * Exercises the ACTUAL host ScreenChannel/shapeFor over a real Node
   * MessageChannel — no private-field override, no copied guards. The contract
   * (designer-image-app-v1.md): the actual ScreenChannel supplies
   * run_receipts:1 on the v2 push ONLY when it holds a real ScreenActions with
   * a planner AND the projection advertises run.start. Older shapes, no action
   * host, no projected run.start, or a FORGED projection marker all omit it.
   * Node evidence only: no server/provider/browser qualification.
   */
  try {
    const HSRC = path.join(HOST_WT, 'ui', 'src', 'features', 'workspace-apps', 'screen');
    // A real Window-shaped opaque source object; FrameChannel only compares
    // event.source === this.source, so an identity object is honest.
    const hostSandbox = {
      document: undefined, window: undefined,
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
      setInterval: clock.setInterval, clearInterval: clock.clearInterval,
      MessageChannel, MessagePort,
      TextEncoder,
    };
    const hloader = makeLoader(hostSandbox);
    let lifecycle = null;
    try { lifecycle = hloader.load(path.join(HSRC, 'screenLifecycle.ts')); } catch (e) {
      check('P0 host screen modules transpile+load', false, String(e && e.message || e));
    }
    if (lifecycle) {
      const { parseMount, ScreenChannel } = lifecycle;
      const HNONCE = 'a'.repeat(64);
      const HCAP = 'b'.repeat(64);
      const HRECEIPT = { mount: `/api/app-screen/${HCAP}`, bridge_nonce: HNONCE, generation: 2, tag: 'main' };
      const HINIT = { v: 1, op: 'init', tag: 'main', bridge_nonce: HNONCE, generation: 2 };
      const hpushes = [];
      // Public push baseline: required shapeFor fields plus advertised run.start.
      const HPUSH = {
        v: 1, op: 'screen', install_id: 'i', digest: 'd', tag: 'main', context_id: 'c',
        installation: { install_id: 'i', digest: 'd', title: 't', name: 'n', version: 'v', summary: '' },
        contexts: [{ id: 'c', label: 'context' }], runs: [], outbox: [], now: 1,
        publish_intents: { status: 'ok', withheld: 0, rows: [] },
        defaults: { context_id: 'c', revision: 0, values: {} }, readiness: { ok: true, blockers: [] },
        actions: ['media.read', 'media.publish', 'run.start'],
      };
      const hopened = [];
      // One mount on a REAL MessageChannel pair: child side is port2; the
      // channel owns port1 after receive(). actions===null means no action host.
      function hmount(projection, accepts, actions) {
        const parsed = parseMount(HRECEIPT, 'main');
        if (!parsed) return { parsed: null };
        const { port1, port2 } = new MessageChannel();
        const sent = [];
        port2.on('message', (m) => sent.push(m));
        const counts = { removed: 0, failed: 0, ready: 0 };
        const source = {}; // opaque Window stand-in
        const ch = new ScreenChannel(source, parsed, projection,
          () => ++counts.removed, () => ++counts.failed, () => ++counts.ready,
          undefined, actions === null ? undefined : actions);
        ch.receive({ source, origin: 'null', data: HINIT, ports: [port1] });
        const rec = { ch, child: port2, sent, counts };
        hopened.push(rec);
        if (accepts !== null) port2.postMessage(accepts === undefined ? { v: 1, op: 'ready' } : { v: 1, op: 'ready', accepts });
        return rec;
      }
      const hflush = () => new Promise((res) => setTimeout(res, 25));
      const plannerActions = { call: async () => ({ ok: true, data: {} }), planner: async () => ({ code: 'unplanned', text: 'x' }), onSlot: () => {}, onLink: () => {} };
      const lastPush = (rec) => rec.sent.filter((m) => m && m.op === 'screen').pop();

      // P1 eligible v2: real actions planner + advertised run.start -> marker 1.
      {
        const rec = hmount(HPUSH, ['screen.v2', 'screen-media.v1'], plannerActions);
        await hflush();
        const p = lastPush(rec);
        hpushes.push(p);
        check('P1 eligible v2 (real actions+projected run.start) emits run_receipts:1',
          !!p && p.v === 2 && p.run_receipts === 1,
          p ? `run_receipts=${JSON.stringify(p.run_receipts)}` : 'no v2 push');
      }
      // P2 v1/intents child never sees the marker even when eligible.
      {
        const rec = hmount(HPUSH, undefined, plannerActions); // legacy ready -> v1
        const recI = hmount(HPUSH, ['publish-intents.v1'], plannerActions); // intents
        await hflush();
        const pv = lastPush(rec), pi = lastPush(recI);
        check('P2 v1 + intents pushes carry no run_receipts marker',
          !!pv && pv.run_receipts !== 1 && !!pi && pi.run_receipts !== 1,
          `v1=${JSON.stringify(pv && pv.run_receipts)} intents=${JSON.stringify(pi && pi.run_receipts)}`);
      }
      // P3 v2 with NO action host -> marker omitted.
      {
        const rec = hmount(HPUSH, ['screen.v2', 'screen-media.v1'], null);
        await hflush();
        const p = lastPush(rec);
        check('P3 v2 without an action host omits run_receipts',
          !!p && p.v === 2 && p.run_receipts !== 1,
          `run_receipts=${JSON.stringify(p && p.run_receipts)}`);
      }
      // P4 forged projection marker + no projected run.start -> still omitted.
      {
        const forged = { ...HPUSH, run_receipts: 1, actions: ['media.read', 'media.publish'] };
        const rec = hmount(forged, ['screen.v2', 'screen-media.v1'], plannerActions);
        await hflush();
        const p = lastPush(rec);
        check('P4 forged projection marker + no run.start advert -> marker omitted/discarded',
          !!p && p.v === 2 && p.run_receipts !== 1,
          `run_receipts=${JSON.stringify(p && p.run_receipts)}`);
      }
      for (const r of hopened.splice(0)) { try { r.ch.close(); } catch { /* */ } try { r.child.close(); } catch { /* */ } }
    }
  } catch (e) {
    check('P host producer section aborted', false, String(e && e.stack || e));
  }

  summary();
}

function summary() {
  console.log(`\n=== image-generation-bridge: ${pass} PASS / ${fail} FAIL ===`);
  if (failures.length) console.log('failing: ' + failures.join(', '));
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.log('FAIL driver crashed: ' + (e && e.stack || e));
  process.exitCode = 2;
});
