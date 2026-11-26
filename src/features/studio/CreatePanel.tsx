import { useRef, useState } from "react";
import type { StudioAsset, StudioHost } from "../../host/port";
import { AssetPreview } from "./AssetPreview";
import { MAX_PROMPT, STYLE_CHIPS, appendStyle } from "./model";
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
  onRequest: () => void;
  onStartOver: () => void;
  onOpenAsset: (asset: StudioAsset) => void;
  onClose: () => void;
}

const EXAMPLE = "e.g. A flat illustration of a single blue paper airplane on a plain white background, no text.";

/** New design: one image from one brief. This panel stays in the app's own
 *  frame because the one-generation lock and its uncertain/no-resend handling
 *  live in this frame; a board drawer child is unmounted on close and would
 *  forget an open paid run. The frame never prices or approves: Cadence draws
 *  its own price button, and one press there approves one paid run. */
export function CreatePanel(props: Props) {
  const { draft, setDraft, problems, phase, busy, generateAvailable, locked, host, settledAsset, onOpenAsset } = props;
  const [tried, setTried] = useState(false);
  const brief = useRef<HTMLTextAreaElement>(null);
  const inProgress = busy || phase.kind !== "idle" && phase.kind !== "refused" && phase.kind !== "conflict";

  function submit() {
    if (problems.length > 0) {
      setTried(true);
      brief.current?.focus();
      return;
    }
    setTried(false);
    props.onRequest();
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

      <div className="dbody ds-drawer-body">
        {inProgress ? (
          <Progress phase={phase} busy={busy} brief={draft.prompt.trim()} host={host} settledAsset={settledAsset} onOpenAsset={onOpenAsset} />
        ) : (
          <>
            <div className="ds-create-field">
              <div className="ds-create-label">
                <label htmlFor="ds-brief">Describe the image</label>
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
                <span id="ds-style-label">Add a style</span>
                <span>Adds a sentence to your brief</span>
              </div>
              <div className="ds-chips" role="group" aria-labelledby="ds-style-label">
                {STYLE_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setDraft({ ...draft, prompt: appendStyle(draft.prompt, chip) });
                      brief.current?.focus();
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>

            <div className="ds-facts">
              <div className="ds-fact"><strong>Square · 1:1</strong><span>The only size in this release</span></div>
              <div className="ds-fact"><strong>One image</strong><span>Saved as a draft in the Library</span></div>
            </div>

            {phase.kind === "refused" && <p className="ds-note ds-warn" role="alert">{phase.text}</p>}
          </>
        )}
      </div>

      <div className="dfoot ds-create-foot">
        {inProgress ? (
          <>
            {phase.kind === "pending" ? (
              <p className="ds-hint">Generating in the background — you can close this drawer and watch progress in the Library grid.</p>
            ) : locked ? (
              <p className="ds-hint">Closing keeps the request open; it can't be cancelled from here.</p>
            ) : null}
            <span className="ds-grow" />
            {!locked && <button type="button" className="btn btn-sm" onClick={() => { setTried(false); props.onStartOver(); }}>Start another</button>}
            {phase.kind === "completed" && settledAsset ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenAsset(settledAsset)}>Open details</button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={props.onClose}>Done</button>
            )}
          </>
        ) : (
          <>
            <p className="ds-hint">Next, Cadence shows the model and price on its own approve bar. One press approves and starts one paid run.</p>
            <span className="ds-grow" />
            <button type="button" className="btn btn-sm" onClick={props.onClose}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!generateAvailable || locked}
              title={generateAvailable ? undefined : "Generation is not available on this screen."}
              onClick={submit}
            >
              Continue
            </button>
          </>
        )}
      </div>
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
  onOpenAsset: (asset: StudioAsset) => void;
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
