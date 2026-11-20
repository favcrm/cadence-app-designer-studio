import { MAX_PROMPT, TASK_STATUS, VIDEO_ASPECTS, VIDEO_DURATIONS, VIDEO_RESOLUTIONS, modelFor } from "./model";
import type { Phase } from "./state";
import type { CreateDraft } from "./types";
import type { Task } from "../../host/port";

const TASKS: { id: Task; label: string }[] = [
  { id: "image", label: "Create image" },
  { id: "edit", label: "Edit image" },
  { id: "text_to_video", label: "Text to video" },
  { id: "image_to_video", label: "Animate image" },
];

interface Props {
  draft: CreateDraft;
  setDraft: (next: CreateDraft) => void;
  problems: string[];
  phase: Phase;
  busy: boolean;
  canSubmit: boolean;
  onRequest: () => void;
  canRefine: boolean;
  onChooseReference: () => void;
}

export function CreatePanel(props: Props) {
  const { draft, setDraft, problems, phase, busy, canSubmit } = props;
  const video = draft.task === "text_to_video" || draft.task === "image_to_video";
  const disabledTasks = TASKS.filter((t) => !TASK_STATUS[t.id].enabled);

  return (
    <section aria-labelledby="ds-create-heading" className="ds-panel">
      <h2 id="ds-create-heading">Create</h2>
      <fieldset className="ds-task-field">
        <legend>Task</legend>
        <div className="seg ds-task-seg">
          {TASKS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={draft.task === t.id}
              aria-describedby={!TASK_STATUS[t.id].enabled ? "ds-task-note" : undefined}
              disabled={!TASK_STATUS[t.id].enabled}
              title={!TASK_STATUS[t.id].enabled ? TASK_STATUS[t.id].reason : undefined}
              onClick={() => setDraft({ ...draft, task: t.id, model: modelFor(t.id) })}
            >
              {t.label}
            </button>
          ))}
        </div>
        {disabledTasks.length > 0 && (
          <p id="ds-task-note" className="ds-hint" role="note">
            Only new image creation runs here. Refine an existing image in chat; video is not supported in this release.
          </p>
        )}
      </fieldset>

      <label className="ds-field">
        <span>Creative brief</span>
        <textarea className="field" value={draft.prompt} maxLength={MAX_PROMPT} rows={4} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} />
        <small>{draft.prompt.length}/{MAX_PROMPT}</small>
      </label>

      {video && (
        <div className="ds-row">
          <label className="ds-field">
            <span>Aspect ratio</span>
            <select className="field" value={draft.videoAspect} onChange={(e) => setDraft({ ...draft, videoAspect: e.target.value as CreateDraft["videoAspect"] })}>
              {VIDEO_ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="ds-field">
            <span>Duration (s)</span>
            <select className="field" value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: Number(e.target.value) as CreateDraft["duration"] })}>
              {VIDEO_DURATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="ds-field">
            <span>Resolution</span>
            <select className="field" value={draft.videoResolution} onChange={(e) => setDraft({ ...draft, videoResolution: e.target.value as CreateDraft["videoResolution"] })}>
              {VIDEO_RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="ds-reference-action">
        <span className="ds-hint">Changing an existing image? Choose a visual reference and continue in chat.</span>
        <button type="button" className="btn btn-sm" disabled={!props.canRefine} onClick={props.onChooseReference}>Choose reference</button>
      </div>

      {problems.length > 0 && (
        <ul className="ds-problems">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      <Status phase={phase} />

      <button type="button" className="btn btn-primary btn-sm" disabled={!canSubmit || busy} onClick={props.onRequest}>
        {busy ? "Sending..." : "Request generation"}
      </button>
      <p className="ds-hint">Review the model, inputs and price in Cadence before approving. Nothing runs without approval.</p>
    </section>
  );
}

function Status({ phase }: { phase: Phase }) {
  switch (phase.kind) {
    case "idle":
      return null;
    case "awaiting_host":
      return <p className="ds-note" role="status">Waiting for Cadence to show the price and ask for approval.</p>;
    case "pending":
      return <p className="ds-note" role="status">Accepted by Cadence. The run is still open; the result appears in the library as the host reports it.</p>;
    case "completed":
      return <p className="ds-note ds-ok" role="status">Generation completed. Check the refreshed library.</p>;
    case "generation_failed":
      return <p className="ds-note ds-warn" role="status">Generation failed in Cadence. Check the library before trying again.</p>;
    case "cancelled":
      return <p className="ds-note ds-warn" role="status">The generation run was cancelled in Cadence.</p>;
    case "saved":
      return <p className="ds-note ds-ok" role="status">Saved to your library.</p>;
    case "uncertain":
      return (
        <div className="ds-note ds-warn" role="status">
          <p>{phase.text}</p>
          <p>Check the library for this request before starting another. Nothing is sent again from here.</p>
        </div>
      );
    case "conflict":
      return <p className="ds-note ds-warn" role="alert">This asset changed (revision {phase.currentRevision}). Your edits are kept; reload the asset to continue.</p>;
    case "refused":
      return <p className="ds-note ds-warn" role="alert">{phase.text}</p>;
  }
}
