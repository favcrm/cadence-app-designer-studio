import type { ModelId, StudioActor, StudioAsset, StudioCreator, StudioIntent, StudioModelOption, Task } from "../../host/port";
import type { CreateDraft, ImageAspect, VideoAspect, VideoDuration, VideoResolution } from "./types";

export const MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,31}\/[a-z0-9][a-z0-9._:-]{0,63}$/i;
export const IMAGE_MODEL: ModelId = "openai/gpt-image-2.5";
export const VIDEO_MODEL: ModelId = "bytedance/seedance-2-5";
export const DEFAULT_IMAGE_MODELS: StudioModelOption[] = [
  { id: IMAGE_MODEL, name: "GPT Image 2.5", isDefault: true },
];
export const IMAGE_ASPECTS: ImageAspect[] = ["1:1", "16:9", "9:16", "3:2", "2:3"];
export const VIDEO_ASPECTS: VideoAspect[] = ["16:9", "9:16", "1:1", "auto"];
export const VIDEO_DURATIONS: VideoDuration[] = [4, 6, 8, 10];
export const VIDEO_RESOLUTIONS: VideoResolution[] = ["480p", "720p", "1080p"];
export const MAX_REFERENCES = 4;
export const MAX_PROMPT = 2000;

/** DSN-1: only the plain image task is bridged to the host's `run.start`
 *  slot. The other tasks are not qualified for this bridge — the reason
 *  says so plainly, it never claims an upstream impossibility it cannot
 *  prove. */
export const TASK_STATUS: Record<Task, { enabled: boolean; reason?: string }> = {
  image: { enabled: true },
  edit: { enabled: false, reason: "Editing images is not qualified for this workspace screen's generation bridge." },
  text_to_video: { enabled: false, reason: "Text-to-video generation is not qualified for this workspace screen's generation bridge." },
  image_to_video: { enabled: false, reason: "Animating an image is not qualified for this workspace screen's generation bridge." },
};

export function modelFor(task: Task): ModelId {
  return task === "text_to_video" || task === "image_to_video" ? VIDEO_MODEL : IMAGE_MODEL;
}

export function emptyDraft(task: Task = "image"): CreateDraft {
  return {
    task,
    model: modelFor(task),
    prompt: "",
    imageAspect: "1:1",
    videoAspect: "16:9",
    duration: 4,
    videoResolution: "720p",
    references: [],
  };
}

/** Visible prompt text for the native `source` input: no control
 *  characters, no format (Cf) characters, no default-ignorable code
 *  points — the same visible-source-facts grammar the daemon enforces. */
export function isVisiblePrompt(text: string): boolean {
  for (const ch of text) {
    if (/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(ch) ||
        (ch !== " " && /\p{White_Space}/u.test(ch))) {
      return false;
    }
  }
  return true;
}

/** Problems a person must fix before a paid submit may even be offered. */
export function validate(draft: CreateDraft, allowedModels?: readonly StudioModelOption[]): string[] {
  const problems: string[] = [];
  if (!TASK_STATUS[draft.task].enabled) problems.push(TASK_STATUS[draft.task].reason ?? "This task is not available.");
  const prompt = draft.prompt.trim();
  if (prompt.length === 0) problems.push("Write a brief to continue.");
  if (draft.prompt.length > MAX_PROMPT) problems.push(`Keep the brief to ${MAX_PROMPT} characters.`);
  if (prompt.length > 0 && !isVisiblePrompt(prompt)) problems.push("The brief has invisible or control characters; use plain visible text.");
  if (draft.task === "image" && !IMAGE_ASPECTS.includes(draft.imageAspect)) {
    problems.push("Choose a supported aspect ratio.");
  }
  if (draft.task === "image") {
    const validModelId = typeof draft.model === "string" && MODEL_ID_RE.test(draft.model);
    const matchesList = !allowedModels || allowedModels.length === 0 || allowedModels.some((m) => m.id === draft.model);
    if (!validModelId || !matchesList) problems.push("Choose an available model.");
  }
  if (draft.references.length > 0) problems.push("This generation task takes no reference images.");
  return problems;
}

/** The validated intent a submit sends: the closed 8-key generate intent.
 *  Only the form's own fields are used, captured once. */
export function toIntent(draft: CreateDraft, requestId: string): StudioIntent {
  const video = draft.task === "text_to_video";
  const intent: StudioIntent = {
    kind: "generate" as const,
    task: (draft.task === "edit" ? "edit" : video ? "text_to_video" : "image") as Exclude<Task, "image_to_video">,
    model: video ? modelFor(draft.task) : draft.model,
    prompt: draft.prompt.trim(),
    aspectRatio: video ? draft.videoAspect : draft.imageAspect,
    resolution: video ? draft.videoResolution : "1K",
    references: [...draft.references],
    requestId,
  };
  if (video) {
    intent.duration = draft.duration;
    intent.videoResolution = draft.videoResolution;
  }
  return intent;
}

/** Who made an asset or job. Never invents a person: an operator or an
 *  unknown legacy creator is labelled as such. */
export function describeCreator(creator: StudioCreator): string {
  switch (creator.kind) {
    case "user":
      return creator.label ?? "Workspace user";
    case "operator":
      return "Local operator";
    case "unknown":
      return "Unknown creator";
  }
}

/** Same actor as the current verified one. Creator is a filter, not access. */
export function isMine(creator: StudioCreator, actor: StudioActor | null): boolean {
  if (!actor) return false;
  if (actor.kind === "operator") return creator.kind === "operator";
  return creator.kind === "user" && creator.id === actor.id;
}

export function lifecycleLabel(asset: StudioAsset): string {
  return asset.lifecycle === "published" ? "In workspace library" : "Draft";
}


/** Short, stable relative age for library metadata. `createdAt` is epoch ms. */
export function formatRelative(epoch: number, now = Date.now()): string {
  if (!Number.isFinite(epoch) || epoch <= 0) return "Unknown";
  const seconds = Math.max(0, Math.floor((now - epoch) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 172800) return "Yesterday";
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(epoch);
}

/** "1 asset", "2 assets". */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Absolute local date and time for detail metadata, e.g. "23 Nov 2026, 06:39". */
export function formatAbsolute(epoch: number): string {
  if (!Number.isFinite(epoch) || epoch <= 0) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(epoch);
}

/** Style phrases a person may append to or toggle in a brief. Text only: they
 *  change the brief, never the model, size or price. */
export const STYLE_CHIPS = ["Flat illustration", "Photograph", "3D render", "Minimal line art", "Watercolour", "Plain white background", "No text"] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitStyleClauses(brief: string): string[] {
  return brief
    .split(/\s*(?:[.,;!?]+)\s*/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/** Whether `brief` already carries the given style cue as a distinct phrase. */
export function hasStyleCue(brief: string, phrase: string): boolean {
  const target = phrase.trim().toLowerCase();
  if (!target) return false;
  return splitStyleClauses(brief).includes(target);
}

/** Toggle one style cue cleanly as a comma/sentence phrase within `MAX_PROMPT`. */
export function toggleStyleCue(brief: string, phrase: string): string {
  const target = phrase.trim();
  if (!target) return brief;
  if (hasStyleCue(brief, target)) {
    const escaped = escapeRegex(target);
    const cleaned = brief
      .replace(new RegExp(`(^|[!?]+\\s*|[.,;]+\\s*)${escaped}(?=\\s*(?:[.,;!?]+|$))`, "ig"), (_m, lead: string) =>
        /[!?]/.test(lead) ? lead.trimEnd() : "")
      .replace(/^\s*[.,;!?]+\s*/, "")
      .replace(/\s*([.,;!?])\s*([.,;])+/g, "$1 ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return cleaned;
  }
  const base = brief.trimEnd().replace(/[,;]+$/, "").trimEnd();
  if (base.length === 0) {
    return target.length <= MAX_PROMPT ? target : brief;
  }
  const sep = /[.!?]$/.test(base) ? " " : ", ";
  const joined = `${base}${sep}${target}`;
  return joined.length <= MAX_PROMPT ? joined : brief;
}
