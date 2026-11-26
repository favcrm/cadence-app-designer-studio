import { useRef, useState } from "react";
import type { StudioAsset, StudioHost, StudioJob, StudioModelOption } from "../../host/port";
import { AssetPreview } from "./AssetPreview";
import { Dropdown } from "./Dropdown";
import { DEFAULT_IMAGE_MODELS, IMAGE_ASPECTS, MAX_PROMPT, STYLE_CHIPS, hasStyleCue, toggleStyleCue } from "./model";
import type { Phase } from "./state";
import type { CreateDraft } from "./types";

interface Props {
  draft: CreateDraft;
  setDraft: (next: CreateDraft) => void;
  problems: string[];
  phase: Phase;
  busy: boolean;
  /** The host advertises generation on this screen. */
  generateAvailable: boolean;
  /** A request may still be open: no new submit, no start-over. */
  locked: boolean;
  host: StudioHost;
  settledAsset: StudioAsset | null;
  models?: readonly StudioModelOption[];
  activeJobs?: readonly StudioJob[];
  chrome?: "inframe" | "host";
  onRequest: () => void;
  onStartOver: () => void;
  onOpenAsset?: (asset: StudioAsset) => void;
  onClose: () => void;
}

const EXAMPLE = "e.g. A flat illustration of a single blue paper airplane on a plain white background, no text.";

/** New design: one image from one brief. Creative brief + style cues come first,
 *  followed by the price-free Model selector and Aspect ratio pills. The host
 *  approval bar owns pricing and confirmation. */
export function CreatePanel(props: Props) {
  const {
    draft,
    setDraft,
    problems,
    phase,
    busy,
    generateAvailable,
    locked,
    host,
    settledAsset,
    onOpenAsset,
    chrome = "inframe",
  } = props;
  const models = props.models && props.models.length > 0 ? props.models : DEFAULT_IMAGE_MODELS;
  const selectedModel = models.some((m) => m.id === draft.model) ? draft.model : models[0].id;
  const activeJobs = props.activeJobs ?? [];
  const [tried, setTried] = useState(false);
  const brief = useRef<HTMLTextAreaElement>(null);
  const inProgress =
    busy ||
    (phase.kind !== "idle" &&
      phase.kind !== "refused" &&
      phase.kind !== "conflict" &&
      phase.kind !== "dismissed");

  function submit() {
    if (problems.length > 0) {
      setTried(true);
      brief.current?.focus();
      return;
    }
    setTried(false);
    props.onRequest();
  }

  const body = inProgress ? (
    <Progress phase={phase} busy={busy} brief={draft.prompt.trim()} host={host} settledAsset={settledAsset} onOpenAsset={onOpenAsset} />
  ) : (
    <>
      {activeJobs.length > 0 && (
        <div className="ds-note" role="status">
          Generating{" "}
          {activeJobs.length === 1
            ? activeJobs[0].title
              ? `“${activeJobs[0].title}”`
              : "an image"
            : `${activeJobs.length} images`}{" "}
          in Cadence — finished drafts appear in the Library.
        </div>
      )}

      <div className="ds-create-field">
        <div className="ds-create-label">
          <label htmlFor="ds-brief">Creative brief</label>
          <span>Subject, style and background</span>
        </div>
        <div className="ds-brief">
          <textarea
            id="ds-brief"
            ref={brief}
            className="field"
            value={draft.prompt}
            maxLength={MAX_PROMPT}
            rows={6}
            placeholder={EXAMPLE}
            aria-invalid={tried && problems.length > 0}
            aria-describedby={tried && problems.length > 0 ? "ds-brief-problems" : undefined}
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          />
          <span className="ds-brief-count" aria-hidden="true">{draft.prompt.length} / {MAX_PROMPT}</span>
        </div>
        {tried && problems.length > 0 && (
          <ul id="ds-brief-problems" className="ds-problems" role="alert">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
      </div>

      <div className="ds-create-field">
        <div className="ds-create-label">
          <span id="ds-style-label">Style cues</span>
          <span>Click to toggle in your brief</span>
        </div>
        <div className="ds-chips" role="group" aria-labelledby="ds-style-label">
          {STYLE_CHIPS.map((chip) => {
            const active = hasStyleCue(draft.prompt, chip);
            return (
              <button
                key={chip}
                type="button"
                className="chip"
                aria-pressed={active}
                onClick={() => {
                  setDraft({ ...draft, prompt: toggleStyleCue(draft.prompt, chip) });
                  brief.current?.focus();
                }}
              >
                {chip}
              </button>
            );
          })}
        </div>
      </div>

      <div className="ds-create-field">
        <div className="ds-create-label">
          <span>Model</span>
          <span>Image generator</span>
        </div>
        <div className="ds-model-select">
          <Dropdown
            label="Model"
            value={selectedModel}
            options={models.map((m) => ({ value: m.id, label: m.name }))}
            onChange={(nextModel) => setDraft({ ...draft, model: nextModel })}
          />
        </div>
      </div>

      <div className="ds-create-field">
        <div className="ds-create-label">
          <span id="ds-aspect-label">Aspect ratio</span>
          <span>Canvas proportions</span>
        </div>
        <div className="ds-aspect-pills" role="group" aria-labelledby="ds-aspect-label">
          {IMAGE_ASPECTS.map((ratio) => (
            <button
              key={ratio}
              type="button"
              className="ds-aspect-pill"
              aria-pressed={draft.imageAspect === ratio}
              onClick={() => setDraft({ ...draft, imageAspect: ratio })}
            >
              {ratio}
            </button>
          ))}
        </div>
      </div>

      {phase.kind === "dismissed" && (
        <p className="ds-note" role="status">Cancelled — nothing was started.</p>
      )}
      {phase.kind === "refused" && <p className="ds-note ds-warn" role="alert">{phase.text}</p>}
    </>
  );

  const foot = inProgress ? (
    <>
      {phase.kind === "pending" ? (
        <p className="ds-hint">Generating in the background — you can close this drawer and watch progress in the Library grid.</p>
      ) : locked ? (
        <p className="ds-hint">Closing keeps the request open; it can't be cancelled from here.</p>
      ) : null}
      <span className="ds-grow" />
      {!locked && <button type="button" className="btn btn-sm" onClick={() => { setTried(false); props.onStartOver(); }}>Start another</button>}
      {phase.kind === "completed" && settledAsset && onOpenAsset ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenAsset(settledAsset)}>Open details</button>
      ) : (
        <button type="button" className="btn btn-primary btn-sm" onClick={props.onClose}>Done</button>
      )}
    </>
  ) : (
    <>
      <p className="ds-hint">Cadence will confirm the live cost before starting.</p>
      <span className="ds-grow" />
      <button type="button" className="btn btn-sm" onClick={props.onClose}>Cancel</button>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={!generateAvailable || locked}
        title={generateAvailable ? undefined : "Generation is not available on this screen."}
        onClick={submit}
      >
        Generate
      </button>
    </>
  );

  if (chrome === "host") {
    return (
      <section className="ds-host-detail ds-create" aria-label="New design">
        <header className="ds-host-detail-head">
          <p>One image from one brief</p>
        </header>
        <div className="ds-host-detail-body">{body}</div>
        <footer className="ds-host-detail-foot ds-create-foot">{foot}</footer>
      </section>
    );
  }

  return (
    <aside className="drawer ds-drawer ds-create" aria-labelledby="ds-new-design-heading">
      <header className="dhead">
        <div className="ds-drawer-title">
          <h3 id="ds-new-design-heading">New design</h3>
          <p>One image from one brief</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={props.onClose} aria-label="Close new design">Close</button>
      </header>
      <div className="dbody ds-drawer-body">{body}</div>
      <div className="dfoot ds-create-foot">{foot}</div>
    </aside>
  );
}

type StepState = "done" | "now" | "todo" | "failed";

function Progress({
  phase,
  busy,
  brief,
  host,
  settledAsset,
  onOpenAsset,
}: {
  phase: Phase;
  busy: boolean;
  brief: string;
  host: StudioHost;
  settledAsset: StudioAsset | null;
  onOpenAsset?: (asset: StudioAsset) => void;
}) {
  const waiting = busy || phase.kind === "awaiting_host";
  const running = phase.kind === "pending";
  const finished = phase.kind === "completed";
  const failed = phase.kind === "generation_failed" || phase.kind === "cancelled";
  const steps: { title: string; text: string; state: StepState }[] = [
    { title: "Sent to Cadence", text: "Your brief is fixed for this run.", state: "done" },
    {
      title: "Waiting for your approval",
      text: "Press Cadence's price button at the bottom of the screen to approve and start.",
      state: waiting ? "now" : phase.kind === "uncertain" ? "todo" : "done",
    },
    {
      title: "Generating",
      text: "Usually under a minute.",
      state: running ? "now" : finished ? "done" : failed ? "failed" : "todo",
    },
    { title: "Saved to your Library as a draft", text: "It appears in the Library when ready.", state: finished ? "done" : "todo" },
  ];
  return (
    <div className="ds-progress">
      {brief && <blockquote className="ds-quote">{brief}</blockquote>}
      {finished && settledAsset && (
        <div className="ds-result-preview">
          {onOpenAsset ? (
            <button
              type="button"
              className="ds-library-card"
              onClick={() => onOpenAsset(settledAsset)}
              aria-label={`Open ${settledAsset.title}`}
            >
              <span className="ds-card-art">
                <AssetPreview asset={settledAsset} host={host} />
                <span className="ds-card-badge">Draft</span>
              </span>
            </button>
          ) : (
            <div className="ds-card-art">
              <AssetPreview asset={settledAsset} host={host} />
              <span className="ds-card-badge">Draft</span>
            </div>
          )}
          <div className="ds-result-meta">
            <strong>{settledAsset.title}</strong>
            <span>Ready in your Library as a draft</span>
          </div>
        </div>
      )}
      <ol className="ds-steps" aria-label="Request progress">
        {steps.map((step) => (
          <li key={step.title} className={`ds-step is-${step.state}`} aria-current={step.state === "now" ? "step" : undefined}>
            <span className="ds-step-dot" aria-hidden="true" />
            <span><strong>{step.title}</strong><span>{step.text}</span></span>
          </li>
        ))}
      </ol>
      <Outcome phase={phase} hasSettledAsset={finished && settledAsset !== null} />
    </div>
  );
}

function Outcome({ phase, hasSettledAsset }: { phase: Phase; hasSettledAsset: boolean }) {
  switch (phase.kind) {
    case "completed":
      return hasSettledAsset ? null : <p className="ds-note ds-ok" role="status">Done. The new image is in the Library as a draft.</p>;
    case "generation_failed":
      return <p className="ds-note ds-warn" role="status">Generation failed in Cadence. Check the Library before trying again.</p>;
    case "cancelled":
      return <p className="ds-note ds-warn" role="status">The run was cancelled in Cadence.</p>;
    case "uncertain":
      return (
        <div className="ds-note ds-warn" role="status">
          <p>{phase.text}</p>
          <p>Check the Library for this request before starting another. Nothing is sent again from here.</p>
        </div>
      );
    default:
      return null;
  }
}
