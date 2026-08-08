# Thinktable definitions (official terms)

Source of truth for product language. Code identifiers may lag (`chatPanel`, `blockGroup`, `Edge`, `Handle`, `metadata.isBlock`). New copy, comments, and CONTEXT must use these words.

When the user says **block**, they mean the TipTap line (blue wash + ⋮⋮), not the box on the page.

## Official terms

| Term | Meaning | Not this | Code today |
|---|---|---|---|
| **Page** | The canvas you pan/zoom. Nested via `conversations.metadata.parent_id`. Route `/board/{id}`. | “board”, “map”, “canvas” (in product copy) | `conversations` row |
| **Frame** | Box on a page that holds text. Resize / lock / rotate chrome. Holds **one or more blocks**. | “card”, “panel”, “map card”, “block” | RF type `chatPanel`, `metadata.isBlock` |
| **Block** | One TipTap/ProseMirror content unit inside a frame (paragraph, heading, list item, …). ⋮⋮ + `.tt-block-highlight`. | The frame / RF node | `EditorBlockRef`, `tiptap-block-handles` |
| **Thread** | Line connecting two frames. | “edge”, “arrow”, “connector” | RF `Edge`, `panel_edges` |
| **Connection point** | Knob on a frame that starts / receives a thread. | “handle”, “nodule”, “node” | RF `Handle` |

## What is not an official type

- **Block group** — not a product object. Multiple blocks in one **frame** is still a frame. RF type `blockGroup` is a legacy dashed wrapper around several frames; speak of it as frame chrome, not a “group”.
- **RF node** — React Flow canvas object (`Node`: id, type, position). Implementation only. Frames, the legacy wrapper, drawings, and shapes are all RF nodes.
- **Handle** (RF) — library name for a **connection point**. Do not use “handle” or “node” in product copy for thread ports. (⋮⋮ is a **block grip**, not a connection point.)
- **`metadata.isBlock`** — legacy flag meaning “this message is a **frame** on a page” (not flashcard/chat). It does **not** mean a TipTap block.

## Drag rules (do not repeat the ⋮⋮ bug)

- ⋮⋮ / blue wash → drag that **block** only (`nodrag` on the grip). Never start RF frame drag from ⋮⋮.
- Drag the **frame** (body / chrome) to move the box on the **page**.
- Click ⋮⋮ → block actions; drag ⋮⋮ → reorder blocks, drop into another frame, or extract onto the page as a new frame.

## Prefer in new writing

**page**, **frame**, **block**, **thread**, **connection point**.

Avoid: board/map/canvas (for the page), card/panel/map card (for the frame), block group/group (as a type), edge/arrow (for the thread), handle/nodule/node (for the connection point).
