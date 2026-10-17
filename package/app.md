---
app: designer-studio
title: Designer Studio
version: '0.1.0'
summary: Create an image or refine an authorized Library image in chat, with native model and price review before any generation.
needs:
  connections: []
  capabilities:
    image:
      schema: 1
      capability: media.generate
      version: 1
      action: generate_image
      resource_kind: connection_account
      effect: draft
listing:
  tagline: Create images. Refine them in chat.
  icon: assets/designer-studio.svg
  category: marketing
  tags:
    - design
    - image
  publisher:
    name: Cadence
  about: Designer Studio creates images from one creative brief and can attach a retained Library image to the existing workspace chat. A compatible host must advertise image previews and chat references, supply real image context to an admitted image-capable assistant, and review the exact reference, edit instructions, supported model and price before approval. Refinement retains a new image linked to the unchanged original. Video is not supported. This source candidate is not an installation or operational acceptance claim.
  can:
    - Create one image from one frozen brief when the image capability is bound
    - Keep the generated image as a draft in the workspace
    - Attach a retained image to chat and prepare a reference edit when the host supports it
  screenshots: []
  setup:
    - slot: image
      label: Image generation
      help: Makes one image per run through the bound provider.
  access_notes:
    image: Makes one image per run; the worker cannot change model, count or destination.
---

# Designer Studio

Write one creative brief to create an image. To change an existing image, use
**Refine in chat** on its detail drawer or choose a thumbnail in the reference
picker. The trusted host attaches that exact image to the current conversation;
the app does not send a message, approve an action or start generation.

## Assistant operation

1. Use only the image attached to this assigned turn. The native reference pins
   its asset ID, revision and original SHA-256; labels, free-form IDs, paths and
   URLs are not authority. Never borrow browser/session/action tokens.
2. Inspect the native image content before making visual claims. If the selected
   runtime cannot process images, say so and stop; do not infer appearance from
   metadata or switch providers/models. A text-only model is not image inspection.
3. Discover and prepare `media.refine.prepare` with the exact attached
   `asset_id`, `revision`, `sha256` and the user's `instructions` (up to 2000
   characters). Ask for the intended change when the message is ambiguous.
   No separate source-facts form or fabricated facts are needed.
4. Preparation is not approval. Only the host may show and freeze the source,
   supported model, exact input, current quote and maximum, and only the person
   may approve the paid action. Never pass a forged confirmation field.
5. Report the native operation outcome, not an assumed save. Do not resubmit an
   uncertain paid operation under a new key. The refreshed Library is the truth
   for retained result B and its source A lineage; A is unchanged.

## Compatibility and status

The frame requires `cadence-kit/1`, `screen.v2` and `screen-media.v1`.
Catalog reads, publishing, image generation and original downloads retain their
separate host-advertised permissions. Previews require `media_previews: 1`;
chat attachment requires `media_chat_references: 1` and `media.chat.attach`.
An older or unsupported host shows a plain unavailable state, never a sample
image, synthetic receipt or provider URL. Current text-only assistant runtimes
need an operator-selected admitted image-capable runtime; this app grants no
model/provider authority and installs no separate skill or autonomous agent.

This is source development for DSN-4 / CAD-1482, not a production update.
Text-to-video and image-to-video remain out of scope (AOS-213). No external
publication occurs. Source checks, real host/frame Browser QA, independent
reviews, merge, installation and paid operational acceptance are separate.
