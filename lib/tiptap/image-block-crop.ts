// Crop helpers for imageBlock — store as center + size percentages (0–100).

export type ImageCrop = {
  cx: number // Center X %
  cy: number // Center Y %
  cw: number // Width %
  ch: number // Height %
}

const DEFAULT_CROP: ImageCrop = { cx: 50, cy: 50, cw: 100, ch: 100 }

/** Parse `data-crop` ("cx,cy,cw,ch") or return the full-frame default. */
export function parseImageCrop(raw: string | null | undefined): ImageCrop {
  if (!raw) return { ...DEFAULT_CROP }
  const parts = raw.split(',').map((n) => parseFloat(n.trim()))
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return { ...DEFAULT_CROP }
  const [cx, cy, cw, ch] = parts
  return {
    cx: clamp(cx, 0, 100),
    cy: clamp(cy, 0, 100),
    cw: clamp(cw, 5, 100),
    ch: clamp(ch, 5, 100),
  }
}

/** Serialize crop for `data-crop`. */
export function serializeImageCrop(crop: ImageCrop): string {
  const c = {
    cx: clamp(crop.cx, 0, 100),
    cy: clamp(crop.cy, 0, 100),
    cw: clamp(crop.cw, 5, 100),
    ch: clamp(crop.ch, 5, 100),
  }
  return `${c.cx},${c.cy},${c.cw},${c.ch}`
}

/** True when the crop box is smaller than the full image. */
export function hasActiveCrop(crop: ImageCrop): boolean {
  return crop.cw < 99.5 || crop.ch < 99.5 || crop.cx < 49.5 || crop.cx > 50.5 || crop.cy < 49.5 || crop.cy > 50.5
}

/** CSS clip-path inset from center + size percentages. */
export function cropToClipPath(crop: ImageCrop): string {
  const left = Math.max(0, crop.cx - crop.cw / 2)
  const top = Math.max(0, crop.cy - crop.ch / 2)
  const right = Math.max(0, 100 - (crop.cx + crop.cw / 2))
  const bottom = Math.max(0, 100 - (crop.cy + crop.ch / 2))
  return `inset(${top}% ${right}% ${bottom}% ${left}% round 0.375rem)`
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Best-effort white/light background removal via canvas (returns PNG data URL). */
export async function removeImageBackground(src: string): Promise<string> {
  const img = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const corners = [
    sample(data, 0, 0),
    sample(data, canvas.width - 1, 0),
    sample(data, 0, canvas.height - 1),
    sample(data, canvas.width - 1, canvas.height - 1),
  ]
  const bg = averageColor(corners)
  const tolerance = 42
  for (let i = 0; i < data.data.length; i += 4) {
    const r = data.data[i]
    const g = data.data[i + 1]
    const b = data.data[i + 2]
    if (colorDistance(r, g, b, bg.r, bg.g, bg.b) <= tolerance) {
      data.data[i + 3] = 0
    }
  }
  ctx.putImageData(data, 0, 0)
  return canvas.toDataURL('image/png')
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = src
  })
}

function sample(data: ImageData, x: number, y: number) {
  const i = (y * data.width + x) * 4
  return { r: data.data[i], g: data.data[i + 1], b: data.data[i + 2] }
}

function averageColor(colors: { r: number; g: number; b: number }[]) {
  const n = colors.length
  return {
    r: colors.reduce((s, c) => s + c.r, 0) / n,
    g: colors.reduce((s, c) => s + c.g, 0) / n,
    b: colors.reduce((s, c) => s + c.b, 0) / n,
  }
}

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}
