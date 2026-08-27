// Slash-command media blocks — video, audio, file, web bookmark.

import { createMediaBlock } from '@/lib/tiptap/create-media-block'

export const VideoBlock = createMediaBlock({
  name: 'videoBlock',
  kind: 'video',
  dataType: 'videoBlock',
  className: 'tt-video-block',
})

export const AudioBlock = createMediaBlock({
  name: 'audioBlock',
  kind: 'audio',
  dataType: 'audioBlock',
  className: 'tt-audio-block',
})

export const FileBlock = createMediaBlock({
  name: 'fileBlock',
  kind: 'file',
  dataType: 'fileBlock',
  className: 'tt-file-block',
})

export const BookmarkBlock = createMediaBlock({
  name: 'bookmarkBlock',
  kind: 'bookmark',
  dataType: 'bookmarkBlock',
  className: 'tt-bookmark-block',
})
