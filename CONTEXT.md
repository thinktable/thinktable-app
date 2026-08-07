# Thinktable — Architecture Context

## Product north star

Thinktable is a spatial mind-map / board product that:

1. **Keeps first-class local content** — notes, chat panels, flashcards, drawings, and boards work without Notion (current behavior remains).
2. **Optionally connects Notion** — users OAuth-connect their workspace (Mindmap.so-style), pick pages, map them on the board, edit on-site, and sync both ways.
3. **Exposes an MCP server** — external AIs (Cursor, Claude, etc.) can create/edit mind maps via tools, using the user’s Thinktable account (and optional Notion connection).

## Ownership split

| Concern | Source of truth |
|---|---|
| Page / note **content** (when Notion-linked) | Notion (bidirectional sync via API) |
| Spatial **layout**, edges, board metadata | Thinktable |
| Local-only nodes (no Notion link) | Thinktable only |

## Auth / Notion connect (MVP)

- Public Notion OAuth connection (`owner=user`).
- Capabilities: read + insert + update content; view workspace users (as needed).
- Redirect: `{SITE_URL}/api/notion/callback`.
- Tokens stored in `notion_connections` (service-role access only; not exposed to browser).
- Top bar **Notion** button starts connect / shows connected state (same OAuth UX Notion hosts — workspace picker → permissions → select pages).
- After connect / **Import pages to board**: opens a Mindmap.so-style picker with Notion **tree** (nested pages), search, **Add as card** (title only), and **Generate mindmap** (selected page + descendants as title nodes). Note metadata stores `notionPageId` for later sync.

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

## Implementation notes

- Board UI top bar: `components/sticky-prompt-panel.tsx` → logo + truncated board title (or **ancestor / … / page** path when nested; hover a segment for same-level sibling menu, click opens that page) + `components/editor-toolbar.tsx` (no bottom border; bar width = map column only). Home/Insert/Draw/View pill + hide pill (`input-area-with-sticky-prompt.tsx`) stay **centered on the map/edit-bar column**.
- Board nav: former left `AppSidebar` is a **rounded top-left hover popup** opened from the top-bar logo (`sidebar-context` open/scheduleClose). **Pages** (formerly “boards”) nest via `conversations.metadata.parent_id`; drag onto another page (center zone) to nest. Each page has a clickable **icon** (`metadata.icon`: emoji/image, else blank `File` / filled `FileText` when `hasContent`). Notion imports create **child pages** under the current page (with Notion icons) and note cards on the map.
- Right **chat sidebar** (`components/chat-sidebar.tsx`): Notion-like AI panel (header title + actions, empty-state body, bottom composer); **hidden by default**; toggled by brand logo beside the minimap/nav toggle (`isChatSidebarOpen`). When open, **sibling column** (`CHAT_SIDEBAR_WIDTH`) shrinks the map/top-bar column; flows call `useChatSidebarViewportAdjust` so zoom scales by `newWidth/oldWidth` (same relative framing). Close via header chevrons (`ChevronsRight`).
- Chat empty state shows **Thinktable brand mark**; hover reveals **Personalize** (Notion-style). Opens sample modal (`components/personalize-ai-modal.tsx`) to pick a **topper** overlaid on the logo. Selection lives in `sidebar-context` (`topperId`) + `localStorage` (`thinktable-ai-topper`) so the **map chat-open icon** shows the same topper. Custom assets: drop files in `/public/toppers/` and set `src` on entries in `SAMPLE_TOPPERS`.
- TipTap text selection on chat panels: Notion-style format popup (`components/selection-format-popup.tsx` → `SelectionFormatPopupAnchor`) — `position:fixed` portal; **1 line** → at end of highlight; **multi-line** → right of panel/item edge → left of panel/item edge → end of text. **Hide text** toggles TipTap `haze` mark (`lib/tiptap/haze.ts`); click hazed span adds temporary `tt-haze-revealed` (blur clears until blur/click-away). Page items are a **single text body** (plain-merge legacy prompt+response; no top/bottom sections or collapse).
- Empty board/canvas **left-click** (no panel selected) opens an **add item** menu at the click (`board-flow` `addItemMenu`) with Note / Flashcard; items spawn at click flow coords via `metadata.position`. Deselect click does not open the menu; Escape / outside click dismisses. Double-click still places the I-bar for type-to-create notes.
- Placeholder preview: disabled — `usePlaceholderManager` only strips leftover ghost “+” nodes/edges; none are created.
- Minimap + Linear/Free nav toggle sit on the **bottom-left** of the map; the **chat sidebar toggle logo** (with topper) stays on the **bottom-right** of the map column; the **flashcard study menu** (`left-vertical-menu.tsx`) + its open/close pill sit **centered at the bottom** of the map.
- React Flow attribution hidden via `proOptions={{ hideAttribution: true }}` on board/project/study-set flows (Pro license by launch).
- Notion connect UI entry: top-bar Notion button (right section, near Share).
- Local content paths stay unchanged when no Notion connection / node is unlinked.
