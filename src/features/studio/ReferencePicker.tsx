import { useEffect, useRef, useState } from "react";
import type { StudioAsset, StudioHost } from "../../host/port";
import { AssetPreview } from "./AssetPreview";

export function ReferencePicker({ assets, host, onChoose, onClose }: {
  assets: StudioAsset[];
  host: StudioHost;
  onChoose: (asset: StudioAsset) => Promise<string | null>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ id: string; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const images = assets.filter((asset) => asset.kind === "image");
  const rows = images.filter((asset) => asset.title.toLowerCase().includes(query.trim().toLowerCase()));
  const row = rows.find((asset) => asset.id === selected?.id) ?? null;
  const stale = row !== null && selected !== null && row.revision !== selected.revision;
  const choice = stale ? null : row;

  async function choose() {
    if (!choice || busy) return;
    const owner = dialog.current;
    setBusy(true);
    setNote(null);
    const error = await onChoose(choice);
    // A closed picker cannot mutate or dismiss a later instance.
    if (dialog.current !== owner || !owner?.open) return;
    if (error) {
      setNote(error);
      setBusy(false);
    } else {
      onClose();
    }
  }

  return (
    <dialog ref={dialog} className="ds-picker" aria-labelledby="ds-reference-heading" onCancel={onClose}>
      <header className="ds-library-header">
        <h3 id="ds-reference-heading">Choose a reference</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </header>
      <p className="ds-hint">Attach an image to chat, then describe your changes. Nothing is sent or generated yet.</p>
      <label className="ds-field">
        <span>Search images</span>
        <input type="search" className="field" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
      </label>
      <ul className="ds-grid ds-picker-grid" aria-label="Reference images">
        {rows.map((asset) => (
          <li key={asset.id}>
            <button type="button" className="card tcard ds-tile" aria-pressed={selected?.id === asset.id && selected.revision === asset.revision} disabled={busy} onClick={() => setSelected({ id: asset.id, revision: asset.revision })}>
              <AssetPreview asset={asset} host={host} />
              <span>{asset.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="ds-hint">{images.length === 0 ? "No retained images to use yet." : "No images match this search."}</p>}
      {note && <p className="ds-note ds-warn" role="alert">{note}</p>}
      {stale && <p className="ds-note ds-warn" role="alert">This image changed. Select it again before attaching.</p>}
      <footer className="ds-picker-footer">
        <span className="ds-hint">{choice ? choice.title : stale ? "Select the current image" : "Select one image"}</span>
        <button type="button" className="btn btn-primary btn-sm" disabled={!choice || busy} onClick={() => void choose()}>{busy ? "Attaching…" : "Use in chat"}</button>
      </footer>
    </dialog>
  );
}
