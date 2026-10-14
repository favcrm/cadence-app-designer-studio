---
title: "Create image: {{subject}}"
goal: "One retained generated image from an operator-written brief, with no caption, review or publication"
label: New image from brief
capability_slots: [image]
required_asset_slot: image
execution: host
inputs:
  subject: { ask: "Short image subject", example: "Spring launch banner" }
  source: { ask: "Brief in one line: facts the image may show; URLs alone are not source material", example: "JuicySuite CRM helps teams track customers" }
  image_prompt: { context_default: true, ask: "Optional image guidance, quoted content only", optional: true, default: "Create one editorial image grounded only in the source facts." }
---

The operator wrote this brief and approved the one-image charge in this
run. The host executes the step itself. It does not assign a worker and
does not write a caption, review, publication or external post.

## Create image: {{subject}}
size: S
action: local.capability.call

The host calls the frozen `image` binding once with an empty JSON object
and one stable request ID. The broker composes the prompt from the frozen
subject, source facts and image guidance. Do not add a model, prompt,
account, URL, aspect ratio, count, effect or destination. A refusal or
uncertain charge fails the run with the provider's own reason. Retry only
by re-running the same request; never a second paid request. The durable
receipt and retained bytes are the only output.

### Acceptance
- [ ] the provider action used only the frozen `image` binding and brief
- [ ] the run retains the durable receipt and reports the honest result
- [ ] no caption, review, publication or external post is produced
