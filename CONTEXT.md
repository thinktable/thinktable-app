# Thinktable — Architecture Context

Official product terms: **`DEFINITIONS.md`**.

## Product north star

Thinktable is a spatial mind-map on **pages** (see `DEFINITIONS.md`):

1. **Keeps first-class local content** — frames (boxes holding TipTap blocks), pages (titled frames with their own page), chat panels, flashcards, and drawings work without Notion (current behavior remains).
2. **Optionally connects Notion** — users OAuth-connect their workspace (Mindmap.so-style), pick pages, map them on the board, edit on-site, and sync both ways.
3. **Exposes an MCP server** — external AIs (Cursor, Claude, etc.) can create/edit mind maps via tools, using the user’s Thinktable account (and optional Notion connection).

## Ownership split

| Concern | Source of truth |
|---|---|
| Page / frame **content** (when Notion-linked) | Notion (bidirectional sync via API) |
| Spatial **layout**, threads, page metadata | Thinktable |
| Local-only frames (no Notion link) | Thinktable only |

## Auth / Notion connect (MVP)

- Public Notion OAuth connection (`owner=user`).
- Capabilities: read + insert + update content; view workspace users (as needed).
- Redirect: `{SITE_URL}/api/notion/callback`.
- Tokens stored in `notion_connections` (service-role access only; not exposed to browser).
- Top bar **Notion** button starts connect / shows connected state (same OAuth UX Notion hosts — workspace picker → permissions → select pages).
- After connect / **Import pages**: opens a Mindmap.so-style picker with Notion **tree** (nested pages), search, **Add frame** (Notion page **body** as TipTap blocks in **one frame** + title chip; `notionPageId` for sync), and **Generate mindmap** (selected page + descendants — each as one content frame). Also creates nested Thinktable pages in the nav (linked via `linkedPageId` / `sourceBlockMessageId`, with a page-body frame of the same content).

## MCP (next phase)

- Per-user API keys / OAuth for MCP clients.
- Tools: list maps, create/link nodes, import Notion page, update page content, set layout.
- MCP writes go through Thinktable APIs; Notion writes use the stored connection when the node is Notion-linked.

## Non-goals (for this slice)

- Full Notion editor parity on day one.
- Replacing local notes with Notion-only.
- Marketplace listing / Notion security review (later for public distribution).

## Key env vars

- `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` — public connection OAuth.
- `NEXT_PUBLIC_SITE_URL` — redirect base (local: `http://localhost:3031`).
- Existing Supabase + OpenAI vars unchanged.

### Notion Developer portal setup (one-time)

1. Open [Notion Developer connections](https://www.notion.so/developers/connections) → create **Public connection**.
2. Capabilities: Read content, Update content, Insert content; user info as needed.
3. Redirect URI: `http://localhost:3031/api/notion/callback` (add prod URL later).
4. Copy OAuth client id + secret into `.env.local` as `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET`.
5. Restart `npm run dev`. Top bar **Notion** button starts the hosted OAuth UI (workspace → permissions → select pages).

## Naming

Official terms live in **`DEFINITIONS.md`**. Short form:

| Official | Meaning | Code today |
|---|---|---|
| **Page** | The canvas (`/board/{id}`) | `conversations` |
| **Frame** | Box holding text (one or more **blocks**) | RF `chatPanel`, `metadata.isBlock` |
| **Block** | TipTap line + ⋮⋮ (not the box) | `EditorBlockRef`, `tiptap-block-handles` |
| **Thread** | Line between frames | RF `Edge`, `panel_edges` |
| **Connection point** | Knob that starts/receives a thread | RF `Handle` |

No “block group” type — multiple blocks in a frame is still a frame. RF `blockGroup` is legacy wrapper chrome. `metadata.isBlock` means **frame**, not TipTap block. ⋮⋮ drag = that **block** only.

## Implementation notes

- Board UI top bar: `components/sticky-prompt-panel.tsx` → logo + truncated board title (or **ancestor / … / page** path when nested; hover a segment for same-level sibling menu, click opens that page) + `components/editor-toolbar.tsx` (no bottom border; bar width = map column only; zoom % is not in the top bar). Home/Insert/Draw/View pill + hide pill (`input-area-with-sticky-prompt.tsx`) stay **centered on the map/edit-bar column**.
- Board nav: former left `AppSidebar` is a **rounded top-left hover popup** opened from the top-bar logo (`sidebar-context` open/scheduleClose). **Pages** (formerly “boards”) nest via `conversations.metadata.parent_id`; drag onto another page (center zone) to nest. Each page has a clickable **icon** (`metadata.icon`: emoji/image, else blank `File` / filled `FileText` when `hasContent`). Notion imports create **child pages** under the current page (with Notion icons) and note cards on the map.
- Right **chat sidebar** (`components/chat-sidebar.tsx`): Notion-like AI panel (header title + actions, empty-state body, bottom composer); **hidden by default**; toggled by brand logo beside the minimap/nav toggle (`isChatSidebarOpen`). When open, **sibling column** (`CHAT_SIDEBAR_WIDTH`) shrinks the map/top-bar column; flows call `useChatSidebarViewportAdjust` so zoom scales by `newWidth/oldWidth` (same relative framing). Close via header chevrons (`ChevronsRight`).
- Chat empty state shows **Thinktable brand mark**; hover reveals **Personalize** (Notion-style). Opens sample modal (`components/personalize-ai-modal.tsx`) to pick a **topper** overlaid on the logo. Selection lives in `sidebar-context` (`topperId`) + `localStorage` (`thinktable-ai-topper`) so the **map chat-open icon** shows the same topper. Custom assets: drop files in `/public/toppers/` and set `src` on entries in `SAMPLE_TOPPERS`.
- TipTap text selection on chat panels: Notion-style format popup (`components/selection-format-popup.tsx` → `SelectionFormatPopupAnchor`) — `position:fixed` portal; **1 line** → at end of highlight; **multi-line** → right of panel/item edge → left of panel/item edge → end of text. **Hide text** toggles TipTap `haze` mark (`lib/tiptap/haze.ts`); click hazed span adds temporary `tt-haze-revealed` (blur clears until blur/click-away). Page items are a **single text body** (plain-merge legacy prompt+response; no top/bottom sections or collapse).
- Empty **page** left-click (no frame selected) places an **I-bar + ⋮⋮ grip** at the click (`board-flow` `iBarPosition`) — not an Item/Flashcard menu. Type to create a **frame** at that point, or click the grip to spawn an empty frame immediately (`createBlockAtFlowPosition`); both use `metadata.position` + `fadeIn` (auto-focus). Deselect click does not place the I-bar; Escape dismisses. Double-click also places the I-bar. Flashcards stay on the Insert toolbar.
- TipTap **block grips** (`tiptap-block-handles`): show when the pointer’s **Y is inside that block’s vertical band anywhere across the full frame** (`findEditorBlockAtClientY` on `.react-flow__node` mousemove — not only over the text/gutter). Also show for the **focused/caret block**. Grip stays clickable because X no longer clears hover. **Align:** top of the block (not vertically centered). Measure block DOM via `getBoundingClientRect` ÷ RF viewport scale so `position:absolute` top is local CSS px. Re-measure on TipTap `transaction` + `ResizeObserver`. **⋮⋮ drag moves that block only** (`nodrag` — never the host frame): click → actions menu; drag → dashed drop line (same-frame reorder or drop into another frame’s editor) or onto empty page → new **frame** (`htmlForEditorRange` + `newBlockMetadata`) and the source range is deleted.
- **Frame default chrome**: Unstyled frames use **fully transparent fill + border** (no card shadow, no `backdrop-blur`). Blur/frost only when a fill color is set. View toolbar defaults match (`fillColor`/`borderColor` empty). Custom colors still come from message metadata / View controls.
- **Frame typing width**: Unresized frames use `width: max-content` + `height: fit-content` with ProseMirror `data-single-line` nowrap so the **frame hugs content** and a block runs until **Enter**. RF node `width`/`height`/`style` sync from the panel box (ResizeObserver) so selection/resize chrome matches. Corner-drag sets `isUserResized` + persisted `resizeDimensions` (wrap in fixed box).
- **Frame typing sync**: Do not treat `metadata.blockType` as “always accept remote content” (every frame has `blockType: 'text'`). Force-sync only when `blockType` changes (Turn into). Panel rebuild `messagesKey` is id+role only — never content — so saves/realtime don’t remount TipTap mid-keystroke.
- **Frame vs page**: A **frame** is flagged `metadata.isBlock` (load migrates legacy `isNote` / `isItem` → `isBlock` via `lib/blocks.ts` — one-shot, no dual-read). Selecting an untitled frame shows **Add a title** on the edge (`components/block-title-edge.tsx`, mid-top default, draggable via `titleEdgeT`). Titling promotes to a **page**: child `conversations` (`parent_id` + `sourceBlockMessageId`), message gets `blockTitle` + `linkedPageId` (dual-write keeps menu rename ↔ frame title in sync). If the frame already has content, that content is materialized as a **page-body frame** on the new page (`metadata.isPageBody`, via `ensurePageBodyBlock`); empty pages stay empty until content exists. Opening a page also ensures the page-body frame when the source frame has content. Title chip: **preview** (`AppWindow`) opens an in-frame **iframe** to `/embed/{linkedPageId}` (lean layout — no Pages sidebar; `BoardFlow` `embedded` — no minimap/Free-nav/chat chrome). Nested RF inside a host frame cannot pan/zoom (host `nopan`); the iframe is a separate document so preview pan/zoom works. Hover/open warms the embed; the **whole preview shell** (chrome + iframe) is portaled to `document.body` and screen-synced to an in-frame spacer (`z-index: 5` — above map content, below top bar / minimap / nav / brand at `z-10+`). Sync uses **layout size + CSS `scale(hostZoom)`** so host zoom doesn’t change the iframe’s internal resolution / re-`fitView` nested frames every frame. `PREVIEW_RESIZE_MESSAGE` with `fit: true` only on open/layout-size change; otherwise pane metrics only. Chrome drag moves the host frame; expand/close on chrome. While preview is open: body editor and edge title chip are hidden; title is on the preview chrome. Veil clears on `PREVIEW_READY_MESSAGE`. Embed fetch skips homepage probe + `ensurePageBodyBlock`, reuses message cache, no poll. Drag the preview **chrome bar** (or frame body above) to move the host frame; the iframe itself is `nodrag`. Click chrome to style via host View toolbar (`PreviewFocusProvider` → `postMessage` `PREVIEW_STYLE_MESSAGE`). **Expand** navigates to `/board/{linkedPageId}`. Page-body frames show the page title only (no nested preview/open). Embed wraps `BoardEmbedProvider` so preview isn’t offered again inside. Delete frame → delete linked page; delete page → demote frame (clear title/link, keep body). Untitled frames are page-only (not in Pages menu).
- **Frame selection chrome** (selected frames): **connected blue rectangle** (`NodeResizeControl` line variant on top/right/bottom/left) meeting **4 white circular corner** handles (not the rounded card border) + **solid dark mid-side connection points** **outside** the rectangle (`±14px` via CSS `!important` + matching `Handle` style; drag thread uses `PointerConnectionLine` so the free end tracks the cursor) + bottom-left chrome: **RotateCw** (`metadata.rotation`; Shift snaps 15°) · **Lock** (only if the frame has content) · **ChevronDown / ChevronUp** when unlocked overflow / expanded. Hover shows chrome even when unselected. CSS in `globals.css` under `.react-flow__node-chatPanel`.
- **Frame lock**: Default **locked** (`metadata.frameUnlocked: false`). Locked + content → **proportional resize only** (`keepAspectRatio` + `frameScale`) and the frame **hugs scaled text** (`resizeDimensions` = intrinsic × `frameScale` + border; padding lives **inside** the scaled wrapper + layout spacer so CSS `scale` still occupies space). Relock snaps to that box. Typing while locked+resized re-hugs. Unlock keeps **current visual size** (`frameScale` unchanged; snapshot `resizeDimensions`). Unlocked: free resize; if frame < scaled content, **inner overflow hidden** + **ChevronDown** expands to content; arrow flips to **ChevronUp** and restores `collapsedFrameSize`. Persist `frameUnlocked`, `frameScale`, `resizeDimensions`, `collapsedFrameSize`. Block line-height stays **1.7** (height-based line-height broke lock-to-text).
- **Blocks vs frames**: A **frame** is a box on a **page**. A **block** is a TipTap unit inside the frame’s editor. The ⋮⋮ grip is on each **block** (`components/tiptap-block-handles.tsx`), not on the frame. Hover a line → grip in the left gutter; click → blue wash on **that** block + actions menu; drag → that block only (dashed insert marker). Turn into runs TipTap commands on the selected block (`lib/tiptap/block-selection.ts`); Page / Page in still promote the host **frame** (`lib/blocks/turn-into.ts`). Multiple blocks in one frame is still a frame (no “block group” type). RF `blockGroup` is a legacy dashed wrapper around several frames (`draggable: false`; membership `metadata.blockGroupId`; page-absolute positions). Move via the **dashed padding ring**. Drag a **frame** (not ⋮⋮) onto the wrapper ~20% overlap to attach, off onto the page to detach; empty wrappers delete. Wrapper `pointer-events: none` + ring `auto`. Wrapper `zIndex: 0`, frames `1`. Drop-target highlight via `className: drop-target`.
- Placeholder preview: disabled — `usePlaceholderManager` only strips leftover ghost “+” nodes/edges; none are created.
- Minimap + Free nav + chat brand toggle render **outside** `<ReactFlow>` as `absolute` children of the BoardFlow root (same containing box as the flashcard `LeftVerticalMenu`) so they don’t sit on RF’s late-sized box. Still under `ReactFlowProvider` so MiniMap/`NavZoomControl` keep store access. BoardFlow root is `absolute inset-0`. Left/bottom insets 8px; brand right 12px. Zoom % in nav (`nav-zoom-control.tsx`). Linear toggle removed.
- **`<ReactFlow>` must fill via `position:absolute; inset:0`** (not just `height:100%`). Percentage height collapses here (same reason embed uses the `useStoreApi` force-size hack), leaving the pane + dotted `<Background>` covering only the top of the map while nodes/chrome still paint lower (bottom looked un-navigable / “missing dots”). Insets give a definite full-height box; root is always positioned so this fills correctly for both board and embed.
- View board background defaults to **college** rule + **dotted** style (`boardRule`/`boardStyle` in `react-flow-context`).
- React Flow attribution hidden via `proOptions={{ hideAttribution: true }}` on board/project/study-set flows (Pro license by launch).
- Notion connect UI entry: top-bar Notion button (right section, near Share).
- Local content paths stay unchanged when no Notion connection / node is unlinked.

## React Flow Pro examples vault

Local copies live in `React Flow copy/*.zip` (xyflow Pro license — integrate into app, do not redistribute as standalone examples). Some are also extracted at repo root (`*-pro-example/`) or already adapted under `components/`.

### Already in Thinktable

| Example | App location | Notes |
|---|---|---|
| remove-attribution | `proOptions` on flows | Done |
| undo-redo | `components/use-undo-redo.ts` + `react-flow-context` | Wired into board |
| helper-lines | `components/helper-lines/` | Snap guides while dragging |
| freehand-draw | `components/freehand/` | Draw mode → freehand nodes |
| shapes | `components/shapes/` | SVG shape nodes |
| dynamic-layouting | `components/dynamic-layouting/` | Placeholders currently stripped (disabled) |
| selection-grouping / parent-child | `lib/blocks.ts` + `blockGroup` node | Group/ungroup via `parentId` + `blockGroupId` (Pro patterns, custom persistence) |

### Available in vault (not yet / partially used)

| Zip | Key API | Thinktable fit |
|---|---|---|
| **copy-paste-pro-example** | `useCopyPaste` | High — map-level cut/copy/paste of selected blocks + edges (pair with undo-redo); careful with TipTap native clipboard |
| **selection-grouping-pro-example** | `SelectedNodesToolbar`, group/`parentId` | Refine multi-select group toolbar / detach UX |
| **parent-child-relation-pro-example** | `useNodeDragHandlers`, `useDetachNodes` | Drop-onto-group attach + detach toolbar |
| **editable-edge-pro-example** | `EditableEdge` + control points (catmull-rom/step/…) | Freely routable mind-map edges |
| **expand-collapse-pro-example** | `useExpandCollapse` + dagre | Collapse page/subtree branches on the map |
| **auto-layout-pro-example** | `useAutoLayout` (dagre / d3-hierarchy / elk) | “Arrange” / Notion Generate mindmap layout |
| **force-layout-pro-example** | `useForceLayout` (d3-force) | Organic cluster layout option |
| **node-position-animation-pro-example** | `useAnimatedNodes` (d3-timer) | Smooth transitions after auto-layout |
| **collaborative-pro-example** | Yjs + zustand slices + cursors | Multiplayer boards (later; needs real y-websocket) |
| **server-side-image-creation-pro-example** | RF SSR + Express screenshot | OG/share previews of boards |
| **workflow-editor-pro-example** | Next.js + RF UI + ELK + context menus | Pattern ref for sidebar DnD, edge buttons, run controls |
| **ai-workflow-editor-pro-example** | Same + Vercel AI SDK nodes | Pattern ref for AI node processors (less core to mind maps) |

When adopting: copy hooks/components from the zip (or extracted `*-pro-example/`), adapt to message/`metadata` persistence, and keep Pro LICENSE notices. Prefer unzipping on demand over committing full example apps.
