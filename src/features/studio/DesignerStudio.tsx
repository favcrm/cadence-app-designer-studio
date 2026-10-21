import { useEffect, useState } from "react";
import type { StudioHost } from "../../host/port";
import { AssetDetail } from "./AssetDetail";
import { CreatePanel } from "./CreatePanel";
import { Library } from "./Library";
import { describeCreator } from "./model";
import { useStudio } from "./state";
import type { StudioAsset } from "../../host/port";
import { ReferencePicker } from "./ReferencePicker";
import "./studio.css";

/** Designer Studio app surface. The host shell and chat stay outside this frame. */
export function DesignerStudio({ host }: { host: StudioHost }) {
  const studio = useStudio(host);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chatNotice, setChatNotice] = useState<string | null>(null);
  const snapshot = studio.snapshot;
  const reason = snapshot.status === "unavailable" ? snapshot.reason : null;
  const waiting = reason === "awaiting_host" || reason === "catalog_loading";
  let unavailableText = "Designer Studio could not confirm its connection to Cadence. Reopen this screen; if this continues, ask an operator to check the host connection.";
  switch (reason) {
    case "awaiting_host":
      unavailableText = "Cadence is unreachable: no connection has been received for this screen yet. Reopen Designer Studio; if this continues, ask an operator to check the host connection.";
      break;
    case "catalog_loading":
      unavailableText = "Loading the workspace catalog from Cadence.";
      break;
    case "media_read_not_advertised":
      unavailableText = "Cadence has not confirmed workspace catalog access for this screen. Ask an operator to check the host capability setup.";
      break;
    case "unsupported_host":
      unavailableText = "This screen needs a newer Cadence host. Ask an operator to check the host version and app compatibility.";
      break;
    case "invalid_reply":
    case "lost_invalid_reply":
    case "repeated_cursor":
    case "malformed_push":
      unavailableText = "Designer Studio received an invalid catalog or connection response from Cadence. Reopen this screen; if this continues, ask an operator to check host and app version compatibility.";
      break;
    case "scope_changed":
      unavailableText = "The Cadence installation or app version changed. Reopen Designer Studio.";
      break;
    case "closed":
    case "port_closed":
    case "port_error":
    case "unloaded":
      unavailableText = "The connection to Cadence closed or could not be read. Reopen Designer Studio.";
      break;
    default:
      if (reason?.startsWith("refused_")) {
        unavailableText = "Cadence refused the connection or workspace catalog read. Ask an operator to check host setup; if this continues, check that the host is reachable and compatible.";
      } else if (reason?.startsWith("lost_")) {
        unavailableText = "The workspace catalog read could not be confirmed. Reopen Designer Studio; if this continues, ask an operator to investigate the connection.";
      }
  }

  const assets = snapshot.status === "ready" ? snapshot.assets : [];
  const jobs = snapshot.status === "ready" ? snapshot.jobs : [];
  const actor = snapshot.status === "ready" ? snapshot.currentActor : null;
  const selected = assets.find((a) => a.id === selectedId) ?? null;
  const canPublish = snapshot.status === "ready" && snapshot.capabilities.publish;
  const canDownload = snapshot.status === "ready" && snapshot.capabilities.download;
  const canRefine = snapshot.status === "ready" && snapshot.capabilities.refineInChat;

  useEffect(() => {
    if (snapshot.status !== "ready") setChatNotice(null);
  }, [snapshot.status]);

  function openCreation() {
    setSelectedId(null);
    setCreateOpen(true);
  }

  function selectAsset(id: string) {
    setCreateOpen(false);
    setSelectedId(id);
  }

  async function refine(asset: StudioAsset): Promise<string | null> {
    if (!canRefine || asset.kind !== "image") return "Refine in chat is not available: Cadence has not confirmed image chat on this host.";
    setChatNotice(null);
    const { id, revision } = asset;
    try {
      const receipt = await host.submit({ kind: "refine_in_chat", assetId: id, revision });
      if (receipt.status === "chat_attached" && receipt.assetId === id && receipt.revision === revision) {
        setChatNotice("Image attached in chat. Describe your changes and send when ready.");
        return null;
      }
      if (receipt.status === "refused" || receipt.status === "uncertain") return receipt.text;
      if (receipt.status === "revision_conflict") return "This image changed. Choose its current version before attaching.";
    } catch {
      // The handoff may have reached the host. Do not claim nothing happened.
    }
    return "Could not confirm attachment. Check the chat composer before trying again.";
  }

  return (
    <main className="studio" aria-label="Designer Studio">
      {snapshot.status === "unavailable" && (
        <p className={waiting ? "ds-note" : "ds-note ds-warn"} role="status">
          {unavailableText}
        </p>
      )}
      {chatNotice && <p className="ds-note ds-ok" role="status">{chatNotice}</p>}

      <div className={`ds-library${createOpen || selected ? " ds-pane-present" : ""}`}>
        <div className="ds-canvas">
          <Library assets={assets} actor={actor} selectedId={selectedId} onSelect={selectAsset} onCreate={openCreation} createOpen={createOpen} host={host} canRefine={canRefine} onChooseReference={() => setPickerOpen(true)} />
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
                canRefine={canRefine}
                onChooseReference={() => setPickerOpen(true)}
              />
            </div>
            <div className="dfoot">
              <p className="ds-hint">Closing keeps your draft and does not cancel a pending request.</p>
            </div>
          </aside>
        )}
        {selected && (
          <AssetDetail
            key={`${selected.id}:${selected.revision}`}
            asset={selected}
            canPublish={canPublish}
            canDownload={canDownload}
            lineageJobs={jobs.filter((j) => j.assetId === selected.id)}
            host={host}
            canRefine={canRefine}
            sourceAssets={assets}
            onRefine={refine}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
      {pickerOpen && snapshot.status === "ready" && (
        <ReferencePicker assets={assets} host={host} onChoose={refine} onClose={() => setPickerOpen(false)} />
      )}
    </main>
  );
}
