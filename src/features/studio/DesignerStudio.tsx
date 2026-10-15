import { useState } from "react";
import type { StudioHost } from "../../host/port";
import { AssetDetail } from "./AssetDetail";
import { CreatePanel } from "./CreatePanel";
import { Library } from "./Library";
import { describeCreator } from "./model";
import { useStudio } from "./state";
import type { CreateDraft } from "./types";
import "./studio.css";

/** Designer Studio app surface. The host shell and chat stay outside this frame. */
export function DesignerStudio({ host }: { host: StudioHost }) {
  const studio = useStudio(host);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const snapshot = studio.snapshot;
  const reason = snapshot.status === "unavailable" ? snapshot.reason : null;
  const waiting = reason === "awaiting_host" || reason === "catalog_loading";
  let unavailableText = "Designer Studio could not confirm its connection or workspace catalog. Select an active app context in Cadence and reopen this screen; if this continues, ask an operator to investigate setup.";
  switch (reason) {
    case "awaiting_host":
      unavailableText = "Waiting for Cadence to connect this screen to the active app context.";
      break;
    case "catalog_loading":
      unavailableText = "Loading the workspace catalog from Cadence.";
      break;
    case "media_read_not_advertised":
      unavailableText = "Cadence has not enabled workspace catalog access for this screen. Ask an operator to check the active app context and host setup.";
      break;
    case "unsupported_host":
      unavailableText = "This screen needs a compatible Cadence host. Reopen Designer Studio from an active app context; if this continues, ask an operator to check the host version and setup.";
      break;
    case "invalid_reply":
    case "lost_invalid_reply":
    case "repeated_cursor":
    case "malformed_push":
      unavailableText = "Designer Studio received an invalid catalog or connection response from Cadence. Reopen this screen; if this continues, ask an operator to check host/app version compatibility and connection setup.";
      break;
    case "scope_changed":
      unavailableText = "The app context changed. Select the intended active app context in Cadence and reopen Designer Studio.";
      break;
    case "closed":
    case "port_closed":
    case "port_error":
    case "unloaded":
      unavailableText = "The connection to Cadence closed or could not be read. Reopen Designer Studio in the active app context.";
      break;
    default:
      if (reason?.startsWith("refused_")) {
        unavailableText = "Cadence refused the workspace catalog read. Select an active app context and reopen Designer Studio; if this continues, ask an operator to investigate context access and setup.";
      } else if (reason?.startsWith("lost_")) {
        unavailableText = "The workspace catalog read could not be confirmed. Reopen Designer Studio in the active app context; if this continues, ask an operator to investigate the connection and setup.";
      }
  }

  const assets = snapshot.status === "ready" ? snapshot.assets : [];
  const jobs = snapshot.status === "ready" ? snapshot.jobs : [];
  const actor = snapshot.status === "ready" ? snapshot.currentActor : null;
  const selected = assets.find((a) => a.id === selectedId) ?? null;
  const canPublish = snapshot.status === "ready" && snapshot.capabilities.publish;
  const canDownload = snapshot.status === "ready" && snapshot.capabilities.download;

  function openCreation() {
    setSelectedId(null);
    setCreateOpen(true);
  }

  function selectAsset(id: string) {
    setCreateOpen(false);
    setSelectedId(id);
  }

  function reuse(draft: CreateDraft) {
    studio.setDraft(draft);
    openCreation();
  }

  return (
    <main className="studio" aria-label="Designer Studio">
      {snapshot.status === "unavailable" && (
        <p className={waiting ? "ds-note" : "ds-note ds-warn"} role="status">
          {unavailableText}
        </p>
      )}
      {snapshot.status === "ready" && (
        <p className="ds-note" role="status">
          The workspace catalog is connected. Image generation, library publishing and original download are offered only when this workspace's host confirms them. Reuse, edit, text-to-video and image-to-video are not available yet.
        </p>
      )}

      <div className={`ds-library${createOpen || selected ? " ds-pane-present" : ""}`}>
        <div className="ds-canvas">
          <Library assets={assets} actor={actor} selectedId={selectedId} onSelect={selectAsset} onCreate={openCreation} createOpen={createOpen} />
          {jobs.length > 0 && (
            <ul className="ds-jobs" aria-label="Jobs">
              {jobs.map((j) => <li key={j.id}>{j.task}: {j.state}. {describeCreator(j.creator)}. {j.note}</li>)}
            </ul>
          )}
        </div>
        {createOpen && (
          <aside className="drawer ds-drawer" aria-labelledby="ds-new-creation-heading">
            <header className="dhead">
              <h3 id="ds-new-creation-heading">New creation</h3>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreateOpen(false)} aria-label="Close creation drawer">Close</button>
            </header>
            <div className="dbody ds-drawer-body">
              <CreatePanel
                draft={studio.draft}
                setDraft={studio.setDraft}
                problems={studio.problems}
                phase={studio.phase}
                busy={studio.busy}
                canSubmit={studio.canSubmit}
                onRequest={studio.requestGeneration}
              />
            </div>
            <div className="dfoot">
              <p className="ds-hint">Closing keeps your draft and does not cancel a pending request.</p>
            </div>
          </aside>
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
    </main>
  );
}
