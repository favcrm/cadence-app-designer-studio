import { useEffect, useState } from "react";
import type { StudioAsset, StudioHost } from "../../host/port";

// Cache successful preview data URLs per host instance and exact asset revision
// so switching Library scope tabs or opening Detail/ReferencePicker does not
// re-read identical base64 bytes over the host's serialized preview queue.
const previewCache = new WeakMap<StudioHost, Map<string, string>>();

function cachedPreview(host: StudioHost, key: string): string | undefined {
  return previewCache.get(host)?.get(key);
}

function storePreview(host: StudioHost, key: string, url: string): void {
  let map = previewCache.get(host);
  if (!map) {
    map = new Map();
    previewCache.set(host, map);
  }
  map.set(key, url);
}

/** The host returns authorized image content, never a remotely fetchable URL. */
export function AssetPreview({ asset, host }: { asset: StudioAsset; host: StudioHost }) {
  const key = `${asset.id}:${asset.revision}`;
  const initialUrl = asset.kind === "image" ? cachedPreview(host, key) : undefined;
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(() =>
    initialUrl ? { key, url: initialUrl } : null,
  );
  useEffect(() => {
    let current = true;
    if (asset.kind === "image") {
      const hit = cachedPreview(host, key);
      if (hit) {
        setLoaded({ key, url: hit });
        return () => { current = false; };
      }
      void host.preview(asset.id, asset.revision).then(
        (url) => {
          if (url) storePreview(host, key, url);
          if (current) setLoaded({ key, url });
        },
        () => { if (current) setLoaded({ key, url: null }); },
      );
    }
    return () => { current = false; };
  }, [host, asset.id, asset.revision, asset.kind, key]);

  const image = loaded?.key === key ? loaded : initialUrl ? { key, url: initialUrl } : null;
  return (
    <span className="ds-asset-preview">
      {image?.url ? (
        <img src={image.url} alt={asset.title} loading="lazy" />
      ) : (
        <span className="ds-hint">{asset.kind !== "image" ? "Video" : image ? "Preview unavailable" : "Loading image…"}</span>
      )}
    </span>
  );
}
