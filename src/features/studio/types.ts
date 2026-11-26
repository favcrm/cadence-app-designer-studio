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

/** All: every authorized asset. Library: curated published assets.
 *  Drafts: creator's/workspace drafts awaiting review or publish. */
export type LibraryScope = "all" | "library" | "drafts";
export type LibraryKind = "all" | "image" | "video";
