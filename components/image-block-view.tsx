'use client'

// React NodeView for imageBlock: empty → Upload / Embed placeholder; src set → <img>.
// Local files become data: URLs so they persist in the frame HTML until storage exists.

import { useCallback, useRef, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Image as ImageIcon, Link2, Upload } from 'lucide-react' // Placeholder + action icons
import { cn } from '@/lib/utils'

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 // Keep data: URLs from exploding message HTML

export function ImageBlockView({ node, updateAttributes, selected }: NodeViewProps) {
  const src = (node.attrs.src as string | null) || null // Empty → placeholder
  const alt = (node.attrs.alt as string) || '' // Optional alt text
  const fileRef = useRef<HTMLInputElement>(null) // Hidden file picker
  const [embedOpen, setEmbedOpen] = useState(false) // Show the URL field
  const [embedValue, setEmbedValue] = useState('') // Draft embed URL
  const [error, setError] = useState<string | null>(null) // Upload / embed failure copy

  // File → data URL stored on the node (survives reload via message HTML)
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
        updateAttributes({ src: dataUrl, alt: file.name || alt }) // Persist into the frame HTML
      }
      reader.readAsDataURL(file)
    },
    [alt, updateAttributes]
  )

  // Embed an http(s) image URL
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
    updateAttributes({ src: next })
    setEmbedOpen(false)
    setEmbedValue('')
  }, [embedValue, updateAttributes])

  return (
    <NodeViewWrapper
      as="div"
      className={cn(
        'tt-image-block group relative nodrag nokey', // nodrag: RF must not steal picker clicks
        selected && 'tt-image-block-selected'
      )}
      data-type="imageBlock"
    >
      {/* First-line band the ⋮⋮ grip measures (same idea as databaseBlock header) */}
      <div className="tt-image-block-row">
        {src ? (
          <div className="tt-image-block-media relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- user-provided src, not a static asset */}
            <img src={src} alt={alt || 'Image'} className="tt-image-block-img" />
            <button
              type="button"
              className="tt-image-block-replace"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                updateAttributes({ src: null }) // Back to placeholder so they can pick another
                setEmbedOpen(false)
              }}
            >
              Replace
            </button>
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
                    e.stopPropagation() // Don’t let TipTap / RF eat Enter
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
                    fileRef.current?.click() // Open the hidden file picker
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
                    setEmbedOpen(true) // Swap actions for a URL field
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
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0])
          e.target.value = '' // Allow picking the same file again
        }}
      />
    </NodeViewWrapper>
  )
}
