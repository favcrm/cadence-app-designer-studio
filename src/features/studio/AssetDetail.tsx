import { useEffect, useRef, useState } from "react";
import type { Receipt, StudioAsset, StudioHost, StudioJob } from "../../host/port";
import { describeCreator, formatAbsolute, formatRelative } from "./model";
import { AssetPreview, promotePreviewCache } from "./AssetPreview";
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
  onRefine: (asset: StudioAsset) => Promise<string | null | undefined>;
  onSelectAsset?: (asset: StudioAsset) => void;
  /** In-frame only: the board drawer owns its own close control. */
  onClose?: () => void;
  /** `inframe`: the app's own panel (fallback). `host`: rendered inside the
   *  board's drawer, which supplies the panel, scrim and close control. */
  chrome?: "inframe" | "host";
}

function formatFormatLine(asset: StudioAsset): string | null {
  const mime = asset.mediaType
    ? asset.mediaType === "image/png"
      ? "PNG"
      : asset.mediaType === "image/jpeg"
        ? "JPEG"
        : asset.mediaType === "image/webp"
          ? "WebP"
          : asset.mediaType
    : null;
  const size =
    typeof asset.sizeBytes === "number" && asset.sizeBytes > 0
      ? asset.sizeBytes >= 1024 * 1024
        ? `${(asset.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(asset.sizeBytes / 1024))} KB`
      : null;
  if (mime && size) return `${mime} · ${size}`;
  return mime ?? size;
}

/** Asset drawer built from the kit's own .drawer frame primitives. Publishing
 *  curates this same asset into the workspace library: the original bytes and
 *  id are unchanged, and the host checks the revision and the viewer's mutation
 *  role before it applies. */
export function AssetDetail({
  asset,
  canPublish,
  canDownload,
  canRefine,
  sourceAssets,
  lineageJobs,
  host,
  onRefine,
  onSelectAsset,
  onClose,
  chrome = "inframe",
}: Props) {
  const [note, setNote] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [compareMode, setCompareMode] = useState<"result" | "source" | "side">("result");
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const published = asset.lifecycle === "published";
  const unavailable = "This is not available here yet.";
  const memberReadOnly = !canPublish && !canRefine;
  const parentId = asset.lineage?.[0] ?? null;
  const parentAsset = parentId ? sourceAssets.find((source) => source.id === parentId) ?? null : null;
  const formatLine = formatFormatLine(asset);

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
        case "confirmed":
          promotePreviewCache(host, asset.id, asset.revision, r.revision);
          return "Added to the workspace library. The original file is unchanged.";
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
    setNote(null);
    const error = await onRefine(asset);
    if (!alive.current) return;
    setAttaching(false);
    // Success needs no banner: the chat composer shows the attached image.
    if (error) setNote(error);
  }

  const relative = formatRelative(asset.createdAt);
  const relativeInline = relative === "Just now" || relative === "Yesterday" ? relative.toLowerCase() : relative;
  const created = `${formatAbsolute(asset.createdAt)} (${relativeInline})`;
  const subtitle = `${published ? "In workspace library" : "Draft"} · created ${relativeInline}`;
  const body = (
    <>
      {parentAsset && (
        <div className="ds-compare-tabs" role="group" aria-label="Compare with source image">
          <button type="button" className="chip" aria-pressed={compareMode === "result"} onClick={() => setCompareMode("result")}>Result</button>
          <button type="button" className="chip" aria-pressed={compareMode === "source"} onClick={() => setCompareMode("source")}>Source</button>
          <button type="button" className="chip" aria-pressed={compareMode === "side"} onClick={() => setCompareMode("side")}>Side-by-side</button>
        </div>
      )}
      {parentAsset && compareMode === "side" ? (
        <div className="ds-compare-grid">
          <figure className="ds-compare-figure">
            <AssetPreview asset={parentAsset} host={host} />
            <figcaption>Source</figcaption>
          </figure>
          <figure className="ds-compare-figure">
            <AssetPreview asset={asset} host={host} />
            <figcaption>Result</figcaption>
          </figure>
        </div>
      ) : parentAsset && compareMode === "source" ? (
        <AssetPreview asset={parentAsset} host={host} />
      ) : (
        <AssetPreview asset={asset} host={host} />
      )}
      <dl className="ds-meta-list">
        <dt>Status</dt>
        <dd><span className={`ds-status${published ? " is-published" : ""}`}>{published ? "In workspace library" : "Draft — only in this workspace's drafts"}</span></dd>
        <dt>Type</dt>
        <dd>{asset.kind === "image" ? "Image" : "Video"}</dd>
        {formatLine && (<><dt>Format</dt><dd>{formatLine}</dd></>)}
        <dt>Created by</dt>
        <dd>{describeCreator(asset.creator)}</dd>
        <dt>Created</dt>
        <dd>{created}</dd>
        {asset.model && (<><dt>Model</dt><dd>{asset.model}</dd></>)}
      </dl>
      {asset.tags.length > 0 && (
        <div className="ds-detail-tags" aria-label="Tags">
          {asset.tags.map((tag) => <span key={tag} className="chip">{tag}</span>)}
        </div>
      )}
      {asset.prompt && (
        <section className="ds-detail-section" aria-label="Brief">
          <h4>Brief</h4>
          <blockquote className="ds-quote">{asset.prompt}</blockquote>
        </section>
      )}
      {asset.lineage && asset.lineage.length > 0 && (
        <section className="ds-detail-section" aria-label="Refined from">
          <h4>Refined from</h4>
          {asset.lineage.map((id) => {
            const source = sourceAssets.find((item) => item.id === id) ?? null;
            return source && onSelectAsset ? (
              <p key={id} className="ds-lineage-item">
                <button type="button" className="lnk ds-lineage-link" onClick={() => onSelectAsset(source)}>
                  {source.title}
                </button>
              </p>
            ) : (
              <p key={id} className="ds-lineage-item">{source?.title ?? id}</p>
            );
          })}
          <p className="ds-hint">The source image is unchanged.</p>
        </section>
      )}
      {lineageJobs.length > 0 && (
        <ul className="ds-jobs">
          {lineageJobs.map((j) => <li key={j.id}>{j.task}: {j.state}. {j.note}</li>)}
        </ul>
      )}
      {note && <p className="ds-note" role="status">{note}</p>}
    </>
  );
  const actions = (
    <>
      <button type="button" className="btn btn-sm" disabled={!canDownload || downloading} title={canDownload ? undefined : unavailable} onClick={download}>{downloading ? "Starting download…" : "Download original"}</button>
      {!memberReadOnly && (
        <button type="button" className="btn btn-sm" disabled={!canRefine || attaching || asset.kind !== "image"} title={canRefine ? undefined : "Refine in chat is not confirmed on this host."} onClick={() => void refine()}>{attaching ? "Attaching…" : "Refine in chat"}</button>
      )}
      <span className="ds-grow" />
      {!memberReadOnly && !published && (
        <button type="button" className="btn btn-primary btn-sm" disabled={!canPublish} title={canPublish ? undefined : "Publishing is not available in this workspace."} onClick={publish}>
          Add to workspace library
        </button>
      )}
    </>
  );

  if (chrome === "host") {
    return (
      <section className="ds-host-detail" aria-labelledby="ds-asset-heading">
        <header className="ds-host-detail-head">
          <h2 id="ds-asset-heading">{asset.title}</h2>
          <p>{subtitle}</p>
        </header>
        <div className="ds-host-detail-body">{body}</div>
        <footer className="ds-host-detail-foot">{actions}</footer>
      </section>
    );
  }

  return (
    <aside className="drawer ds-drawer" aria-labelledby="ds-asset-heading">
      <header className="dhead">
        <div className="ds-drawer-title">
          <h3 id="ds-asset-heading">{asset.title}</h3>
          <p>{subtitle}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close asset details">Close</button>
      </header>
      <div className="dbody ds-drawer-body">{body}</div>
      <div className="dfoot">{actions}</div>
    </aside>
  );
}
