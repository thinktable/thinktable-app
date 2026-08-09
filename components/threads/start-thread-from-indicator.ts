/**
 * @deprecated Prefer `ConnectionIndicator` — synthetic Handle mousedown was unreliable
 * (wrong class selector + elementFromPoint). Kept so old imports don't break.
 */
export function startThreadFromIndicator(
  e: { preventDefault(): void; stopPropagation(): void },
  _side: 'left' | 'right' | 'top' | 'bottom'
) {
  e.preventDefault()
  e.stopPropagation()
}
