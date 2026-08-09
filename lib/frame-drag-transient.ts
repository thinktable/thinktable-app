// Frame selection is click-to-select (mouseup), not mousedown — so a drag never leaves a frame selected.
// Marquee (user selection rect) is allowed through; RF mousedown select on chatPanel is blocked.

let marqueeArmed = false // True after the user has drawn a selection rect (until the next changes batch)

/** Call while RF `userSelectionActive` so the following select changes are allowed. */
export function armMarqueeFrameSelect() {
  marqueeArmed = true
}

/** Whether this select:true may apply to a frame (marquee batch). Consumed after the batch. */
export function isMarqueeFrameSelectArmed(): boolean {
  return marqueeArmed
}

/** Clear after a changes batch that was allowed for marquee. */
export function clearMarqueeFrameSelect() {
  marqueeArmed = false
}
