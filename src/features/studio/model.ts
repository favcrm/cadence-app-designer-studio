import type { ModelId, StudioActor, StudioAsset, StudioCreator, StudioIntent, Task } from "../../host/port";
import type { CreateDraft, ImageAspect, VideoAspect, VideoDuration, VideoResolution } from "./types";

/** Limits copied from the admitted platform inference schema (AgenticOS main
 *  3b935dd8): gpt-image-2.5 and seedance-2-5 only. A limit missing from the
 *  real contract is a blocker, not a value this form invents. */
export const IMAGE_MODEL: ModelId = "openai/gpt-image-2.5";
export const VIDEO_MODEL: ModelId = "bytedance/seedance-2-5";
/** DSN-1: the native image bridge admits the square aspect only. */
export const IMAGE_ASPECTS: ImageAspect[] = ["1:1"];
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
export function validate(draft: CreateDraft): string[] {
  const problems: string[] = [];
  if (!TASK_STATUS[draft.task].enabled) problems.push(TASK_STATUS[draft.task].reason ?? "This task is not available.");
  const prompt = draft.prompt.trim();
  if (prompt.length === 0) problems.push("Write a prompt.");
  if (draft.prompt.length > MAX_PROMPT) problems.push(`Keep the prompt to ${MAX_PROMPT} characters.`);
  if (prompt.length > 0 && !isVisiblePrompt(prompt)) problems.push("The prompt has invisible or control characters; use plain visible text.");
  if (draft.task === "image" && draft.imageAspect !== "1:1") problems.push("Image generation is square only here.");
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
    model: modelFor(draft.task),
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

/** A reuse starts a new draft from the authorized asset ID; it never copies a path or URL. */
export function reuseDraft(asset: StudioAsset): CreateDraft {
  const task: Task = asset.kind === "video" ? "text_to_video" : "edit";
  return { ...emptyDraft(task), references: [asset.id] };
}
