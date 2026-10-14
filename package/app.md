---
app: designer-studio
title: Designer Studio
version: '0.1.0'
summary: Create one image from a frozen brief via the bound image capability when the host confirms it. Limited prerelease; not installed.
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
  tagline: Create one image from a frozen brief
  icon: assets/designer-studio.svg
  category: marketing
  tags:
    - design
    - image
  publisher:
    name: Cadence
  about: Designer Studio turns one operator-written brief into one generated image through the bound image capability. Image generation, workspace library publishing and original download run only when the host advertises them for this workspace; otherwise they stay unavailable with a plain reason. Edit, text-to-video and image-to-video are disabled. This package is a limited prerelease source candidate. Nothing is posted or released.
  can:
    - Create one image from one frozen brief when the image capability is bound
    - Keep the generated image as a draft in the workspace
  screenshots: []
  setup:
    - slot: image
      label: Image generation
      help: Makes one image per run through the bound provider.
  access_notes:
    image: Makes one image per run; the worker cannot change model, count or destination.
---

# Designer Studio

One image run per brief. The operator writes a subject and one line of
source facts, and may add optional image guidance. The run freezes those
values, then the host calls the bound `image` capability once with an
empty input object. The provider receipt and the retained image are the
only outputs. No caption, review, publication or external post is made.

## Status

This is a limited prerelease source candidate for the installable package.
It is not an installed product and not feature acceptance. The studio
screen works only with what the host advertises for the current mount:
the workspace catalog, library publishing, image generation and original
download are each offered only when confirmed; otherwise the screen stays
read-only and says why. The tool alias `image.generate` maps to the
`image` slot only and is invoked through the host's run slot when it is
advertised. Edit, text-to-video and image-to-video are disabled. Reuse in
Create is not available yet. Image-to-video needs a platform contract that
is not yet available (AOS-213).
