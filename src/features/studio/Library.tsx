import { useMemo, useState } from "react";
import type { StudioActor, StudioAsset, StudioHost } from "../../host/port";
import { describeCreator, formatRelative, isMine } from "./model";
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

type Sort = "newest" | "title" | "creator";
const SCOPES: { id: LibraryScope; label: string }[] = [
  { id: "all", label: "All assets" },
  { id: "library", label: "Workspace library" },
  { id: "mine", label: "Mine" },
  { id: "drafts", label: "Drafts" },
];

function initials(name: string): string {
  if (name === "Local operator") return "OP";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts.at(-1)![0] : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}

export function Library({ assets, actor, selectedId, onSelect, onCreate, createOpen, host, canRefine, onChooseReference }: Props) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<LibraryScope>("all");
  const [kind, setKind] = useState<LibraryKind>("all");
  const [tag, setTag] = useState("all");
  const [sort, setSort] = useState<Sort>("newest");

  const counts = useMemo(() => ({
    all: assets.length,
    library: assets.filter((a) => a.lifecycle === "published").length,
    mine: assets.filter((a) => isMine(a.creator, actor)).length,
    drafts: assets.filter((a) => a.lifecycle === "draft").length,
  }), [assets, actor]);
  const tags = useMemo(() => [...new Set(assets.flatMap((a) => a.tags))].sort(), [assets]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = assets.filter((a) => {
      if (scope === "library" && a.lifecycle !== "published") return false;
      if (scope === "drafts" && a.lifecycle !== "draft") return false;
      if (scope === "mine" && !isMine(a.creator, actor)) return false;
      if (kind !== "all" && a.kind !== kind) return false;
      if (tag !== "all" && !a.tags.includes(tag)) return false;
      if (!q) return true;
      return a.title.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q));
    });
    if (sort === "title") return filtered.slice().sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "creator") return filtered.slice().sort((a, b) => describeCreator(a.creator).localeCompare(describeCreator(b.creator)));
    return filtered.slice().sort((a, b) => b.createdAt - a.createdAt);
  }, [assets, actor, kind, query, scope, sort, tag]);

  function clearFilters() {
    setQuery("");
    setScope("all");
    setKind("all");
    setTag("all");
  }

  return (
    <section className="ds-panel ds-library-panel" aria-labelledby="ds-library-heading">
      <header className="ds-library-head">
        <div>
          <p className="ds-kicker">Media workspace</p>
          <h2 id="ds-library-heading">Design Library</h2>
          <p className="ds-subtitle">
            {counts.all} assets · {counts.library} in the workspace library · {counts.drafts} drafts
          </p>
        </div>
        <div className="ds-actions">
          <button type="button" className="btn btn-sm" disabled={!canRefine} title={canRefine ? undefined : "Refine in chat is not confirmed on this host."} onClick={onChooseReference}>Refine in chat</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onCreate} aria-expanded={createOpen}>New design</button>
        </div>
      </header>

      <div className="ds-tabs" role="group" aria-label="Library scope">
        {SCOPES.map((item) => (
          <button
            key={item.id}
            type="button"
            className="ds-tab"
            aria-pressed={scope === item.id}
            disabled={item.id === "mine" && !actor}
            title={item.id === "mine" && !actor ? "The host has not identified the current user." : undefined}
            onClick={() => setScope(item.id)}
          >
            {item.label} <span className="ds-tab-count">{counts[item.id]}</span>
          </button>
        ))}
      </div>

      <div className="ds-toolbar">
        <label className="ds-search">
          <span className="sr-only">Search design library</span>
          <input
            className="field"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or tag"
            aria-label="Search design library"
          />
        </label>
        <label className="sr-only" htmlFor="ds-library-kind">Filter by kind</label>
        <select id="ds-library-kind" className="field" value={kind} onChange={(e) => setKind(e.target.value as LibraryKind)}>
          <option value="all">All kinds</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
        </select>
        <label className="sr-only" htmlFor="ds-library-sort">Sort library</label>
        <select id="ds-library-sort" className="field" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="newest">Newest first</option>
          <option value="title">Title A–Z</option>
          <option value="creator">Creator</option>
        </select>
      </div>

      {tags.length > 0 && (
        <div className="ds-tagbar" aria-label="Filter by tag">
          <span className="ds-tag-label">Tags</span>
          <button type="button" className="chip" aria-pressed={tag === "all"} onClick={() => setTag("all")}>All</button>
          {tags.map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={tag === t} onClick={() => setTag(t)}>{t}</button>
          ))}
        </div>
      )}

      <div className="ds-gallery-head">
        <p aria-live="polite">{rows.length} of {assets.length} assets</p>
        {selectedId === null && rows.length > 0 && <p>Select an asset to inspect</p>}
      </div>

      {rows.length === 0 ? (
        <div className="ds-empty ds-library-empty">
          <strong>No assets match</strong>
          <span>Clear the search or filters to see the workspace library.</span>
          <button type="button" className="btn btn-sm" onClick={clearFilters}>Clear filters</button>
        </div>
      ) : (
        <ul className="ds-library-grid" aria-label="Design assets">
          {rows.map((asset) => {
            const creator = describeCreator(asset.creator);
            return (
              <li key={asset.id}>
                <button
                  type="button"
                  className="ds-library-card"
                  aria-pressed={asset.id === selectedId}
                  aria-label={`Open ${asset.title}. ${asset.kind === "image" ? "Image" : "Video"}. ${asset.lifecycle === "published" ? "In library" : "Draft"}. ${creator}. ${formatRelative(asset.createdAt)}.${asset.tags.length ? ` Tags: ${asset.tags.join(", ")}.` : ""}`}
                  onClick={() => onSelect(asset.id)}
                >
                  <span className="ds-card-art">
                    <AssetPreview asset={asset} host={host} />
                    <span className={`ds-card-badge${asset.lifecycle === "published" ? " is-published" : ""}`}>
                      {asset.lifecycle === "published" ? "In library" : "Draft"}
                    </span>
                    <span className="ds-card-open">Open</span>
                  </span>
                  <span className="ds-card-copy">
                    <span className="ds-card-title">{asset.title}</span>
                    <span className="ds-card-byline">
                      <span className="ds-avatar" aria-hidden="true">{initials(creator)}</span>
                      <span>{creator}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatRelative(asset.createdAt)}</span>
                    </span>
                    {asset.tags.length > 0 && (
                      <span className="ds-card-tags">
                        {asset.tags.map((t) => <span key={t} className="ds-mini-tag">{t}</span>)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
