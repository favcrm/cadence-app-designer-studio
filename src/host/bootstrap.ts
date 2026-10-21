/**
 * Frame lifecycle for the CAD-1006 screen protocol and the Designer Studio
 * catalog adapter.
 *
 * The host stamps `cadence-screen-boot` JSON into the document. The frame
 * creates a MessageChannel, posts its one `init` to the EXACT parent origin
 * with port2, then sends `ready` on port1 opting into `screen.v2` and
 * `screen-media.v1`. The host's PUSH lists the media verbs this mount may use
 * in `actions`; the frame calls only those, with closed arguments. The parent
 * holds the action token, session and creator, so the frame sends none of
 * them. Refine in chat only queues an image in the host composer.
 */
import {
  NO_CAPABILITIES,
  unavailableHost,
  type Receipt,
  type StudioActor,
  type StudioAsset,
  type StudioCreator,
  type StudioHost,
  type StudioIntent,
  type StudioRunState,
  type StudioSnapshot,
} from "./port";
import { IMAGE_MODEL, MAX_PROMPT, isVisiblePrompt } from "../features/studio/model";

interface Boot {
  tag: string;
  bridge_nonce: string;
  generation: number;
  parent_origin: string;
}

function readBoot(): Boot | null {
  const text = document.getElementById("cadence-screen-boot")?.textContent;
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const ok =
    typeof v.tag === "string" && /^[a-z0-9][a-z0-9-]{0,31}$/.test(v.tag) &&
    typeof v.bridge_nonce === "string" && /^[a-f0-9]{64}$/.test(v.bridge_nonce) &&
    typeof v.generation === "number" && Number.isSafeInteger(v.generation) && v.generation >= 0 &&
    typeof v.parent_origin === "string";
  return ok ? (v as unknown as Boot) : null;
}

/** Shared-kit contract the host stamps on the frame document. The host renders
 *  design/tokens.css + design/kit.css + its frame additions into that document
 *  (src/daemon/app_screens_rpc.rs, SCREEN_KIT_CSS / render_frame_html). This app
 *  only reads those tokens and classes; it never ships its own copy. */
export const KIT_CONTRACT = "cadence-kit/1";

/** The host's call queue holds 8 calls; a ninth closes the port. */
const CALLS_IN_FLIGHT_MAX = 8;
const CALL_TIMEOUT_MS = 30_000;
const CATALOG_PAGE = 8;
const CURSOR_MAX = 160;
const PUBLISH_ASSET_ID = /^med-[0-9a-f]{32}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;
const UNCERTAIN_TEXT = "We could not confirm this with Cadence. Check the library before trying again.";
const NOT_SENT = { code: "not_connected", text: "Nothing was sent: this screen is not connected to Cadence." };
const BUSY = { code: "busy", text: "Nothing was sent: Cadence is busy with other requests. Try again in a moment." };
/** The named generation-slot wait: the host may hold a `run.start` plan for a
 *  person to read and tap, far longer than a media call's 30 seconds. */
const SLOT_TIMEOUT_MS = 180_000;
/** Original download slot wait: its own bound, separate from generation and metadata. */
const DOWNLOAD_SLOT_TIMEOUT_MS = 120_000;
const DOWNLOAD_UNCERTAIN = "We could not confirm the original download. Check your browser's downloads before trying again.";
/** The native request-id grammar the tool/run channel enforces. */
const NATIVE_REQUEST_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RUN_ID = /^run-[0-9a-f]{32}$/;
const RUN_STATES: StudioRunState[] = ["awaiting_approval", "approved", "running", "succeeded", "failed", "cancelled"];
const GEN_UNCERTAIN = "We could not confirm this generation with Cadence. Check the library before trying again."

type Refusal = { code: string; text: string };
/** `lost` means the call may have reached the host: a timeout, a closed port,
 *  a scope change or an unreadable reply. */
type Outcome = { ok: true; data: unknown } | { ok: false; refusal: Refusal } | { ok: false; lost: string };
type Catalog =
  | { kind: "none" }
  | { kind: "failed"; reason: string }
  | { kind: "ready"; assets: StudioAsset[]; actor: StudioActor };

/** Connect to the host, or report why this build cannot reach one. */
export function connectFrameHost(): StudioHost {
  const boot = readBoot();
  const kitInjected = document.documentElement.getAttribute("data-cadence-kit") === KIT_CONTRACT;
  // Unframed or kit-less pages send no init, so no handshake is made without the kit.
  if (!boot || window.parent === window || !kitInjected) return unavailableHost("unsupported_host");
  const bootTag: string = boot.tag;

  const channel = new MessageChannel();
  const port = channel.port1;
  const listeners = new Set<() => void>();
  const pending = new Map<string, { resolve: (outcome: Outcome) => void; timer: ReturnType<typeof setTimeout> }>();
  let snapshot: StudioSnapshot = { status: "unavailable", reason: "awaiting_host" };
  let closedReason: string | null = null;
  let scope: string | null = null;
  let verbs = new Set<string>();
  let catalog: Catalog = { kind: "none" };
  let loadToken = 0;
  let loadInFlight = false;
  let callSeq = 0;
  /** The host-derived `run_receipts` marker from the last v2 push — only
   *  `=== 1` on a v2 screen counts; anything else is ignored. */
  let runReceiptSupport = false;
  /** The one generation slot, separate from the media call map: at most one
   *  run.start outstanding, and once sent it may already have reached the
   *  host — an unresolved outcome locks generation, it is never retried. */
  let generation: {
    id: string;
    requestId: string;
    resolve: (receipt: Receipt) => void;
    timer: ReturnType<typeof setTimeout>;
    /** A valid host ack arrived; a later unconfirmed state is uncertain. */
    acked: boolean;
  } | null = null;
  /** Set when a slot is sent; released only by a terminal receipt state or
   *  a proper unconfirmed-free refusal. A nonterminal run, an uncertain
   *  outcome or a close keeps it — no silent second paid request. */
  let genLocked = false;
  let genSeq = 0;
  /** Parent-derived `original_downloads` support (v2, marker 1). Support only, not permission. */
  let downloadSupport = false;
  /** The one original-download slot. A sent download stays locked until a
   *  proper refusal or done; an uncertain outcome keeps the lock, never resent. */
  let download: {
    id: string;
    requestId: string;
    resolve: (receipt: Receipt) => void;
    timer: ReturnType<typeof setTimeout>;
    acked: boolean;
  } | null = null;
  let downloadLocked = false;
  let dlSeq = 0;
  let previewSupport = false;
  let chatReferenceSupport = false;
  // Thumbnails, the picker and the detail drawer share the bounded call queue.
  // Serialize preview reads so a large Library cannot overflow the host's eight calls.
  let previewTail: Promise<void> = Promise.resolve();

  function derive(): StudioSnapshot {
    if (closedReason) return { status: "unavailable", reason: closedReason };
    if (!scope) return { status: "unavailable", reason: "awaiting_host" };
    if (!verbs.has("media.read")) return { status: "unavailable", reason: "media_read_not_advertised" };
    if (catalog.kind === "none") return { status: "unavailable", reason: "catalog_loading" };
    if (catalog.kind === "failed") return { status: "unavailable", reason: catalog.reason };
    return {
      status: "ready",
      capabilities: {
        ...NO_CAPABILITIES,
        publish: verbs.has("media.publish"),
        generate: runReceiptSupport && verbs.has("run.start"),
        download: downloadSupport && verbs.has("media.original.download"),
        refineInChat: chatReferenceSupport && verbs.has("media.chat.attach"),
        previews: previewSupport,
      },
      currentActor: catalog.actor,
      assets: catalog.assets,
      jobs: [],
    };
  }

  function refresh(): void {
    snapshot = derive();
    listeners.forEach((listener) => listener());
  }

  function settle(id: string, outcome: Outcome): void {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(outcome);
  }

  function settleAllLost(): void {
    for (const id of [...pending.keys()]) settle(id, { ok: false, lost: "closed" });
  }

  /** The generation slot may already have reached the host: scope close or
   *  unload settles it uncertain and clears its timer, never "nothing started". */
  function settleGeneration(receipt: Receipt): void {
    const gen = generation;
    if (!gen) return;
    generation = null;
    clearTimeout(gen.timer);
    gen.resolve(receipt);
  }

  function settleDownload(receipt: Receipt): void {
    const dl = download;
    if (!dl) return;
    download = null;
    clearTimeout(dl.timer);
    dl.resolve(receipt);
  }

  function call(verb: "media.read" | "media.publish" | "media.chat.attach", args: Record<string, unknown>): Promise<Outcome> {
    if (closedReason) return Promise.resolve({ ok: false, refusal: NOT_SENT });
    if (pending.size >= CALLS_IN_FLIGHT_MAX) return Promise.resolve({ ok: false, refusal: BUSY });
    callSeq += 1;
    const id = `c${callSeq}-${randomHex(6)}`;
    return new Promise<Outcome>((resolve) => {
      const timer = setTimeout(() => settle(id, { ok: false, lost: "timeout" }), CALL_TIMEOUT_MS);
      pending.set(id, { resolve, timer });
      try {
        port.postMessage({ v: 2, op: "call", id, verb, args });
      } catch {
        settle(id, { ok: false, lost: "send_failed" });
      }
    });
  }

  /** Every catalog page, in order. A repeated cursor or a malformed page is an
   *  invalid reply: the catalog is never shown partly or as a fictional empty. */
  async function readCatalog(): Promise<{ assets: StudioAsset[]; actor: StudioActor } | string> {
    const assets: StudioAsset[] = [];
    const ids = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const args: Record<string, unknown> =
        cursor === undefined ? { kind: "catalog", limit: CATALOG_PAGE } : { kind: "catalog", limit: CATALOG_PAGE, cursor };
      const outcome = await call("media.read", args);
      if (!outcome.ok) return "refusal" in outcome ? `refused_${outcome.refusal.code}` : `lost_${outcome.lost}`;
      const page = record(outcome.data);
      const rows = page && Array.isArray(page.assets) ? page.assets : null;
      const actor = parseActor(page?.current_actor);
      const next = page?.next_cursor;
      if (!rows || !actor || !(next === null || (typeof next === "string" && next.length > 0 && next.length <= CURSOR_MAX)))
        return "invalid_reply";
      for (const row of rows) {
        const asset = parseAsset(row);
        if (!asset || ids.has(asset.id)) return "invalid_reply";
        ids.add(asset.id);
        assets.push(asset);
      }
      if (next === null) return { assets, actor };
      if (cursors.has(next)) return "repeated_cursor";
      cursors.add(next);
      cursor = next;
    }
  }

  /** Start a catalog read. A newer read supersedes this one, and a superseded
   *  result is ignored. */
  function startLoad(): void {
    const token = ++loadToken;
    loadInFlight = true;
    void readCatalog().then((result) => {
      if (token !== loadToken) return;
      loadInFlight = false;
      if (typeof result === "string") {
        catalog = { kind: "failed", reason: result };
      } else {
        catalog = { kind: "ready", assets: result.assets, actor: result.actor };
      }
      refresh();
    });
  }

  // Chat refinement completes outside this frame. Returning to the Library
  // reads current retained results; it never polls, approves or generates.
  function onFocus(): void {
    if (!closedReason && scope && verbs.has("media.read") && !loadInFlight) startLoad();
  }

  function onPush(data: Record<string, unknown>): void {
    // Context is no longer a scope dimension. Absent or "" means unscoped; a real
    // id from a host that still sends one is tolerated. Any other type is malformed.
    if (data.context_id !== undefined && typeof data.context_id !== "string") {
      closeWith("malformed_push");
      return;
    }
    if (data.tag !== bootTag || typeof data.install_id !== "string" || typeof data.digest !== "string") {
      closeWith("malformed_push");
      return;
    }
    const key = JSON.stringify([data.install_id, data.digest, data.tag]);
    if (scope !== null && key !== scope) {
      closeWith("scope_changed");
      return;
    }
    scope = key;
    const actions: unknown[] = data.v === 2 && Array.isArray(data.actions) ? data.actions : [];
    verbs = new Set(
      actions.filter(
        (v): v is string => v === "media.read" || v === "media.publish" || v === "run.start" || v === "media.original.download" || v === "media.chat.attach",
      ),
    );
    runReceiptSupport = data.v === 2 && data.run_receipts === 1;
    downloadSupport = data.v === 2 && data.original_downloads === 1;
    previewSupport = data.v === 2 && data.media_previews === 1;
    chatReferenceSupport = data.v === 2 && data.media_chat_references === 1;
    if (verbs.has("media.read") && !loadInFlight && catalog.kind !== "ready") startLoad();
    refresh();
  }

  function closeWith(reason: string): void {
    if (closedReason) return;
    closedReason = reason;
    loadToken += 1;
    loadInFlight = false;
    catalog = { kind: "none" };
    scope = null;
    verbs = new Set();
    runReceiptSupport = false;
    downloadSupport = false;
    previewSupport = false;
    chatReferenceSupport = false;
    settleAllLost();
    if (generation) {
      settleGeneration({ status: "uncertain", requestId: generation.requestId, text: GEN_UNCERTAIN });
    }
    if (download) settleDownload({ status: "uncertain", requestId: download.requestId, text: DOWNLOAD_UNCERTAIN });
    port.close();
    refresh();
  }

  port.onmessage = (event: MessageEvent) => {
    const data = record(event.data);
    if (!data || closedReason) return;
    if (data.op === "screen") {
      onPush(data);
      return;
    }
    if (data.op === "reply" && data.v === 2 && typeof data.id === "string" && pending.has(data.id)) {
      if (data.ok === true) settle(data.id, { ok: true, data: data.data });
      else if (data.ok === false && isRefusal(data.refusal)) settle(data.id, { ok: false, refusal: data.refusal });
      else settle(data.id, { ok: false, lost: "invalid_reply" });
    }
    // The generation slot answers on `slot-state` ONLY — the real host
    // protocol has no reply variant for slots. A message for another id,
    // or one after the slot settled, is ignored.
    if (data.op === "slot-state" && data.v === 2 && typeof data.id === "string" && generation && data.id === generation.id) {
      onSlotState(data);
    }
    if (data.op === "slot-state" && data.v === 2 && typeof data.id === "string" && download && data.id === download.id) {
      onDownloadState(data);
    }
  };

  /** One slot-state for the live original download. `done` carries no data:
   *  any extra field is malformed and is never claimed as a started download. */
  function onDownloadState(data: Record<string, unknown>): void {
    const dl = download;
    if (!dl) return;
    const uncertain = (): void => settleDownload({ status: "uncertain", requestId: dl.requestId, text: DOWNLOAD_UNCERTAIN });
    if (data.state === "pending") {
      dl.acked = true;
      return;
    }
    if (data.state === "refused") {
      if (!dl.acked && isRefusal(data.refusal) && data.refusal.code !== "unconfirmed") {
        downloadLocked = false;
        settleDownload({ status: "refused", code: data.refusal.code, text: data.refusal.text });
      } else {
        uncertain();
      }
      return;
    }
    if (data.state === "done") {
      const bare = Object.keys(data).every((k) => k === "v" || k === "op" || k === "id" || k === "state");
      if (!bare) {
        uncertain();
        return;
      }
      downloadLocked = false;
      settleDownload({ status: "download_started" });
      return;
    }
    uncertain();
  }

  /** One slot-state for the live generation. `pending` leaves the promise
   *  open (it may follow a tap much later); `refused`/`done` resolve it.
   *  Anything malformed — or a `refused` without a real refusal payload, or
   *  a late `refused` after an earlier ack — is uncertain, and the slot lock
   *  is kept so a paid request is never silently resent. */
  function onSlotState(data: Record<string, unknown>): void {
    const gen = generation;
    if (!gen) return;
    const uncertain = (): void => {
      settleGeneration({ status: "uncertain", requestId: gen.requestId, text: GEN_UNCERTAIN });
    };
    if (data.state === "pending") {
      gen.acked = true;
      return;
    }
    if (data.state === "refused") {
      // A proper host refusal {code,text} before/at confirmation means the
      // slot refused the plan — nothing started, the lock releases. Without
      // one, or after an earlier ack, the outcome is unconfirmed: uncertain.
      if (!gen.acked && isRefusal(data.refusal) && data.refusal.code !== "unconfirmed") {
        genLocked = false;
        settleGeneration({ status: "refused", code: data.refusal.code, text: data.refusal.text });
        return;
      }
      uncertain();
      return;
    }
    if (data.state === "done") {
      const r = record(data.receipt);
      if (!r || Object.keys(r).sort().join() !== "request_id,run_id,state") { uncertain(); return; }
      if (typeof r.run_id !== "string" || !RUN_ID.test(r.run_id)) { uncertain(); return; }
      if (r.request_id !== gen.requestId) { uncertain(); return; }
      if (typeof r.state !== "string" || !RUN_STATES.includes(r.state as StudioRunState)) { uncertain(); return; }
      const state = r.state as StudioRunState;
      // `done` is transport completion, not native success: only a terminal
      // run state releases the slot lock; awaiting_approval/approved/running
      // resolve the receipt but keep generation locked.
      if (state === "succeeded" || state === "failed" || state === "cancelled") {
        genLocked = false;
        if (state === "succeeded" && verbs.has("media.read")) startLoad();
      }
      settleGeneration({ status: "generation_result", requestId: gen.requestId, runId: r.run_id, state });
      return;
    }
    uncertain();
  }
  port.onmessageerror = () => closeWith("port_error");
  // Node reports a closed peer as a close event; browsers never fire it, so
  // there a lost port is still settled by the reply timeouts.
  port.addEventListener("close", () => closeWith("port_closed"));
  port.start();
  window.addEventListener("pagehide", () => closeWith("unloaded"));
  window.addEventListener("focus", onFocus);

  window.parent.postMessage(
    { v: 1, op: "init", tag: boot.tag, bridge_nonce: boot.bridge_nonce, generation: boot.generation },
    boot.parent_origin,
    [channel.port2],
  );
  port.postMessage({ v: 1, op: "ready", accepts: ["screen.v2", "screen-media.v1"] });

  async function submit(intent: StudioIntent): Promise<Receipt> {
    if (intent.kind === "generate") return submitGenerate(intent);
    if (intent.kind === "download") return submitDownload(intent);
    if (intent.kind === "refine_in_chat") return submitRefine(intent);
    if (intent.kind !== "publish") {
      return { status: "refused", code: `${intent.kind}_not_available`, text: "Nothing was sent: reuse is not available yet." };
    }
    const current = derive();
    if (current.status !== "ready" || !current.capabilities.publish) {
      return { status: "refused", code: "publish_not_available", text: "Nothing was sent: publishing to the workspace library is not available here." };
    }
    const { assetId, revision, requestId } = intent;
    if (!PUBLISH_ASSET_ID.test(assetId) || !REQUEST_ID.test(requestId) || !Number.isSafeInteger(revision) || revision < 1) {
      return { status: "refused", code: "bad_request", text: "Nothing was sent: this publish request is not valid." };
    }
    const outcome = await call("media.publish", { asset_id: assetId, expected_revision: revision, request_id: requestId });
    if (outcome.ok) {
      const receipt = publishReceipt(outcome.data, intent);
      if (receipt.status === "confirmed" && verbs.has("media.read")) startLoad();
      return receipt;
    }
    if ("refusal" in outcome) {
      if (outcome.refusal.code === "revision_conflict" && verbs.has("media.read")) startLoad();
      return { status: "refused", code: outcome.refusal.code, text: outcome.refusal.text };
    }
    return { status: "uncertain", requestId, text: UNCERTAIN_TEXT };
  }

  async function submitRefine(intent: Extract<StudioIntent, { kind: "refine_in_chat" }>): Promise<Receipt> {
    if (Object.keys(intent).sort().join() !== "assetId,kind,revision" ||
        !PUBLISH_ASSET_ID.test(intent.assetId) || !isCount(intent.revision, 1)) {
      return { status: "refused", code: "bad_request", text: "Nothing was sent: this image reference is not valid." };
    }
    const current = derive();
    const asset = current.status === "ready" ? current.assets.find((row) => row.id === intent.assetId) : null;
    if (current.status !== "ready" || !current.capabilities.refineInChat || asset?.kind !== "image" || asset.revision !== intent.revision) {
      return { status: "refused", code: "reference_unavailable", text: "This image cannot be attached. Check the current Library and host connection." };
    }
    const { assetId, revision } = intent;
    const capturedScope = scope;
    const outcome = await call("media.chat.attach", { asset_id: assetId, expected_revision: revision });
    if (outcome.ok && scope === capturedScope && !closedReason) {
      const reply = record(outcome.data);
      if (reply && Object.keys(reply).sort().join() === "asset_id,revision" && reply.asset_id === assetId && reply.revision === revision) {
        return { status: "chat_attached", assetId, revision };
      }
    }
    if (!outcome.ok && "refusal" in outcome) {
      return { status: "refused", code: outcome.refusal.code, text: outcome.refusal.text };
    }
    return { status: "uncertain", requestId: `chat-${randomHex(6)}`, text: "Could not confirm attachment. Check the chat composer before trying again." };
  }

  function preview(assetId: string, revision: number): Promise<string | null> {
    const capturedScope = scope;
    const result = previewTail.then(async () => {
      const current = derive();
      if (scope !== capturedScope || current.status !== "ready" || !current.capabilities.previews ||
          !current.assets.some((asset) => asset.id === assetId && asset.revision === revision && asset.kind === "image")) return null;
      const outcome = await call("media.read", { kind: "preview", asset_id: assetId, expected_revision: revision });
      if (!outcome.ok || closedReason || scope !== capturedScope) return null;
      const image = record(outcome.data);
      if (!image || Object.keys(image).sort().join() !== "asset_id,base64,media_type,revision,sha256" ||
          image.asset_id !== assetId || image.revision !== revision ||
          (image.media_type !== "image/png" && image.media_type !== "image/jpeg") ||
          typeof image.sha256 !== "string" || typeof image.base64 !== "string" || image.base64.length === 0 ||
          image.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64)) return null;
      return `data:${image.media_type};base64,${image.base64}`;
    });
    previewTail = result.then(() => undefined, () => undefined);
    return result;
  }

  /** The image-only run.start slot. Every value the wire carries is captured
   *  before the send: the prompt and request id come from the validated
   *  intent, never a mutable draft. `image_prompt` is omitted so the
   *  installed workflow's own default applies; no model, aspect, quote,
   *  approval, provider, price, session or creator selector crosses. */
  function submitGenerate(intent: StudioIntent): Promise<Receipt> {
    const refuse = (code: string, text: string): Promise<Receipt> =>
      Promise.resolve({ status: "refused", code, text });
    if (intent.kind !== "generate") {
      return refuse("bad_request", "Nothing was sent: this generation request is not valid.");
    }
    if (!generateIntentOk(intent)) {
      return refuse("bad_request", "Nothing was sent: this generation request is not valid.");
    }
    const current = derive();
    if (current.status !== "ready" || !current.capabilities.generate) {
      return refuse("generate_not_available", "Nothing was sent: generation is not available on this screen.");
    }
    if (genLocked || downloadLocked) {
      return refuse("busy", "Nothing was sent: a generation request is still open. Check the library before trying again.");
    }
    // Captured once — the wire args never read the intent again after send.
    const requestId = intent.requestId;
    const prompt = intent.prompt.trim();
    genSeq += 1;
    const id = `g${genSeq}-${randomHex(6)}`;
    const args = {
      workflow: "create-image",
      inputs: { subject: "Generated image", source: prompt },
      request_id: requestId,
    };
    return new Promise<Receipt>((resolve) => {
      const timer = setTimeout(() => {
        if (generation && generation.id === id) {
          settleGeneration({ status: "uncertain", requestId, text: GEN_UNCERTAIN });
        }
      }, SLOT_TIMEOUT_MS);
      genLocked = true;
      generation = { id, requestId, resolve, timer, acked: false };
      try {
        port.postMessage({ v: 2, op: "slot", id, verb: "run.start", args, anchor: "footer" });
      } catch {
        settleGeneration({ status: "uncertain", requestId, text: GEN_UNCERTAIN });
      }
    });
  }

  /** Original download: one protected footer slot carrying only the captured
   *  canonical asset id. Success is metadata-only; the frame claims no save. */
  function submitDownload(intent: StudioIntent): Promise<Receipt> {
    if (intent.kind !== "download" || Object.keys(intent).sort().join() !== "assetId,kind" || !PUBLISH_ASSET_ID.test(intent.assetId)) {
      return Promise.resolve({ status: "refused", code: "bad_request", text: "Nothing was sent: this download request is not valid." });
    }
    const current = derive();
    if (current.status !== "ready" || !current.capabilities.download) {
      return Promise.resolve({ status: "refused", code: "download_not_available", text: "Nothing was sent: original download is not available here." });
    }
    if (downloadLocked || generation) {
      return Promise.resolve({ status: "refused", code: "busy", text: "Nothing was sent: another request is still open. Check your browser's downloads before trying again." });
    }
    const assetId = intent.assetId;
    const requestId = `dl-${randomHex(6)}`;
    dlSeq += 1;
    const id = `d${dlSeq}-${randomHex(6)}`;
    return new Promise<Receipt>((resolve) => {
      const timer = setTimeout(() => {
        if (download && download.id === id) settleDownload({ status: "uncertain", requestId, text: DOWNLOAD_UNCERTAIN });
      }, DOWNLOAD_SLOT_TIMEOUT_MS);
      downloadLocked = true;
      download = { id, requestId, resolve, timer, acked: false };
      try {
        port.postMessage({ v: 2, op: "slot", id, verb: "media.original.download", args: { asset_id: assetId }, anchor: "footer" });
      } catch {
        settleDownload({ status: "uncertain", requestId, text: DOWNLOAD_UNCERTAIN });
      }
    });
  }

  /** The image-only generation gate: the intent is the closed 8-key shape
   *  — task image, the admitted image model, square, 1K, no references —
   *  with a nonempty visible prompt and a native request id. Anything else,
   *  including an extra forged field, refuses BEFORE any slot op is sent. */
  function generateIntentOk(intent: StudioIntent): boolean {
    if (intent.kind !== "generate") return false;
    const keys = Object.keys(intent).sort().join();
    if (keys !== "aspectRatio,kind,model,prompt,references,requestId,resolution,task") return false;
    return (
      intent.task === "image" &&
      intent.model === IMAGE_MODEL &&
      intent.aspectRatio === "1:1" &&
      intent.resolution === "1K" &&
      Array.isArray(intent.references) && intent.references.length === 0 &&
      typeof intent.requestId === "string" && NATIVE_REQUEST_ID.test(intent.requestId) &&
      typeof intent.prompt === "string" && intent.prompt.trim().length > 0 &&
      intent.prompt.length <= MAX_PROMPT && isVisiblePrompt(intent.prompt.trim())
    );
  }

  return {
    snapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    submit,
    preview,
  };
}

/** Confirmed only when the reply's receipt and asset match the captured intent. */
function publishReceipt(data: unknown, intent: { assetId: string; revision: number; requestId: string }): Receipt {
  const page = record(data);
  const receipt = record(page?.receipt);
  const asset = parseAsset(page?.asset);
  const uncertain: Receipt = { status: "uncertain", requestId: intent.requestId, text: UNCERTAIN_TEXT };
  if (
    !asset || !receipt ||
    receipt.request_id !== intent.requestId ||
    receipt.asset_id !== intent.assetId ||
    receipt.expected_revision !== intent.revision ||
    receipt.lifecycle !== "published" ||
    receipt.revision !== intent.revision + 1
  ) {
    return uncertain;
  }
  if (asset.id !== intent.assetId || asset.lifecycle !== "published" || asset.revision !== receipt.revision) return uncertain;
  return { status: "confirmed", requestId: intent.requestId, assetId: intent.assetId, revision: asset.revision };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isRefusal(value: unknown): value is Refusal {
  const r = record(value);
  return !!r && typeof r.code === "string" && typeof r.text === "string";
}

function isCount(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

/** A verified current actor, or null for any other shape. */
function parseActor(value: unknown): StudioActor | null {
  const a = record(value);
  if (a?.kind === "operator") return { kind: "operator" };
  if (a?.kind === "user" && typeof a.id === "string" && a.id.length > 0 && (a.label === undefined || typeof a.label === "string")) {
    return typeof a.label === "string" ? { kind: "user", id: a.id, label: a.label } : { kind: "user", id: a.id };
  }
  return null;
}

/** Creator as the host returned it; anything not recognised is shown as unknown, never as a person. */
function parseCreator(value: unknown): StudioCreator {
  return parseActor(value) ?? { kind: "unknown" };
}

/** A native catalog row, or null. The native epoch seconds become milliseconds. */
function parseAsset(value: unknown): StudioAsset | null {
  const a = record(value);
  if (!a || typeof a.id !== "string" || a.id.length === 0 || a.id.length > 128) return null;
  if (typeof a.title !== "string") return null;
  if (a.kind !== "image" && a.kind !== "video") return null;
  if (a.lifecycle !== "draft" && a.lifecycle !== "published") return null;
  if (!isCount(a.revision, 1) || !isEpoch(a.created) || !isEpoch(a.updated)) return null;
  return {
    id: a.id,
    kind: a.kind,
    lifecycle: a.lifecycle,
    creator: parseCreator(a.creator),
    title: a.title,
    tags: [],
    createdAt: a.created * 1000,
    revision: a.revision,
    ...(typeof a.prompt === "string" ? { prompt: a.prompt } : {}),
    ...(Array.isArray(a.lineage) && a.lineage.every((id) => typeof id === "string" && PUBLISH_ASSET_ID.test(id)) ? { lineage: a.lineage as string[] } : {}),
  };
}

/** Native epoch seconds are f64 (fractional), so they are checked as finite, not as integers. */
function isEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}
