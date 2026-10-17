---
title: Refine a retained image
goal: Keep the source image unchanged and retain one reference edit from the frozen image pin and requested changes
label: Refine image in chat
capability_slots: [image]
required_asset_slot: image
execution: host
inputs:
  library_asset_id: { ask: "Retained source image ID from the authorized chat turn" }
  library_revision: { ask: "Exact retained source revision" }
  library_sha256: { ask: "Original SHA-256 from the authorized chat turn" }
  instructions: { ask: "Requested changes to the attached image" }
---

The assistant prepares this run from one image attached to its assigned chat
turn. These fields select an image; the daemon must independently prove the
source, revision, original digest, conversation, app context and live custody.
They are never evidence of permission by themselves.

## Refine retained image
size: S
action: local.capability.call

Use the frozen `image` binding exactly once. The native reference-edit path
pins the source artifact, supported model, requested changes, current quote
and maximum before explicit host approval. Do not use a text-only generation
fallback, fabricate source facts, change the source or submit a second paid
request when the outcome is uncertain. Retain the result as a new image with
its source lineage; no external publication occurs.

### Acceptance
- [ ] the native reference edit uses the approved image pin, instructions and quote
- [ ] a new result is retained with correct lineage and the source bytes unchanged
- [ ] a refusal or uncertain outcome is reported honestly without duplicate paid dispatch
