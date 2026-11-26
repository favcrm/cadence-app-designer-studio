# Cadence Designer Studio

App-owned Designer Studio source and independently packaged screen. Source development is distinct from an installed or operationally verified release.

Approved outcome (workspace model, 2026-10-11): create/edit image, animate an authorized source image, durable workspace assets with creator attribution, publish to the workspace library (original bytes kept), search/reuse/original download. The workspace is the access boundary; "Mine" is a creator filter, not confidentiality. Reference the current Social Content shell/bridge/state patterns, not its business domain.

Canonical implementation proposal: `/tmp/designer-studio-plan-01a12a14/design-plans/feature-designer-studio-1.md`. Host feature: CAD-1365. Original visual concept: `/tmp/designer-studio-concept/site/`.

CSS: the host injects the `cadence-kit/1` document (`design/tokens.css`, `design/kit.css`, and the frame additions in `src/daemon/screen_kit.css`) and stamps `data-cadence-kit="cadence-kit/1"` on the frame. The app uses the kit's real classes (`.btn`, `.field`, `.seg`, `.drawer`) and `src/features/studio/studio.css` defines only `.studio` / `ds-*` layout. The stamp is a compatibility check, not authority.

## Retained-image chat refinement — DSN-4 / CAD-1482 / DSN-16

The app stays on the host's `cadence-kit/1`, `screen.v2` and
`screen-media.v1` contracts. It owns the Library (with live Generating Ghost
Card progress, view-only Member workspace library presentation, and lineage
parent/result comparison), compact full-height drawers and creative brief. The
host owns chat, image custody, runtime authorization, model/price review,
approval and funded execution.

- Selecting any image opens its detail drawer where **Refine in chat** queues
  one captured asset/revision in the host composer. It does not send a message
  or generate an image.
- Authorized PNG/JPEG/WebP originals and cached JPEG previews come from retained
  host custody bytes, not provider URLs (and preview cache entries carry forward
  across publish). Unsupported hosts keep previews and reference attachment
  unavailable.
- A supported assistant receives real image content for the sent turn. A
  text-only runtime must refuse image inspection honestly; the app never changes
  a runtime/provider or treats an asset label as vision.
- The native `media.refine.prepare` action uses the exact image pin and user's
  instructions. Host approval covers the source/model/input/price; a retained new
  result links to the unchanged source. Unknown paid outcomes are never retried
  under a fresh key.

Host advertisement is required independently for catalog reads (`media.read`),
publishing (`media.publish`), generation (`run.start` plus `run_receipts: 1`),
original downloads (`media.original.download` plus `original_downloads: 1`),
previews (`media_previews: 1`) and chat references (`media.chat.attach` plus
`media_chat_references: 1`). These markers describe compatibility, not authority.
The host re-proves current authority on every native operation.

The short assistant guide and exact action descriptor are in `package/app.md`
and `package/app-assistant.json`. No separate agent or skill framework is needed.
Video, arbitrary extra model integrations, collections/deletion backend and
generic file uploads/PDF/OCR (CAD-1233) are not part of this feature.

Verify source with the admitted `pnpm run typecheck`, package with
`node scripts/package-screen.mjs`, and run the existing bridge checks against the
matching Core source. Package output is not installation evidence. Desktop and
narrow Browser QA must exercise the real compatible host/frame pair; standalone
unsupported-host checks do not establish image inspection, approval or retention.

Rollout also requires an admitted image-capable native runtime and a producer
contract that accepts retained references **and enforces the approved charge
ceiling before dispatch**. AgenticOS AOS-248/AOS-258 already provide the ceiling
contract; native reference edits additionally require the AOS-269 admission
extension, a reference-capable published model and a priced image-to-image variant.
The ceiling is not removed to make an incompatible request pass. Local
native/browser verification uses an isolated host, synthetic test identities and
a loopback producer, not a live model or paid provider. Source/package output is
not installation or operational acceptance.

## Hosted catalogue release — DSN-8

Hosted AgenticOS tenants install Designer Studio from the catalogue, not from
the native `scripts/package-release.sh` kit (that kit targets
`cadence --org local` only).

- `.github/workflows/publish.yml` runs on a plain `vX.Y.Z` tag whose commit is
  on `main`. It checks `package/` with an exact Cadence CLI (input,
  `CADENCE_TARGET_VERSION` variable, else `0.5.1`; the check must pass
  outright) and posts the exact bundle through GitHub OIDC to the catalogue
  candidates route. Only a `published`/`unchanged` receipt for this
  repository, commit, version and digest counts.
- The catalogue accepts it only because agenticos-v2 `REVIEWED_APP_PUBLISHERS`
  binds `designer-studio` to this repository, this workflow file and the
  plain-tag ref. Prerelease tags are refused.
- `.github/publisher/` holds its own locked dependency so the root
  `package.json`/`pnpm-lock.yaml` (part of the screen's provenance digest) do
  not change. CI's `publish-dry-run` job runs the same checks without OIDC.

Order: reviewed `main` → the v2 publisher binding deployed to production →
an operator pushes the tag. Tagging, installation on a tenant (owner consent),
capability binding and any paid generation are separate human decisions.
Listing is not installation.

`v*` tags are protected by two repository tag rulesets (DSN-12):
`release tags v*: create` lets only repository admins create a `v*` tag, and
`release tags v*: immutable` refuses moving, force-updating or deleting one,
with no bypass. A published version is therefore never re-pointed: fix
forward with a new version. Inspect them with
`gh api repos/favcrm/cadence-app-designer-studio/rulesets`.

### Declared host contracts — DSN-9

`app.md` declares `needs.requires.contracts: {app-screens: [1]}`, the only
contract this package uses that both the native checker (`cadence app check`,
which the publish workflow requires to pass) and the hosted tenant install
profile accept. The
screen's real host dependency, `screen-media.v1`, is not declarable yet:
native Cadence 0.5.1 refuses it as an unknown contract, so declaring it would
fail the publish check. `app-assistant` is accepted natively but is absent from
the hosted profile, so declaring it would refuse the hosted install. Add either
once both hosts list it.
