import { useState } from "react";
import type { StudioHost } from "../../host/port";
import { AssetDetail } from "./AssetDetail";
import { CreatePanel } from "./CreatePanel";
import { Library } from "./Library";
import { describeCreator } from "./model";
import { useStudio } from "./state";
import type { CreateDraft } from "./types";
import "./studio.css";

type View = "create" | "library";

/** Designer Studio app surface. The host shell and chat stay outside this frame. */
export function DesignerStudio({ host }: { host: StudioHost }) {
  const studio = useStudio(host);
  const [view, setView] = useState<View>("create");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const snapshot = studio.snapshot;

  const assets = snapshot.status === "ready" ? snapshot.assets : [];
  const jobs = snapshot.status === "ready" ? snapshot.jobs : [];
  const actor = snapshot.status === "ready" ? snapshot.currentActor : null;
  const selected = assets.find((a) => a.id === selectedId) ?? null;
  const canPublish = snapshot.status === "ready" && snapshot.capabilities.publish;
  const canDownload = snapshot.status === "ready" && snapshot.capabilities.download;

  function reuse(draft: CreateDraft) {
    studio.setDraft(draft);
    setView("create");
  }

  return (
    <main className="studio" aria-label="Designer Studio">
      <nav className="tabs" aria-label="Designer Studio views">
        <button type="button" className={`tab${view === "create" ? " on" : ""}`} aria-pressed={view === "create"} onClick={() => setView("create")}>Create</button>
        <button type="button" className={`tab${view === "library" ? " on" : ""}`} aria-pressed={view === "library"} onClick={() => setView("library")}>Library</button>
      </nav>

      {snapshot.status === "unavailable" && (
        <p className="ds-note ds-warn" role="status">
          Designer Studio services are not available in this workspace yet. Nothing can be generated, saved or published here.
        </p>
      )}
      {snapshot.status === "ready" && (
        <p className="ds-note" role="status">
          The workspace catalog is connected. Image generation, library publishing and original download are offered only when this workspace's host confirms them. Reuse, edit, text-to-video and image-to-video are not available yet.
        </p>
      )}

      {view === "create" ? (
        <CreatePanel
          draft={studio.draft}
          setDraft={studio.setDraft}
          problems={studio.problems}
          phase={studio.phase}
          busy={studio.busy}
          canSubmit={studio.canSubmit}
          onRequest={studio.requestGeneration}
        />
      ) : (
        <div className="ds-library">
          <Library assets={assets} actor={actor} selectedId={selectedId} onSelect={setSelectedId} />
          {jobs.length > 0 && (
            <ul className="ds-jobs" aria-label="Jobs">
              {jobs.map((j) => <li key={j.id}>{j.task}: {j.state}. {describeCreator(j.creator)}. {j.note}</li>)}
            </ul>
          )}
          {selected && (
            <AssetDetail
              asset={selected}
              canPublish={canPublish}
              canDownload={canDownload}
              lineageJobs={jobs.filter((j) => j.assetId === selected.id)}
              host={host}
              onReuse={reuse}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      )}
    </main>
  );
}
