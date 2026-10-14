import type { ModelId, Task } from "../../host/port";

export type { ModelId, StudioAsset, StudioJob, StudioSnapshot, Task } from "../../host/port";

export type ImageAspect = "1:1" | "16:9" | "9:16" | "3:2" | "2:3";
export type VideoAspect = "16:9" | "9:16" | "1:1" | "auto";
export type VideoDuration = 4 | 6 | 8 | 10;
export type VideoResolution = "480p" | "720p" | "1080p";

/** The create form, as the person edits it. Nothing here names scope or owner. */
export interface CreateDraft {
  task: Task;
  model: ModelId;
  prompt: string;
  imageAspect: ImageAspect;
  videoAspect: VideoAspect;
  duration: VideoDuration;
  videoResolution: VideoResolution;
  /** Authorized asset IDs chosen from the library; never paths or URLs. */
  references: string[];
}

/** Workspace: every asset the viewer is authorized to see. Library: the
 *  published, curated subset. Mine: a creator filter over the same set. */
export type LibraryScope = "workspace" | "library" | "mine";
export type LibraryKind = "all" | "image" | "video";
