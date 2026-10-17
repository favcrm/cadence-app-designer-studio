import { useEffect, useRef, useState } from "react";
import type { Receipt, StudioAsset, StudioHost, StudioJob } from "../../host/port";
import { describeCreator, lifecycleLabel } from "./model";
import { AssetPreview } from "./AssetPreview";
import { newRequestId } from "./state";

interface Props {
  asset: StudioAsset;
  /** Host-advertised publish right; false keeps Add to library unavailable. */
  canPublish: boolean;
  /** Host-advertised original download right; false keeps Download original disabled. */
  canDownload: boolean;
  lineageJobs: StudioJob[];
  host: StudioHost;
  canRefine: boolean;
  sourceAssets: StudioAsset[];
  onRefine: (asset: StudioAsset) => Promise<string | null>;
  onClose: () => void;
}

/** Asset drawer built from the kit's own .drawer frame primitives. Publishing
 *  curates this same asset into the workspace library: the original bytes and
 *  id are unchanged, and the host checks the revision and the viewer's mutation
 *  role before it applies. */
export function AssetDetail({ asset, canPublish, canDownload, canRefine, sourceAssets, lineageJobs, host, onRefine, onClose }: Props) {
  const [note, setNote] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const published = asset.lifecycle === "published";
  const unavailable = "This is not available here yet.";

  async function run(intent: Parameters<StudioHost["submit"]>[0], describe: (r: Receipt) => string) {
    let text: string;
    try {
      text = describe(await host.submit(intent));
    } catch {
      text = "We could not confirm this with Cadence. Check the library before trying again.";
    }
    if (alive.current) setNote(text);
  }

  const publish = () =>
    run({ kind: "publish", assetId: asset.id, revision: asset.revision, requestId: newRequestId() }, (r) => {
      switch (r.status) {
        case "confirmed": return "Added to the workspace library. The original file is unchanged.";
        case "awaiting_host_confirmation": return "Waiting for Cadence to confirm adding this to the workspace library.";
        case "pending": return "Publishing is in progress. Check the workspace library.";
        case "revision_conflict": return `This asset changed (revision ${r.currentRevision}); reload before publishing.`;
        case "chat_attached":
        case "generation_result":
        case "download_started": return "Publishing is not confirmed. Check the workspace library before trying again.";
        case "refused": return r.text;
        case "uncertain": return r.text;
      }
    });

  async function download() {
    if (downloading) return;
    setDownloading(true);
    await run({ kind: "download", assetId: asset.id }, (r) => {
      switch (r.status) {
        case "download_started": return "Original download started. Check your browser’s downloads.";
        case "refused": return r.text;
        case "uncertain": return r.text;
        default: return "We could not confirm the original download. Check your browser’s downloads before trying again.";
      }
    });
    if (alive.current) setDownloading(false);
  }

  async function refine() {
    if (!canRefine || attaching || asset.kind !== "image") return;
    setAttaching(true);
    const error = await onRefine(asset);
    if (alive.current) {
      setAttaching(false);
      setNote(error ?? "Attached in chat. Describe your changes and send when ready.");
    }
  }

  return (
    <aside className="drawer ds-drawer" aria-labelledby="ds-asset-heading">
      <header className="dhead">
        <h3 id="ds-asset-heading">{asset.title}</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close asset details">Close</button>
      </header>
      <div className="dbody ds-drawer-body">
        <AssetPreview asset={asset} host={host} />
        <p className="ds-meta">{asset.kind} · {describeCreator(asset.creator)} · {lifecycleLabel(asset)} · revision {asset.revision}</p>
        {asset.prompt && <p className="ds-prompt">{asset.prompt}</p>}
        {asset.lineage && asset.lineage.length > 0 && (
          <div className="ds-lineage">
            <span className="ds-hint">Refined from</span>
            {asset.lineage.map((id) => <span key={id}>{sourceAssets.find((source) => source.id === id)?.title ?? id}</span>)}
            <span className="ds-hint">The source image is unchanged.</span>
          </div>
        )}
        {lineageJobs.length > 0 && (
          <ul className="ds-jobs">
            {lineageJobs.map((j) => <li key={j.id}>{j.task}: {j.state}. {j.note}</li>)}
          </ul>
        )}
        {note && <p className="ds-note" role="status">{note}</p>}
      </div>
      <div className="dfoot">
        <button type="button" className="btn btn-primary btn-sm" disabled={!canRefine || attaching || asset.kind !== "image"} title={canRefine ? undefined : "Image chat context is not available on this host."} onClick={() => void refine()}>{attaching ? "Attaching…" : "Refine in chat"}</button>
        <button type="button" className="btn btn-sm" disabled={!canDownload || downloading} title={canDownload ? undefined : unavailable} onClick={download}>Download original</button>
        {!published && (
          <button type="button" className="btn btn-sm" disabled={!canPublish} title={canPublish ? undefined : "Publishing is not available in this workspace."} onClick={publish}>
            Add to library
          </button>
        )}
      </div>
    </aside>
  );
}
