import { useEffect, useState } from "react";
import type { DrawerAssetContext, StudioAsset, StudioHost, StudioSnapshot } from "../../host/port";
import { AssetDetail } from "./AssetDetail";
import { CreatePanel } from "./CreatePanel";
import { Library } from "./Library";
import { useStudio } from "./state";
import "./studio.css";

const WAITING = new Set(["awaiting_host", "catalog_loading"]);

/** Plain text for an unavailable screen. Loading states have none: the
 *  Library shows skeletons instead of a notice that pushes content down. */
function unavailableText(reason: string): string {
  switch (reason) {
    case "media_read_not_advertised":
      return "Cadence has not confirmed workspace catalog access for this screen. Ask an operator to check the host capability setup.";
    case "unsupported_host":
      return "This screen needs a newer Cadence host. Ask an operator to check the host version and app compatibility.";
    case "invalid_reply":
    case "lost_invalid_reply":
    case "repeated_cursor":
    case "malformed_push":
      return "Designer Studio received an invalid catalog or connection response from Cadence. Reopen this screen; if this continues, ask an operator to check host and app version compatibility.";
    case "scope_changed":
      return "The Cadence installation or app version changed. Reopen Designer Studio.";
    case "closed":
    case "port_closed":
    case "port_error":
    case "unloaded":
      return "The connection to Cadence closed or could not be read. Reopen Designer Studio.";
    default:
      if (reason.startsWith("refused_")) return "Cadence refused the connection or workspace catalog read. Ask an operator to check host setup; if this continues, check that the host is reachable and compatible.";
      if (reason.startsWith("lost_")) return "The workspace catalog read could not be confirmed. Reopen Designer Studio; if this continues, ask an operator to investigate the connection.";
      return "Designer Studio could not confirm its connection to Cadence. Reopen this screen; if this continues, ask an operator to check the host connection.";
  }
}

/** Attach one retained image to the host chat composer. Returns null on a
 *  confirmed attach (the composer chip is the feedback; no in-app banner) or
 *  the text to show when it was refused or could not be confirmed. */
async function attachToChat(host: StudioHost, snapshot: StudioSnapshot, asset: StudioAsset): Promise<string | null> {
  const canRefine = snapshot.status === "ready" && snapshot.capabilities.refineInChat;
  if (!canRefine || asset.kind !== "image") return "Refine in chat is not available: Cadence has not confirmed image chat on this host.";
  try {
    const receipt = await host.submit({ kind: "refine_in_chat", assetId: asset.id, revision: asset.revision });
    if (receipt.status === "chat_attached" && receipt.assetId === asset.id && receipt.revision === asset.revision) return null;
    if (receipt.status === "refused" || receipt.status === "uncertain") return receipt.text;
    if (receipt.status === "revision_conflict") return "This image changed. Choose its current version before attaching.";
  } catch {
    // The handoff may have reached the host. Do not claim nothing happened.
  }
  return "Could not confirm attachment. Check the chat composer before trying again.";
}

/** Designer Studio app surface. The host shell, its drawer and chat stay outside this frame. */
export function DesignerStudio({ host }: { host: StudioHost }) {
  const studio = useStudio(host);
  // The surface role is read on every render; the host's surface push
  // refreshes the snapshot store, so a role change re-renders this tree.
  const surface = host.surface();
  if (surface.role === "drawer") {
    return surface.name === "create"
      ? <DrawerCreate host={host} studio={studio} />
      : <DrawerDetail host={host} snapshot={studio.snapshot} />;
  }
  return <Primary host={host} studio={studio} />;
}

function Primary({ host, studio }: { host: StudioHost; studio: ReturnType<typeof useStudio> }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // `try` asks the board for its drawer; a refusal (older host, or no drawer
  // capability on this mount) falls back to the in-frame panel for this session.
  const [drawerMode, setDrawerMode] = useState<"try" | "inframe">("try");
  const snapshot = studio.snapshot;
  const reason = snapshot.status === "unavailable" ? snapshot.reason : null;
  const status = snapshot.status === "ready" ? "ready" : reason && WAITING.has(reason) ? "loading" : "unavailable";

  const assets = snapshot.status === "ready" ? snapshot.assets : [];
  const jobs = snapshot.status === "ready" ? snapshot.jobs : [];
  const activeJobs = jobs.filter((j) => j.state === "queued" || j.state === "running");
  const actor = snapshot.status === "ready" ? snapshot.currentActor : null;
  const selected = assets.find((a) => a.id === selectedId) ?? null;
  const canGenerate = snapshot.status === "ready" && snapshot.capabilities.generate;
  const canPublish = snapshot.status === "ready" && snapshot.capabilities.publish;
  const canDownload = snapshot.status === "ready" && snapshot.capabilities.download;
  const canRefine = snapshot.status === "ready" && snapshot.capabilities.refineInChat;
  const settledAssetId = studio.phase.kind === "completed" ? studio.phase.assetId : undefined;
  const settledAsset = settledAssetId ? assets.find((a) => a.id === settledAssetId) ?? null : null;

  async function openCreation() {
    setSelectedId(null);
    if (drawerMode === "try" && host.surface().role === "primary" && host.openCreateDrawer) {
      const result = await host.openCreateDrawer();
      if (result === "opened") {
        setCreateOpen(false);
        return;
      }
      if (result === "refused") setDrawerMode("inframe");
    }
    setCreateOpen(true);
  }

  async function openAsset(asset: StudioAsset) {
    setCreateOpen(false);
    if (drawerMode === "try" && host.surface().role === "primary") {
      const result = await host.openDrawer({ assetId: asset.id, revision: asset.revision });
      if (result === "opened") {
        setSelectedId(null);
        return;
      }
      // Only the host's own refusal means "no board drawer here" for the
      // session; a local not-sent or an unconfirmed open falls back once.
      if (result === "refused") setDrawerMode("inframe");
    }
    setSelectedId(asset.id);
  }

  return (
    <main className="studio" aria-label="Designer Studio">
      {status === "unavailable" && reason && (
        <p className="ds-note ds-warn" role="status">{unavailableText(reason)}</p>
      )}

      <div className={`ds-library${createOpen || selected ? " ds-pane-present" : ""}`}>
        <div className="ds-canvas">
          <Library
            status={status}
            assets={assets}
            jobs={jobs}
            actor={actor}
            selectedId={selectedId}
            onSelect={(asset) => void openAsset(asset)}
            onSelectJob={() => void openCreation()}
            onCreate={() => void openCreation()}
            onRefresh={() => host.refresh()}
            createOpen={createOpen}
            host={host}
            canGenerate={canGenerate}
            canPublish={canPublish}
            canRefine={canRefine}
          />
        </div>
        {createOpen && (
          <CreatePanel
            draft={studio.draft}
            setDraft={studio.setDraft}
            problems={studio.problems}
            phase={studio.phase}
            busy={studio.busy}
            generateAvailable={studio.generateAvailable}
            locked={studio.locked}
            host={host}
            settledAsset={settledAsset}
            models={studio.models}
            activeJobs={activeJobs}
            onRequest={studio.requestGeneration}
            onStartOver={studio.startOver}
            onOpenAsset={(target) => {
              setCreateOpen(false);
              void openAsset(target);
            }}
            onClose={() => setCreateOpen(false)}
          />
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
            onRefine={(asset) => attachToChat(host, snapshot, asset)}
            onSelectAsset={(target) => void openAsset(target)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </main>
  );
}

/** Host drawer child for `surface="create"`: renders New design inside the board drawer. */
function DrawerCreate({ host, studio }: { host: StudioHost; studio: ReturnType<typeof useStudio> }) {
  const snapshot = studio.snapshot;
  const assets = snapshot.status === "ready" ? snapshot.assets : [];
  const jobs = snapshot.status === "ready" ? snapshot.jobs : [];
  const activeJobs = jobs.filter((j) => j.state === "queued" || j.state === "running");
  const settledAssetId = studio.phase.kind === "completed" ? studio.phase.assetId : undefined;
  const settledAsset = settledAssetId ? assets.find((a) => a.id === settledAssetId) ?? null : null;

  return (
    <main className="studio ds-in-drawer" aria-label="New design">
      <CreatePanel
        chrome="host"
        draft={studio.draft}
        setDraft={studio.setDraft}
        problems={studio.problems}
        phase={studio.phase}
        busy={studio.busy}
        generateAvailable={studio.generateAvailable}
        locked={studio.locked}
        host={host}
        settledAsset={settledAsset}
        models={studio.models}
        activeJobs={activeJobs}
        onRequest={studio.requestGeneration}
        onStartOver={studio.startOver}
        onOpenAsset={() => host.closeDrawer()}
        onClose={() => host.closeDrawer()}
      />
    </main>
  );
}

/** The board-drawer child: renders only the detail its primary opened. The
 *  open context is a pointer, never authority: the asset is re-read from this
 *  frame's own catalog and must still be the same revision. */
function DrawerDetail({ host, snapshot }: { host: StudioHost; snapshot: StudioSnapshot }) {
  const [context, setContext] = useState<DrawerAssetContext | null | "loading">("loading");
  const [overrideAssetId, setOverrideAssetId] = useState<string | null>(null);
  // The opened revision is checked once, when the asset first resolves. After
  // that the drawer follows the asset by id, so this frame's own confirmed
  // publish (revision + 1) stays visible instead of reading as a conflict.
  const [verified, setVerified] = useState<"pending" | "ok" | "stale">("pending");
  const connected = snapshot.status === "ready";
  useEffect(() => {
    if (!connected || context !== "loading") return;
    let live = true;
    void host.drawerContext().then((value) => { if (live) setContext(value); });
    return () => { live = false; };
  }, [connected, context, host]);

  const reason = snapshot.status === "unavailable" ? snapshot.reason : null;
  const hasBlockingReason = Boolean(reason && !WAITING.has(reason));
  const loading = !hasBlockingReason && (snapshot.status !== "ready" || context === "loading");
  let message: string | null = null;
  let asset: StudioAsset | null = null;
  if (reason && !WAITING.has(reason)) message = unavailableText(reason);
  else if (snapshot.status !== "ready" || context === "loading") message = null;
  else if (context === null) message = "This image could not be opened here. Close this panel and open it again from the Library.";
  else {
    const targetId = overrideAssetId ?? context.assetId;
    asset = snapshot.status === "ready" ? snapshot.assets.find((a) => a.id === targetId) ?? null : null;
    if (!asset) message = "This image is no longer in the Library.";
    else if (overrideAssetId === null) {
      const state = verified === "pending" ? (asset.revision === context.revision ? "ok" : "stale") : verified;
      if (state === "stale") {
        message = "This image changed since you opened it. Close this panel and open it again from the Library.";
        asset = null;
      }
    }
  }
  const firstAsset = context !== "loading" && context !== null && snapshot.status === "ready"
    ? snapshot.assets.find((a) => a.id === context.assetId) ?? null : null;
  useEffect(() => {
    if (verified !== "pending" || !firstAsset || context === "loading" || context === null) return;
    setVerified(firstAsset.revision === context.revision ? "ok" : "stale");
  }, [verified, firstAsset, context]);

  return (
    <main className="studio ds-in-drawer" aria-label="Designer Studio image details">
      {asset && snapshot.status === "ready" ? (
        <AssetDetail
          key={`${asset.id}:${asset.revision}`}
          chrome="host"
          asset={asset}
          canPublish={snapshot.capabilities.publish}
          canDownload={snapshot.capabilities.download}
          canRefine={snapshot.capabilities.refineInChat}
          lineageJobs={snapshot.jobs.filter((j) => j.assetId === asset.id)}
          host={host}
          sourceAssets={snapshot.assets}
          onSelectAsset={(target) => setOverrideAssetId(target.id)}
          onRefine={async (target) => {
            const error = await attachToChat(host, snapshot, target);
            // Attached: close the drawer so the chat composer is in view.
            if (error === null) host.closeDrawer();
            return error;
          }}
        />
      ) : loading ? (
        <div className="ds-host-detail ds-detail-skeleton" aria-busy="true" aria-label="Loading image details">
          <div className="ds-host-detail-body">
            <span className="ds-skeleton-art ds-detail-skeleton-art" />
            <span className="ds-skeleton-line" />
            <span className="ds-skeleton-line is-short" />
            <span className="ds-skeleton-line" />
          </div>
        </div>
      ) : (
        <p className="ds-note ds-warn" role="status">{message}</p>
      )}
    </main>
  );
}
