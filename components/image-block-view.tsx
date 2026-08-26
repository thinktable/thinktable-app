'use client'

// React NodeView for imageBlock: empty → Upload / Embed placeholder; src set → selectable <img> + menu.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Check, Image as ImageIcon, Link2, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ImageBlockMenu,
  type ImageBlockMenuAction,
  type ImageResizePreset,
} from '@/components/image-block-menu'
import {
  cropToClipPath,
  parseImageCrop,
  removeImageBackground,
  serializeImageCrop,
  type ImageCrop,
} from '@/lib/tiptap/image-block-crop'

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 // Keep data: URLs from exploding message HTML

type CropDrag =
  | { kind: 'move'; startX: number; startY: number; start: ImageCrop }
  | { kind: 'se'; startX: number; startY: number; start: ImageCrop }

export function ImageBlockView({
  node,
  updateAttributes,
  editor,
  getPos,
}: NodeViewProps) {
  const src = (node.attrs.src as string | null) || null
  const alt = (node.attrs.alt as string) || ''
  const widthPct = Number(node.attrs.widthPct) || 100
  const hazed = !!node.attrs.hazed
  const crop = parseImageCrop(node.attrs.crop as string | null)
  const fileRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [embedOpen, setEmbedOpen] = useState(false)
  const [embedValue, setEmbedValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false) // Temporary unblur (like Hide text)
  const [cropMode, setCropMode] = useState(false)
  const [draftCrop, setDraftCrop] = useState<ImageCrop>(crop)
  const [menuAnchor, setMenuAnchor] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const cropDragRef = useRef<CropDrag | null>(null)
  const [armed, setArmed] = useState(false) // Local select + menu — survives menu focus / portaled clicks
  const armingRef = useRef(false) // Skip selectionUpdate disarm during the arm gesture

  useEffect(() => {
    if (!hazed) setRevealed(false)
  }, [hazed])

  useEffect(() => {
    if (!cropMode) setDraftCrop(crop)
  }, [crop, cropMode])

  // Drop arm when the editor selection leaves this image block
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const sync = () => {
      if (armingRef.current) return
      const pos = getPos?.()
      if (pos == null || pos < 0) return
      const { selection } = editor.state
      const onThis =
        (selection as { node?: { type: { name: string } } }).node?.type.name === 'imageBlock' &&
        selection.from === pos
      if (!onThis && armed) setArmed(false)
    }
    editor.on('selectionUpdate', sync)
    return () => {
      editor.off('selectionUpdate', sync)
    }
  }, [editor, getPos, armed])

  // Outside click dismisses the image menu + ring
  useEffect(() => {
    if (!armed) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (
        t.closest?.(
          '[data-tt-image-menu], .tt-image-block-media, .tt-image-block-crop-box, .tt-image-block-crop-toolbar'
        )
      ) {
        return
      }
      setArmed(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [armed])

  // Re-measure menu anchor while armed
  useEffect(() => {
    if (!armed || !src || cropMode) {
      setMenuAnchor(null)
      return
    }
    const measure = () => {
      const el = mediaRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return
      setMenuAnchor({ left: r.left, top: r.top, width: r.width, height: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (mediaRef.current) ro.observe(mediaRef.current)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [armed, src, cropMode, widthPct, crop])

  const selectNode = useCallback(() => {
    if (!editor || editor.isDestroyed) return
    const pos = getPos?.()
    if (pos == null || pos < 0) return
    editor.chain().focus().setNodeSelection(pos).run()
  }, [editor, getPos])

  const armImage = useCallback(() => {
    armingRef.current = true
    setArmed(true)
    selectNode()
    requestAnimationFrame(() => {
      armingRef.current = false
    })
  }, [selectNode])

  const onFile = useCallback(
    (file: File | undefined) => {
      if (!file) return
      if (!file.type.startsWith('image/')) {
        setError('Choose an image file')
        return
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setError('Image must be under 4 MB')
        return
      }
      setError(null)
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : null
        if (!dataUrl) return
        updateAttributes({
          src: dataUrl,
          alt: file.name || alt,
          crop: null,
          originalSrc: null,
          hazed: false,
        })
      }
      reader.readAsDataURL(file)
    },
    [alt, updateAttributes]
  )

  const commitEmbed = useCallback(() => {
    const next = embedValue.trim()
    if (!next) return
    try {
      const u = new URL(next)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        setError('Use an http or https link')
        return
      }
    } catch {
      setError('Paste a valid image link')
      return
    }
    setError(null)
    updateAttributes({ src: next, crop: null, originalSrc: null, hazed: false })
    setEmbedOpen(false)
    setEmbedValue('')
  }, [embedValue, updateAttributes])

  const replaceImage = useCallback(() => {
    updateAttributes({
      src: null,
      crop: null,
      originalSrc: null,
      hazed: false,
      widthPct: 100,
    })
    setEmbedOpen(false)
    setCropMode(false)
    setArmed(false)
  }, [updateAttributes])

  const handleMenuAction = useCallback(
    async (action: ImageBlockMenuAction, payload?: { widthPct?: ImageResizePreset }) => {
      if (action === 'resize' && payload?.widthPct) {
        updateAttributes({ widthPct: payload.widthPct })
        return
      }
      if (action === 'crop') {
        setCropMode(true)
        setDraftCrop(crop)
        return
      }
      if (action === 'blur') {
        updateAttributes({ hazed: !hazed })
        return
      }
      if (action === 'replace') {
        replaceImage()
        return
      }
      if (action === 'removeBackground' && src) {
        setBusy(true)
        try {
          const next = await removeImageBackground(src)
          updateAttributes({
            src: next,
            originalSrc: (node.attrs.originalSrc as string | null) || src,
          })
        } catch {
          setError('Could not remove background')
        } finally {
          setBusy(false)
        }
      }
    },
    [crop, hazed, node.attrs.originalSrc, replaceImage, src, updateAttributes]
  )

  const commitCrop = useCallback(() => {
    updateAttributes({ crop: serializeImageCrop(draftCrop) })
    setCropMode(false)
  }, [draftCrop, updateAttributes])

  const cancelCrop = useCallback(() => {
    setDraftCrop(crop)
    setCropMode(false)
  }, [crop])

  const onCropPointerDown = useCallback(
    (e: React.PointerEvent, kind: CropDrag['kind']) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      cropDragRef.current = { kind, startX: e.clientX, startY: e.clientY, start: draftCrop }
    },
    [draftCrop]
  )

  const onCropPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = cropDragRef.current
    const box = mediaRef.current?.getBoundingClientRect()
    if (!drag || !box || box.width < 1 || box.height < 1) return
    const dx = ((e.clientX - drag.startX) / box.width) * 100
    const dy = ((e.clientY - drag.startY) / box.height) * 100
    if (drag.kind === 'move') {
      setDraftCrop({
        ...drag.start,
        cx: clamp(drag.start.cx + dx, drag.start.cw / 2, 100 - drag.start.cw / 2),
        cy: clamp(drag.start.cy + dy, drag.start.ch / 2, 100 - drag.start.ch / 2),
      })
      return
    }
    setDraftCrop({
      ...drag.start,
      cw: clamp(drag.start.cw + dx * 2, 10, 100),
      ch: clamp(drag.start.ch + dy * 2, 10, 100),
    })
  }, [])

  const onCropPointerUp = useCallback(() => {
    cropDragRef.current = null
  }, [])

  const clipPath = cropToClipPath(cropMode ? draftCrop : crop)
  const showRing = armed && !!src && !cropMode
  const showMenu = armed && !!src && !!menuAnchor && !cropMode && editor?.isEditable

  return (
    <NodeViewWrapper
      as="div"
      className={cn(
        'tt-image-block group relative nodrag nokey',
        showRing && 'tt-image-block-selected',
        cropMode && 'tt-image-block-cropping'
      )}
      data-type="imageBlock"
    >
      <div className="tt-image-block-row">
        {src ? (
          <div
            ref={mediaRef}
            className={cn(
              'tt-image-block-media relative',
              showRing && 'tt-image-block-media-selected',
              cropMode && 'tt-image-block-media-crop'
            )}
            style={{ width: `${widthPct}%` }}
            onPointerDown={(e) => {
              if (cropMode) return
              if (!editor?.isEditable) return
              e.stopPropagation()
              armImage()
            }}
            onClick={(e) => {
              if (!hazed || cropMode) return
              e.stopPropagation()
              setRevealed((v) => !v)
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={src}
              alt={alt || 'Image'}
              className={cn(
                'tt-image-block-img',
                hazed && 'tt-image-block-hazed',
                hazed && revealed && 'tt-image-block-hazed-revealed'
              )}
              data-haze={hazed ? 'true' : undefined}
              style={{ clipPath }}
            />
            {busy && <div className="tt-image-block-busy" aria-hidden />}
            {cropMode &&
              createPortal(
                <div className="tt-image-block-crop-toolbar">
                  <button type="button" className="tt-image-block-crop-btn" onClick={cancelCrop}>
                    <X className="h-3.5 w-3.5" aria-hidden />
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="tt-image-block-crop-btn tt-image-block-crop-done"
                    onClick={commitCrop}
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    Done
                  </button>
                </div>,
                document.body
              )}
            {cropMode && mediaRef.current && (
              <CropBox
                host={mediaRef.current}
                crop={draftCrop}
                onMoveDown={(e) => onCropPointerDown(e, 'move')}
                onResizeDown={(e) => onCropPointerDown(e, 'se')}
                onMove={onCropPointerMove}
                onUp={onCropPointerUp}
              />
            )}
          </div>
        ) : (
          <div className="tt-image-block-placeholder">
            <ImageIcon className="h-5 w-5 text-gray-400" aria-hidden />
            <span className="tt-image-block-placeholder-label">Add an image</span>
            {embedOpen ? (
              <div className="tt-image-block-embed">
                <input
                  type="url"
                  value={embedValue}
                  onChange={(e) => setEmbedValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitEmbed()
                    }
                    e.stopPropagation()
                  }}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Paste an image link…"
                  className="tt-image-block-embed-input"
                  autoFocus
                />
                <button
                  type="button"
                  className="tt-image-block-action"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    commitEmbed()
                  }}
                >
                  Embed
                </button>
              </div>
            ) : (
              <div className="tt-image-block-actions">
                <button
                  type="button"
                  className="tt-image-block-action"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    fileRef.current?.click()
                  }}
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                  Upload
                </button>
                <button
                  type="button"
                  className="tt-image-block-action"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setEmbedOpen(true)
                    setError(null)
                  }}
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden />
                  Embed link
                </button>
              </div>
            )}
            {error && <span className="tt-image-block-error">{error}</span>}
          </div>
        )}
      </div>

      {showMenu && menuAnchor && (
        <ImageBlockMenu
          anchor={menuAnchor}
          widthPct={widthPct}
          hazed={hazed}
          onAction={handleMenuAction}
          onClose={() => setArmed(false)}
        />
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </NodeViewWrapper>
  )
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** Draggable crop box rendered in screen space over the image. */
function CropBox({
  host,
  crop,
  onMoveDown,
  onResizeDown,
  onMove,
  onUp,
}: {
  host: HTMLElement
  crop: ImageCrop
  onMoveDown: (e: React.PointerEvent) => void
  onResizeDown: (e: React.PointerEvent) => void
  onMove: (e: React.PointerEvent) => void
  onUp: (e: React.PointerEvent) => void
}) {
  const [box, setBox] = useState(host.getBoundingClientRect())
  useEffect(() => {
    const sync = () => setBox(host.getBoundingClientRect())
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(host)
    window.addEventListener('scroll', sync, true)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', sync, true)
      window.removeEventListener('resize', sync)
    }
  }, [host])

  const left = box.left + ((crop.cx - crop.cw / 2) / 100) * box.width
  const top = box.top + ((crop.cy - crop.ch / 2) / 100) * box.height
  const width = (crop.cw / 100) * box.width
  const height = (crop.ch / 100) * box.height

  return createPortal(
    <div
      className="tt-image-block-crop-box"
      style={{ left, top, width, height }}
      onPointerDown={onMoveDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <span
        className="tt-image-block-crop-handle"
        onPointerDown={(e) => {
          e.stopPropagation()
          onResizeDown(e)
        }}
      />
    </div>,
    document.body
  )
}
