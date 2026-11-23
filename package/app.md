---
app: designer-studio
title: Designer Studio
version: '0.1.6'
summary: Create images from a brief and keep them in a workspace Design Library. Refining a Library image in chat needs host support.
needs:
  connections: []
  requires:
    contracts:
      app-screens: [1]
  capabilities:
    image:
      schema: 1
      capability: media.generate
      version: 1
      action: generate_image
      resource_kind: connection_account
      effect: draft
listing:
  tagline: Create images from a brief.
  icon: assets/designer-studio.svg
  category: marketing
  tags:
    - design
    - image
  publisher:
    name: Cadence
  about: Designer Studio creates one image per creative brief through the bound image capability. Before any paid run, the host shows the price and asks you to approve it. Results are kept as drafts in the workspace Design Library, with previews and original download. Refine in chat attaches a Library image to the workspace chat; sending it to the assistant and running a reference edit need host support, and on hosts without it the image can be attached but not sent. Video is not supported.
  can:
    - Create one image from one brief when the image capability is bound
    - Keep generated images as drafts in the Design Library, with previews and original download
    - Attach a Library image to chat for refinement where the host supports it
  screenshots: []
  setup:
    - slot: image
      label: Image generation
      help: Makes one image per run through the bound provider.
  access_notes:
    image: Makes one image per run; the worker cannot change model, count or destination.
  i18n:
    zh-TW:
      title: 設計工作室
      tagline: 依創意簡報建立圖像。
      summary: 依創意簡報建立圖像，並保留在工作區設計圖庫中。在對話中精修圖庫圖像需要主機支援。
      about: 設計工作室透過已綁定的圖像功能，每份創意簡報建立一張圖像。任何付費執行前，主機都會先顯示價格並請求核准。結果以草稿形式保留在工作區設計圖庫，可預覽及下載原始檔。「Refine in chat」（在對話中精修）會將圖庫圖像附加到工作區對話；將圖像傳送給助理並執行參考編輯需要主機支援，在不支援的主機上，圖像可以附加但無法傳送。不支援影片。
      can:
        - 綁定圖像功能後，依一份簡報建立一張圖像
        - 將產生的圖像以草稿形式保留在設計圖庫，可預覽及下載原始檔
        - 在主機支援時，將圖庫圖像附加到對話以進行精修
      access_notes:
        image: 每次執行產生一張圖像；執行代理無法變更模型、數量或目的地。
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

Opening an image asks the board for its own drawer (`screen-surfaces.v1`); a host
without it shows the same details in the app's panel. New design stays in the
app's frame so an open paid run is never forgotten when a drawer closes.

Hosted AgenticOS status (checked 2026-11-23): the host accepts the chat
attach but refuses to send a message carrying it (`media_refs`, AOS-716), does
not expose `app-assistant.json` actions such as `media.refine.prepare`, and
shows the price but not the model on its approve control (AOS-713). Refine in
chat therefore stops at the attached image there. Create, Library previews and
original download work. Text-to-video and image-to-video remain out of scope
(AOS-213). No external publication occurs.
