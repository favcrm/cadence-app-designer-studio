---
app: designer-studio
title: Designer Studio
version: '0.1.7'
summary: Create images from a brief, track live generation progress, compare lineage, and refine selected images in chat.
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
  about: Designer Studio creates one image per creative brief through the bound image capability. Before any paid run, the host shows the model and price and asks you to approve it. Results appear in the Design Library with live generation progress, previews, original download, and parent/result comparison. Selecting an image lets owners attach it to workspace chat to request a reference edit. Video is not supported.
  can:
    - Create one image from one brief when the image capability is bound
    - Track live generation progress and browse drafts or published assets
    - Preview, download originals, compare lineage, and attach images to chat
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
      summary: 依創意簡報建立圖像，追蹤即時生成進度、比對修訂譜系，並在對話中精修所選圖像。
      about: 設計工作室透過已綁定的圖像功能，每份創意簡報建立一張圖像。任何付費執行前，主機都會先顯示模型與價格並請求核准。結果會顯示即時進度並以草稿形式保留在設計圖庫，提供預覽、原始檔下載與來源比對。選取圖庫圖像即可將其附加到對話進行參考編輯；工作區成員可檢視與下載已發佈至工作區圖庫的項目。不支援影片。
      can:
        - 綁定圖像功能後，依一份簡報建立一張圖像
        - 即時追蹤生成進度，在設計圖庫瀏覽草稿與已發佈資產
        - 預覽與下載原始檔、比對譜系，並將所選圖像附加至對話
      access_notes:
        image: 每次執行產生一張圖像；執行代理無法變更模型、數量或目的地。
---

# Designer Studio

Write one creative brief to create an image. Select any image in the Design
Library and click **Refine in chat** on its detail drawer to attach that exact
image to the workspace conversation; the app does not send a message, approve
an action or start generation.

## Assistant operation

1. Use only the image attached to this assigned turn. The native reference pins
   its asset ID, revision and original SHA-256; labels, free-form IDs, paths and
   URLs are not authority. Never borrow browser/session/action tokens.
2. Inspect the native image content before making visual claims. If the selected
   runtime cannot process images, say so and stop; do not infer appearance from
   metadata or switch providers/models. A text-only model is not image inspection.
3. Discover and prepare `media.refine.prepare` with the exact attached
   `asset_id`, `revision`, `sha256` (PNG, JPEG, or WebP) and the user's
   `instructions` (up to 2000 characters). Ask for the intended change when the
   message is ambiguous. No separate source-facts form or fabricated facts are
   needed.
4. Preparation is not approval. Only the host may show and freeze the source,
   supported model, exact input, current quote and maximum, and only the person
   may approve the paid action. Never pass a forged confirmation field.
5. Report the native operation outcome, not an assumed save. Do not resubmit an
   uncertain paid operation under a new key. The refreshed Library is the truth
   for retained result B and its source A lineage; A is unchanged.

## Compatibility and status

The frame requires `cadence-kit/1`, `screen.v2`, `screen-media.v1` and
`screen-surfaces.v1` (with in-frame drawer fallback). Catalog reads, publishing,
image generation and original downloads retain their separate host-advertised
permissions. Workspace members with `media.read` may browse, preview and
download published library assets in view-only mode without write or paid
generation controls. Previews require `media_previews: 1`; chat attachment
requires `media_chat_references: 1` and `media.chat.attach`. Text-to-video and
image-to-video remain out of scope (AOS-213). No external publication occurs.
