// DSN-14 — screen-surfaces.v1 drawer bridge acceptance.
//
// Proves the app frame's `screen-surfaces.v1` use against two hosts:
//   F*: a scripted host over a real Node MessageChannel, exercising the
//       transpiled src/host/bootstrap.ts exactly as it ships (no app imports
//       other than its own relative modules).
//   H*: the ACTUAL Cadence host ScreenChannel and screenProtocol parsers from
//       DSN_HOST_SOURCE (a Cadence ui/src checkout), so the exact arguments the
//       frame sends are the ones the host admits.
// Node evidence only: no browser, board, provider or paid action is involved.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { MessageChannel, MessagePort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const HOST_WT = path.resolve(process.env.DSN_HOST_SOURCE || path.join(APP, '.host-contract'));
const BOOT = path.join(APP, 'src', 'host', 'bootstrap.ts');
const req = createRequire(import.meta.url);
const ASSET = 'med-' + 'a'.repeat(32);

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}${detail ? ' — ' + String(detail).slice(0, 400) : ''}`); }
}
const flush = (ms = 20) => new Promise((res) => setTimeout(res, ms));
async function waitFor(pred, tries = 100) {
  for (let i = 0; i < tries; i++) { if (pred()) return true; await flush(5); }
  return pred();
}

const ts = (() => {
  for (const p of [path.join(HOST_WT, 'ui', 'node_modules', 'typescript'), path.join(APP, 'node_modules', 'typescript')]) {
    try { return req(p); } catch { /* next */ }
  }
  return req('typescript');
})();

function makeLoader(sandbox) {
  const cache = new Map();
  function resolveLocal(from, spec) {
    const base = path.resolve(path.dirname(from), spec);
    for (const t of [base, base + '.ts', base + '.tsx', base + '.js', path.join(base, 'index.ts')]) {
      if (fs.existsSync(t) && fs.statSync(t).isFile()) return t;
    }
    throw new Error(`loader: cannot resolve ${spec} from ${from}`);
  }
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true, jsx: ts.JsxEmit.React },
      fileName: file,
    });
    const mod = { exports: {} };
    cache.set(file, mod);
    const localRequire = (spec) => (spec.startsWith('.') ? load(resolveLocal(file, spec)) : req(spec));
    const fn = new Function('module', 'exports', 'require', '__sandbox',
      `const {document, window, setTimeout, clearTimeout, setInterval, clearInterval, MessageChannel, MessagePort, TextEncoder} = __sandbox;\n${outputText}`);
    fn(mod, mod.exports, localRequire, sandbox);
    return mod.exports;
  }
  return { load };
}

/* ------------------------------ F: frame side ----------------------------- */

/** One frame wired to a scripted host. `onCall(m)` returns the reply body
 *  ({ok:true,data} | {ok:false,refusal}) or undefined for no reply. */
function frame(onCall) {
  const st = { port: null, msgs: [], ready: null };
  const boot = { tag: 'studio', bridge_nonce: 'a'.repeat(64), generation: 1, parent_origin: 'https://host.invalid' };
  const document = {
    getElementById: (id) => (id === 'cadence-screen-boot' ? { textContent: JSON.stringify(boot) } : null),
    documentElement: { getAttribute: (n) => (n === 'data-cadence-kit' ? 'cadence-kit/1' : null) },
  };
  const window = {
    parent: {
      postMessage(_msg, _origin, transfer) {
        st.port = transfer && transfer[0];
        st.port.on('message', (m) => {
          st.msgs.push(m);
          if (m && m.op === 'ready') { st.ready = m; return; }
          if (m && m.op === 'call') {
            const body = onCall(m);
            if (body) st.port.postMessage({ v: 2, op: 'reply', id: m.id, ...body });
          }
        });
        st.port.start?.();
      },
    },
    document,
    addEventListener() {},
  };
  const sandbox = { document, window, setTimeout, clearTimeout, setInterval, clearInterval, MessageChannel, MessagePort, TextEncoder };
  const host = makeLoader(sandbox).load(BOOT).connectFrameHost();
  const send = (m) => st.port.postMessage(m);
  const push = () => send({ v: 2, op: 'screen', tag: 'studio', install_id: 'i', digest: 'd', actions: ['media.read', 'media.publish'] });
  const calls = (verb) => st.msgs.filter((m) => m && m.op === 'call' && m.verb === verb);
  return { st, host, send, push, calls, close: () => { try { st.port.close(); } catch { /* */ } } };
}

const catalogReply = (m) => (m.verb === 'media.read'
  ? { ok: true, data: { assets: [{ id: ASSET, title: 'Plane', kind: 'image', lifecycle: 'draft', revision: 1, creator: { kind: 'user', id: 'u1' }, created: 1, updated: 1 }], next_cursor: null, current_actor: { kind: 'user', id: 'u1' } } }
  : undefined);

async function frameChecks() {
  // F1: ready opts into surfaces alongside the existing contracts.
  {
    const f = frame(catalogReply);
    await waitFor(() => f.st.ready);
    const a = f.st.ready?.accepts ?? [];
    check('F1 ready accepts screen.v2 + screen-media.v1 + screen-surfaces.v1',
      a.includes('screen.v2') && a.includes('screen-media.v1') && a.includes('screen-surfaces.v1') && a.length <= 8, JSON.stringify(a));
    check('F2 no surface message yet: frame is primary, not modal',
      f.host.surface().role === 'primary' && f.host.surface().modal === false);
    f.close();
  }
  // F3–F6: primary opens the board drawer with the exact closed arguments.
  {
    let mode = 'ok';
    const f = frame((m) => {
      if (m.verb === 'screen.drawer.open') {
        return mode === 'ok' ? { ok: true, data: { mode: 'drawer', surface: 'asset' } }
          : { ok: false, refusal: { code: 'unavailable', text: 'This app cannot open a board drawer here.' } };
      }
      return catalogReply(m);
    });
    await waitFor(() => f.st.ready);
    f.send({ v: 1, op: 'surface', role: 'primary', modal: false });
    f.push();
    await waitFor(() => f.host.snapshot().status === 'ready');
    const opened = await f.host.openDrawer({ assetId: ASSET, revision: 1 });
    const sent = f.calls('screen.drawer.open')[0];
    check('F3 open sends exactly {surface:"asset", size:"wide", context:{asset_id, revision}}',
      !!sent && JSON.stringify(sent.args) === JSON.stringify({ surface: 'asset', size: 'wide', context: { asset_id: ASSET, revision: 1 } }),
      JSON.stringify(sent && sent.args));
    check('F4 an ok {mode:"drawer"} reply is "opened"', opened === 'opened', opened);
    mode = 'refuse';
    check('F5 a host refusal is "refused" (caller falls back in-frame)', (await f.host.openDrawer({ assetId: ASSET, revision: 1 })) === 'refused');
    const before = f.calls('screen.drawer.open').length;
    const bad = await f.host.openDrawer({ assetId: 'not-an-asset', revision: 1 });
    check('F6 a malformed pointer is not sent (local not_sent, not a host refusal)', bad === 'not_sent' && f.calls('screen.drawer.open').length === before);
    mode = 'ok';
    const created = await f.host.openCreateDrawer();
    const createSent = f.calls('screen.drawer.open').slice(-1)[0];
    check('F6b openCreateDrawer sends exactly {surface:"create", size:"narrow"} and returns "opened"',
      created === 'opened' && !!createSent && JSON.stringify(createSent.args) === JSON.stringify({ surface: 'create', size: 'narrow' }),
      JSON.stringify({ created, args: createSent && createSent.args }));
    // F7: closing the board drawer (modal true -> false) re-reads the catalog.
    const reads = f.calls('media.read').length;
    f.send({ v: 1, op: 'surface', role: 'primary', modal: true });
    await flush();
    f.send({ v: 1, op: 'surface', role: 'primary', modal: false });
    check('F7 drawer closed over the primary re-reads the catalog',
      await waitFor(() => f.calls('media.read').length > reads), `reads ${reads} -> ${f.calls('media.read').length}`);
    // F8: a malformed surface message is ignored, not fatal.
    f.send({ v: 1, op: 'surface', role: 'boss', modal: 'yes' });
    await flush();
    await waitFor(() => f.host.snapshot().status === 'ready');
    check('F8 malformed surface push ignored; frame stays connected and primary',
      f.host.snapshot().status === 'ready' && f.host.surface().role === 'primary',
      `status=${JSON.stringify(f.host.snapshot())} role=${f.host.surface().role}`);
    f.close();
  }
  // F9–F12: a drawer child reads its context and closes itself; never opens.
  {
    let ctx = { asset_id: ASSET, revision: 1 };
    const f = frame((m) => {
      if (m.verb === 'screen.drawer.context') return { ok: true, data: { context: ctx } };
      if (m.verb === 'screen.drawer.close') return { ok: true, data: { mode: 'outlet' } };
      return catalogReply(m);
    });
    await waitFor(() => f.st.ready);
    f.send({ v: 1, op: 'surface', role: 'drawer', modal: false, surface: 'asset' });
    f.push();
    await waitFor(() => f.host.surface().role === 'drawer');
    check('F9 drawer surface push sets role "drawer" and its surface name',
      f.host.surface().role === 'drawer' && f.host.surface().name === 'asset');
    const read = await f.host.drawerContext();
    check('F10 drawer child reads back {assetId, revision} via screen.drawer.context {}',
      !!read && read.assetId === ASSET && read.revision === 1 && JSON.stringify(f.calls('screen.drawer.context')[0]?.args) === '{}',
      JSON.stringify(read));
    ctx = { asset_id: ASSET, revision: 1, extra: true };
    check('F11 a context with extra keys is rejected (null)', (await f.host.drawerContext()) === null);
    check('F12 a drawer child never opens another drawer (not sent; the host would close the port)',
      (await f.host.openDrawer({ assetId: ASSET, revision: 1 })) === 'not_sent' &&
      (await f.host.openCreateDrawer()) === 'not_sent' &&
      f.calls('screen.drawer.open').length === 0);
    f.host.closeDrawer();
    check('F13 drawer child close sends screen.drawer.close {}',
      await waitFor(() => f.calls('screen.drawer.close').length === 1) && JSON.stringify(f.calls('screen.drawer.close')[0].args) === '{}');
    f.close();
  }
}

/* --------------------------- H: actual host side -------------------------- */

async function hostChecks() {
  const HSRC = path.join(HOST_WT, 'ui', 'src', 'features', 'workspace-apps', 'screen');
  const sandbox = { document: undefined, window: undefined, setTimeout, clearTimeout, setInterval, clearInterval, MessageChannel, MessagePort, TextEncoder };
  let lifecycle = null, protocol = null;
  try {
    const loader = makeLoader(sandbox);
    lifecycle = loader.load(path.join(HSRC, 'screenLifecycle.ts'));
    protocol = loader.load(path.join(HSRC, 'screenProtocol.ts'));
  } catch (e) {
    check('H0 host screen modules transpile+load', false, String(e && e.message || e));
    return;
  }
  const args = { surface: 'asset', size: 'wide', context: { asset_id: ASSET, revision: 1 } };
  const parsed = protocol.parseScreenDrawerCall?.('screen.drawer.open', args);
  check('H1 host parser admits the frame\'s exact open arguments',
    !!parsed && parsed.mode === 'drawer' && parsed.surface === 'asset' && parsed.size === 'wide', JSON.stringify(parsed));
  const createArgs = { surface: 'create', size: 'narrow' };
  const parsedCreate = protocol.parseScreenDrawerCall?.('screen.drawer.open', createArgs);
  check('H1b host parser admits narrow create drawer open arguments',
    !!parsedCreate && parsedCreate.mode === 'drawer' && parsedCreate.surface === 'create' && parsedCreate.size === 'narrow', JSON.stringify(parsedCreate));
  check('H2 the open context is within the host byte bound',
    typeof protocol.drawerContextBytes === 'function' && protocol.drawerContextBytes(args.context) !== null);

  // H3: a media (non-records) v2 frame that negotiated surfaces gets the board
  // drawer through the ACTUAL ScreenChannel, with the context handed through.
  const { parseMount, ScreenChannel } = lifecycle;
  const NONCE = 'a'.repeat(64);
  const receipt = { mount: `/api/app-screen/${'b'.repeat(64)}`, bridge_nonce: NONCE, generation: 2, tag: 'main', action_token: 'c'.repeat(64),
    media: { contract: 'screen-media.v1', may: ['media.read', 'media.publish', 'media.chat.attach'] } };
  const mount = parseMount(receipt, 'main');
  if (!mount) { check('H3 host parses a media mount receipt with an action token', false, 'parseMount returned null'); return; }
  const projection = {
    v: 1, op: 'screen', install_id: 'i', digest: 'd', tag: 'main', context_id: 'c',
    installation: { install_id: 'i', digest: 'd', title: 't', name: 'n', version: 'v', summary: '' },
    contexts: [{ id: 'c', label: 'context' }], runs: [], outbox: [], now: 1,
    publish_intents: { status: 'ok', withheld: 0, rows: [] },
    defaults: { context_id: 'c', revision: 0, values: {} }, readiness: { ok: true, blockers: [] },
    actions: ['media.read', 'media.publish'],
  };
  const drawerCalls = [];
  const actions = { call: async () => ({ ok: true, data: {} }), onSlot: () => {}, onLink: () => {}, onScreenDrawer: (...a) => drawerCalls.push(a) };
  const { port1, port2 } = new MessageChannel();
  const sent = [];
  port2.on('message', (m) => sent.push(m));
  const source = {};
  const ch = new ScreenChannel(source, mount, projection, () => {}, () => {}, () => {}, undefined, actions);
  ch.receive({ source, origin: 'null', data: { v: 1, op: 'init', tag: 'main', bridge_nonce: NONCE, generation: 2 }, ports: [port1] });
  port2.postMessage({ v: 1, op: 'ready', accepts: ['screen.v2', 'screen-media.v1', 'screen-surfaces.v1'] });
  await flush(30);
  const surfaceMsg = sent.find((m) => m && m.op === 'surface');
  check('H3 host posts a surface message to a surfaces frame (role primary)',
    !!surfaceMsg && surfaceMsg.role === 'primary', JSON.stringify(surfaceMsg));
  port2.postMessage({ v: 2, op: 'call', id: 'd1', verb: 'screen.drawer.open', args });
  await flush(30);
  const reply = sent.find((m) => m && m.op === 'reply' && m.id === 'd1');
  check('H4 host answers the open ok with {mode:"drawer", surface:"asset"}',
    !!reply && reply.ok === true && reply.data?.mode === 'drawer' && reply.data?.surface === 'asset', JSON.stringify(reply));
  const call = drawerCalls[0];
  check('H5 host asks the shell for an independent wide drawer with the frame\'s context',
    !!call && call[0] === 'drawer' && call[1] === 'asset' && call[2] === true && call[3] === 'wide' &&
      JSON.stringify(call[4]) === JSON.stringify(args.context), JSON.stringify(call));
  try { ch.close(); } catch { /* */ }
  try { port2.close(); } catch { /* */ }
}

async function main() {
  try { await frameChecks(); } catch (e) { check('F section aborted', false, String(e && e.stack || e)); }
  try { await hostChecks(); } catch (e) { check('H section aborted', false, String(e && e.stack || e)); }
  console.log(`\n=== drawer-surface-bridge: ${pass} PASS / ${fail} FAIL ===`);
  if (failures.length) console.log('failing: ' + failures.join(', '));
  process.exitCode = fail > 0 ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50);
}
main();
