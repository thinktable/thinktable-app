# Thinktable definitions (official terms)

Source of truth for product language. Code identifiers may lag (`chatPanel`, `blockGroup`, `Edge`, `Handle`, `metadata.isBlock`). New copy, comments, and CONTEXT must use these words.

When the user says **block**, they mean the TipTap line (blue wash + ⋮⋮), not the box on the board.

## Official terms

| Term | Meaning | Not this | Code today |
|---|---|---|---|
| **Board** | The canvas you pan/zoom. Nested via `conversations.metadata.parent_id`. Route `/board/{id}`. | “page”, “map”, “canvas” (in product copy) | `conversations` row |
| **Frame** | Box on a board that holds text. Resize / lock / rotate chrome. Holds **one or more blocks**. | “card”, “panel”, “map card”, “block” | RF type `chatPanel`, `metadata.isBlock` |
| **Block** | One TipTap/ProseMirror content unit inside a frame (paragraph, heading, list item, …). ⋮⋮ + `.tt-block-highlight`. | The frame / RF node | `EditorBlockRef`, `tiptap-block-handles` |
| **Thread** | Line connecting two frames. | “edge”, “arrow”, “connector” | RF `Edge`, `panel_edges` |
| **Connection point** | Knob on a frame that starts / receives a thread. | “handle”, “nodule”, “node” | RF `Handle` |

## What is not an official type

- **Block group** — not a product object. Multiple blocks in one **frame** is still a frame. RF type `blockGroup` is a legacy dashed wrapper around several frames; speak of it as frame chrome, not a “group”.
- **RF node** — React Flow canvas object (`Node`: id, type, position). Implementation only. Frames, the legacy wrapper, drawings, and shapes are all RF nodes.
- **Handle** (RF) — library name for a **connection point**. Do not use “handle” or “node” in product copy for thread ports. (⋮⋮ is a **block grip**, not a connection point.)
- **`metadata.isBlock`** — legacy flag meaning “this message is a **frame** on a board” (not flashcard/chat). It does **not** mean a TipTap block.

## Drag / selection rules (do not repeat the ⋮⋮ bug)

- Select the **frame** first — caret / text selection only after the frame is selected. Unselected: drag anywhere (including ⋮⋮) moves the frame.
- **Select** a frame on click release (not pointer-down). **Moving** shows a transient blue box only (no resize/connection/rotate chrome) and never leaves the frame selected.
- Click ⋮⋮ → select that **block** (+ actions menu). Only then does ⋮⋮ drag move that **block** (`nodrag` while armed).
- Unarmed ⋮⋮ drag (frame not selected, or block not selected via ⋮⋮ click) → drag the **frame**, not the block.
- Drag the **frame** (body / chrome) to move the box on the **board**.
- Armed ⋮⋮ drag → reorder blocks, drop into another frame, or extract onto the board as a new frame.
- Drag a **frame** until its edge snaps flush to another’s **adjust box** (both stay visible; stack line per gap on that side). Each side (top / bottom / left / right) has its own stack tree. Frames attached to a mate’s other sides nest with it when stacked (preview / Open stack show the whole pack). Snap does **not** lock. Click the line for **Open stack** / directional stack arrows (which frame the pack sits under — first Stack locks that side’s group) / **Lock**. Unlock then drag away to delink; same drag can snap to another side or frame (the edge you left stays blocked until release). Blue resize box stays upright; blocks + shape rotate inside. Hover preview is fast (~100ms).
- Frame menu → **Shape** applies a silhouette (circle, diamond, …) to that **frame**; **Default** clears it. Boards / board preview remain the deep-hierarchy tool; shapes are on-board composition.
- Clicking an unselected frame selects it only — I-bar on a later click.

## Prefer in new writing

**board**, **frame**, **block**, **thread**, **connection point**.

Avoid: page/map/canvas (for the board), card/panel/map card (for the frame), block group/group (as a type), edge/arrow (for the thread), handle/nodule/node (for the connection point).

Notion **pages** (Notion API objects) keep that name — they are not Thinktable boards.
