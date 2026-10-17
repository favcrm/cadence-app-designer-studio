/**
 * APP-INTERNAL typed port between the Designer Studio frame and its host.
 *
 * This is the app's own seam, not a shipped SDK or a host contract. The
 * bootstrap in ./bootstrap.ts maps it onto the host's advertised
 * screen-media.v1 verbs and native run/download slots. Image references
 * are attached by the trusted host to its existing conversation; the
 * frame never sends a message or approves a refinement.
 *
 * Authority rules the port carries (enforced by the host, never the frame):
 * - the workspace is the access boundary; scope, install and context come
 *   from verified host authority, and no intent field can name them;
 * - creator attribution is recorded by the host from the verified current
 *   actor; the frame never supplies it;
 * - `currentActor` in a ready snapshot is display data for filters, not
 *   authority: every write is still checked by the host;
 * - paid actions always need the host-drawn approval of the current quote; the
 *   frame never passes an approval flag. Catalog publish needs the viewer's live
 *   workspace mutation role plus a revision check and a host receipt, and only
 *   the extra confirmation that existing policy requires;
 * - stale revisions return `revision_conflict` and the frame keeps its edits.
 */

export type Task = "image" | "edit" | "text_to_video" | "image_to_video";
export type ModelId = "openai/gpt-image-2.5" | "bytedance/seedance-2-5";

/** A verified workspace actor. A named user carries the verified board
 *  subject; a local operator is an operator, never a made-up person. */
export type StudioActor =
  | { kind: "user"; id: string; label?: string }
  | { kind: "operator" };

/** Creator of a workspace resource. `unknown` is a legacy record without a
 *  recorded actor; it is shown as unknown, never as a person. */
export type StudioCreator = StudioActor | { kind: "unknown" };

/** The native run states a generation run receipt may carry. `succeeded`,
 *  `failed` and `cancelled` are terminal; the rest keep the run — and this
 *  frame's one generation slot — pending. */
export type StudioRunState =
  | "awaiting_approval"
  | "approved"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface StudioAsset {
  id: string;
  kind: "image" | "video";
  /** `draft` is in the workspace; `published` is curated into the workspace
   *  library. Publishing keeps the original bytes and asset id. */
  lifecycle: "draft" | "published";
  creator: StudioCreator;
  title: string;
  tags: string[];
  createdAt: number;
  revision: number;
  /** Shown only when the workspace policy lets this viewer read it. */
  prompt?: string;
  lineage?: string[];
  jobId?: string;
  model?: ModelId;
  checksum?: string;
}

export interface StudioJob {
  id: string;
  task: Task;
  state: "queued" | "running" | "ready" | "failed" | "uncertain" | "refused";
  creator: StudioCreator;
  assetId?: string;
  /** Plain line from the host; never raw provider text. */
  note: string;
}

/** Each capability is separate: a ready catalog is not generation-ready. */
export interface StudioCapabilities {
  generate: boolean;
  publish: boolean;
  reuse: boolean;
  download: boolean;
  refineInChat: boolean;
  previews: boolean;
}

export const NO_CAPABILITIES: StudioCapabilities = { generate: false, publish: false, reuse: false, download: false, refineInChat: false, previews: false };

export type StudioSnapshot =
  | { status: "unavailable"; reason: string }
  | {
      status: "ready";
      capabilities: StudioCapabilities;
      /** Null when the host cannot identify the current actor; "Mine" is then unavailable. */
      currentActor: StudioActor | null;
      assets: StudioAsset[];
      jobs: StudioJob[];
    };

export type StudioIntent =
  | {
      kind: "generate";
      task: Exclude<Task, "image_to_video">;
      model: ModelId;
      prompt: string;
      aspectRatio: string;
      resolution: string;
      references: string[];
      duration?: 4 | 6 | 8 | 10;
      videoResolution?: "480p" | "720p" | "1080p";
      requestId: string;
    }
  | { kind: "publish"; assetId: string; revision: number; requestId: string }
  | { kind: "download"; assetId: string }
  | { kind: "refine_in_chat"; assetId: string; revision: number }
  | { kind: "reuse"; assetId: string };

export type Receipt =
  | { status: "awaiting_host_confirmation"; requestId: string }
  | { status: "pending"; requestId: string }
  | { status: "confirmed"; requestId: string; assetId: string; revision: number }
  /** A `run.start` slot reached a native run state. `succeeded` means the
   *  run completed — it does NOT carry an asset id and does not claim the
   *  image was saved; the refreshed catalog is the truth. */
  | { status: "generation_result"; requestId: string; runId: string; state: StudioRunState }
  /** An original download slot completed. Carries no revision, receipt or
   *  save proof: the browser's download is the only evidence of a file. */
  | { status: "download_started" }
  /** Only the host's completed composer handoff confirms attachment, not a sent message. */
  | { status: "chat_attached"; assetId: string; revision: number }
  | { status: "uncertain"; requestId: string; text: string }
  | { status: "revision_conflict"; currentRevision: number }
  | { status: "refused"; code: string; text: string };

export interface StudioHost {
  snapshot(): StudioSnapshot;
  subscribe(listener: () => void): () => void;
  submit(intent: StudioIntent): Promise<Receipt>;
  /** Authorized, bounded image bytes, encoded locally; never a provider URL. */
  preview(assetId: string, revision: number): Promise<string | null>;
}

/** The only state this build can honestly show before a host adapter exists. */
export function unavailableHost(reason: string): StudioHost {
  const snapshot: StudioSnapshot = { status: "unavailable", reason };
  return {
    snapshot: () => snapshot,
    subscribe: () => () => {},
    preview: async () => null,
    submit: async (intent) => ({
      status: "refused",
      code: "studio_unavailable",
      text: `Nothing was sent: Designer Studio services are not available here yet (${intent.kind}).`,
    }),
  };
}
