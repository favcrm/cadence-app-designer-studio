# Cadence Designer Studio

App-owned Designer Studio implementation source. This repository is newly initialized; it is not a functioning or released app yet.

Approved outcome (workspace model, 2026-10-11): create/edit image, animate an authorized source image, durable workspace assets with creator attribution, publish to the workspace library (original bytes kept), search/reuse/original download. The workspace is the access boundary; "Mine" is a creator filter, not confidentiality. Reference the current Social Content shell/bridge/state patterns, not its business domain.

Canonical implementation proposal: `/tmp/designer-studio-plan-01a12a14/design-plans/feature-designer-studio-1.md`. Host feature: CAD-1365. Original visual concept: `/tmp/designer-studio-concept/site/`.

CSS: the host injects the `cadence-kit/1` document (`design/tokens.css`, `design/kit.css`, and the frame additions in `src/daemon/screen_kit.css`) and stamps `data-cadence-kit="cadence-kit/1"` on the frame. The app uses the kit's real classes (`.btn`, `.field`, `.seg`, `.drawer`) and `src/features/studio/studio.css` defines only `.studio` / `ds-*` layout. The stamp is a compatibility check, not authority.

Status (limited prerelease source candidate, not installed): the frame opts into `screen.v2` and `screen-media.v1` and works only with the verbs and markers the host advertises for this mount.

- Workspace catalog (`media.read`): read when the host advertises it.
- Publish to the workspace library (`media.publish`): offered only when advertised; the original bytes are kept.
- Image generation (`run.start`, `image` task): offered only when the host advertises run receipts and `run.start`.
- Original download (`media.original.download`): offered only when the host advertises original downloads.
- Edit, text-to-video and image-to-video are disabled in the app with a plain reason. Image-to-video depends on a platform contract that is not yet available (AOS-213).
- Reuse in Create is not available yet.

In a host that advertises none of these, the screen stays read-only and says so. No capability is shown as available unless the host confirms it for the current workspace.

No GitHub repository source has been pushed and no release has been created. Installed verification, creator-to-original association in a live host, and desktop/narrow QA are outstanding and are not claimed.
