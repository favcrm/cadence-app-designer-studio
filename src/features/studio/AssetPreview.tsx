import { useEffect, useState } from "react";
import type { StudioAsset, StudioHost } from "../../host/port";

/** The host returns authorized image content, never a remotely fetchable URL. */
export function AssetPreview({ asset, host }: { asset: StudioAsset; host: StudioHost }) {
  const key = `${asset.id}:${asset.revision}`;
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null);
  useEffect(() => {
    let current = true;
    if (asset.kind === "image") {
      void host.preview(asset.id, asset.revision).then(
        (url) => { if (current) setLoaded({ key, url }); },
        () => { if (current) setLoaded({ key, url: null }); },
      );
    }
    return () => { current = false; };
  }, [host, asset.id, asset.revision, asset.kind, key]);

  const image = loaded?.key === key ? loaded : null;
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
