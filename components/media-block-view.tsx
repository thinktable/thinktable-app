'use client'

// React NodeView for slash Media blocks — empty placeholder with Upload / Embed.

import { useCallback, useRef, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import {
  Bookmark,
  Check,
  File as FileIcon,
  Link2,
  Music,
  Paperclip,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { looksLikeMediaUrl } from '@/lib/tiptap/create-media-block'

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 // Cap data: URLs in message HTML

type MediaKind = 'video' | 'audio' | 'file' | 'bookmark'

const KIND_META: Record<
  MediaKind,
  {
    label: string
    accept?: string
    icon: React.ReactNode
    embedLabel: string
    embedPlaceholder: string
  }
> = {
  video: {
    label: 'Video',
    accept: 'video/*',
    icon: <Video className="h-4 w-4" />,
    embedLabel: 'Embed link',
    embedPlaceholder: 'Paste video URL…',
  },
  audio: {
    label: 'Audio',
    accept: 'audio/*',
    icon: <Music className="h-4 w-4" />,
    embedLabel: 'Embed link',
    embedPlaceholder: 'Paste audio URL…',
  },
  file: {
    label: 'File',
    accept: '*/*',
    icon: <Paperclip className="h-4 w-4" />,
    embedLabel: 'Link to file',
    embedPlaceholder: 'Paste file URL…',
  },
  bookmark: {
    label: 'Web bookmark',
    icon: <Bookmark className="h-4 w-4" />,
    embedLabel: 'Page URL',
    embedPlaceholder: 'Paste page URL…',
  },
}

function kindFromType(typeName: string): MediaKind {
  if (typeName === 'videoBlock') return 'video'
  if (typeName === 'audioBlock') return 'audio'
  if (typeName === 'fileBlock') return 'file'
  return 'bookmark'
}

export function MediaBlockView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const kind = kindFromType(node.type.name)
  const meta = KIND_META[kind]
  const src = (node.attrs.src as string | null) || null
  const name = (node.attrs.name as string) || ''
  const title = (node.attrs.title as string) || ''
  const fileRef = useRef<HTMLInputElement>(null)
  const [embedOpen, setEmbedOpen] = useState(false)
  const [embedValue, setEmbedValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onFile = useCallback(
    (file: File | undefined) => {
      if (!file) return
      if (kind === 'video' && !file.type.startsWith('video/')) {
        setError('Choose a video file')
        return
      }
      if (kind === 'audio' && !file.type.startsWith('audio/')) {
        setError('Choose an audio file')
        return
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setError('File is too large (max 8 MB)')
        return
      }
      setError(null)
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result || '')
        updateAttributes({
          src: dataUrl,
          name: file.name,
          title: kind === 'bookmark' ? file.name : title,
        })
      }
      reader.onerror = () => setError('Could not read file')
      reader.readAsDataURL(file)
    },
    [kind, title, updateAttributes]
  )

  const onEmbed = useCallback(() => {
    const url = embedValue.trim()
    if (!looksLikeMediaUrl(url)) {
      setError('Enter a valid http(s) URL')
      return
    }
    setError(null)
    updateAttributes({
      src: url,
      title: kind === 'bookmark' ? title || url : title,
      name: name || url.split('/').pop() || '',
    })
    setEmbedOpen(false)
    setEmbedValue('')
  }, [embedValue, kind, name, title, updateAttributes])

  const displayTitle = title || name || src || ''

  return (
    <NodeViewWrapper as="div" className="tt-media-block my-1">
      {src ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-[#2f2f2f] dark:bg-[#1a1a1a]">
          {kind === 'video' && (
            <video src={src} controls className="max-h-80 w-full rounded-md bg-black" />
          )}
          {kind === 'audio' && <audio src={src} controls className="w-full" />}
          {kind === 'file' && (
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              <FileIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">{displayTitle || 'Download file'}</span>
            </a>
          )}
          {kind === 'bookmark' && (
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              <Bookmark className="h-4 w-4 shrink-0" />
              <span className="truncate">{displayTitle || src}</span>
            </a>
          )}
        </div>
      ) : (
        <div
          className="rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-3 py-2 dark:border-[#2f2f2f] dark:bg-[#1a1a1a]/60"
          contentEditable={false}
        >
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            {meta.icon}
            <span>{meta.label}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {kind !== 'bookmark' && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept={meta.accept}
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-[#2a2a2a]"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload
                </button>
              </>
            )}
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-[#2a2a2a]"
              onClick={() => {
                setEmbedOpen((v) => !v)
                setError(null)
              }}
            >
              <Link2 className="h-3.5 w-3.5" />
              {kind === 'bookmark' ? 'Embed link' : 'Embed'}
            </button>
          </div>
          {embedOpen && (
            <div className="mt-2 flex items-center gap-1">
              <input
                value={embedValue}
                onChange={(e) => setEmbedValue(e.target.value)}
                placeholder={meta.embedPlaceholder}
                className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs outline-none dark:border-[#3a3a3a] dark:bg-[#2a2a2a] dark:text-gray-100"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onEmbed()
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setEmbedOpen(false)
                  }
                }}
              />
              <button
                type="button"
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]"
                onClick={onEmbed}
                aria-label="Confirm"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]"
                onClick={() => setEmbedOpen(false)}
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        </div>
      )}
    </NodeViewWrapper>
  )
}
