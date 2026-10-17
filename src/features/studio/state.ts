import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Receipt, StudioHost, StudioIntent, StudioSnapshot } from "../../host/port";
import { emptyDraft, toIntent, validate } from "./model";
import type { CreateDraft } from "./types";

/** What the frame shows about its one most recent intent. The frame never
 *  approves, prices or charges: it only mirrors the host receipt. */
export type Phase =
  | { kind: "idle" }
  | { kind: "awaiting_host" }
  | { kind: "pending" }
  | { kind: "uncertain"; text: string }
  | { kind: "conflict"; currentRevision: number }
  | { kind: "refused"; text: string }
  /** A generation run finished: completed, failed or cancelled — truthful,
   *  never "saved" (the refreshed library is the truth) and never
   *  "nothing started/no charge" for a run that reached the host. */
  | { kind: "completed" }
  | { kind: "generation_failed" }
  | { kind: "cancelled" }
  | { kind: "saved" };

/** Feature state: the draft the person edits, and the host receipt for the
 *  one intent the frame most recently sent. */
export function useStudio(host: StudioHost) {
  const snapshot: StudioSnapshot = useSyncExternalStore(host.subscribe, host.snapshot, host.snapshot);
  const [draft, setDraft] = useState<CreateDraft>(() => emptyDraft());
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  // Only the reply to the newest intent may change the screen; an older one
  // (or one that arrives after unmount) is dropped.
  const activeIntent = useRef<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeIntent.current = null;
    };
  }, []);

  const problems = validate(draft);
  // Uncertain means the host may already have accepted the intent: no new
  // submit is offered here, and the person checks the library instead.
  const locked = busy || phase.kind === "awaiting_host" || phase.kind === "pending" || phase.kind === "uncertain";
  // Catalog readiness is not generation readiness: generation is never offered until the host advertises it.
  const canSubmit = problems.length === 0 && snapshot.status === "ready" && snapshot.capabilities.generate && !locked;

  /** Send one intent. The intent's values and request id are captured once;
   *  later edits to the form never change what this send means. */
  function requestGeneration() {
    if (!canSubmit) return;
    const requestId = newRequestId();
    const intent: StudioIntent = toIntent(draft, requestId);
    activeIntent.current = requestId;
    setBusy(true);
    setPhase({ kind: "awaiting_host" });
    void settle(intent, requestId);
  }

  async function settle(intent: StudioIntent, requestId: string) {
    let receipt: Receipt;
    try {
      receipt = await host.submit(intent);
    } catch {
      receipt = { status: "uncertain", requestId, text: "We could not confirm this request. Check the library before doing anything else." };
    }
    if (!mounted.current || activeIntent.current !== requestId) return;
    setBusy(false);
    setPhase(fromReceipt(receipt));
  }

  return { snapshot, draft, setDraft, phase, busy, problems, canSubmit, requestGeneration };
}

/** Hex request id: works in an opaque-origin frame, where crypto.randomUUID may be absent. */
export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromReceipt(receipt: Receipt): Phase {
  switch (receipt.status) {
    case "awaiting_host_confirmation":
      return { kind: "awaiting_host" };
    case "pending":
      return { kind: "pending" };
    case "confirmed":
      return { kind: "saved" };
    case "download_started":
    case "chat_attached":
      return { kind: "refused", text: "This response does not confirm image generation." };
    case "generation_result":
      if (receipt.state === "succeeded") return { kind: "completed" };
      if (receipt.state === "failed") return { kind: "generation_failed" };
      if (receipt.state === "cancelled") return { kind: "cancelled" };
      // A valid nonterminal run state: the run is real but still open.
      return { kind: "pending" };
    case "uncertain":
      return { kind: "uncertain", text: receipt.text };
    case "revision_conflict":
      return { kind: "conflict", currentRevision: receipt.currentRevision };
    case "refused":
      return { kind: "refused", text: receipt.text };
  }
}
