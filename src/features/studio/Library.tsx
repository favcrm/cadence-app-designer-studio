import { useMemo, useState } from "react";
import type { StudioActor, StudioAsset, StudioHost } from "../../host/port";
import { describeCreator, isMine, lifecycleLabel } from "./model";
import type { LibraryKind, LibraryScope } from "./types";
import { AssetPreview } from "./AssetPreview";

interface Props {
  assets: StudioAsset[];
  actor: StudioActor | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  createOpen: boolean;
  host: StudioHost;
  canRefine: boolean;
  onChooseReference: () => void;
}

export function Library({ assets, actor, selectedId, onSelect, onCreate, createOpen, host, canRefine, onChooseReference }: Props) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<LibraryScope>("workspace");
  const [kind, setKind] = useState<LibraryKind>("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (scope === "library" && a.lifecycle !== "published") return false;
      if (scope === "mine" && !isMine(a.creator, actor)) return false;
      if (kind !== "all" && a.kind !== kind) return false;
      if (!q) return true;
      return a.title.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q));
    });
  }, [assets, actor, query, scope, kind]);

  return (
    <section aria-labelledby="ds-library-heading" className="ds-panel">
      <header className="ds-library-header">
        <h2 id="ds-library-heading">Library</h2>
        <div className="ds-actions">
          <button type="button" className="btn btn-sm" disabled={!canRefine} title={canRefine ? undefined : "Image chat context is not available on this host."} onClick={onChooseReference}>Refine in chat</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onCreate} aria-expanded={createOpen}>New creation</button>
        </div>
      </header>
      <div className="ds-row">
        <label className="ds-field">
          <span>Search</span>
          <input className="field" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label className="ds-field">
          <span>Show</span>
          <select className="field" value={scope} onChange={(e) => setScope(e.target.value as LibraryScope)}>
            <option value="workspace">Workspace assets</option>
            <option value="library">Workspace library</option>
            <option value="mine" disabled={!actor}>{actor ? "Mine" : "Mine (unavailable: current user unknown)"}</option>
          </select>
        </label>
        <label className="ds-field">
          <span>Kind</span>
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value as LibraryKind)}>
            <option value="all">All</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
          </select>
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="empty ds-empty">No assets match. Saved assets appear here once the host confirms them.</p>
      ) : (
        <ul className="ds-grid">
          {rows.map((a) => (
            <li key={a.id}>
              <button type="button" className="card tcard ds-tile" aria-pressed={a.id === selectedId} onClick={() => onSelect(a.id)}>
                <AssetPreview asset={a} host={host} />
                <span className="ds-kind">{a.kind}</span>
                <span>{a.title}</span>
                <span className="ds-meta">{describeCreator(a.creator)} · {lifecycleLabel(a)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
