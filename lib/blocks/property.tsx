// Frame property metadata — Turn into → Property sets `metadata.propertyType` on the host frame.
// The frame then shows a property-type icon at the top (mirrors Notion connections at the bottom).

import type { ReactNode } from 'react'
import {
  AlignJustify,
  ArrowUpRight,
  AtSign,
  Calendar,
  CircleChevronDown,
  CircleDashed,
  CircleUser,
  Clock,
  Hash,
  Link2,
  List,
  MapPin,
  MousePointerClick,
  Paperclip,
  Phone,
  Search,
  Sigma,
  SquareCheck,
  Users,
} from 'lucide-react'

/** Height of the top property strip (`h-7`) — keep text aligned when the strip appears. */
export const PROPERTY_GROUP_H = 28

/** Notion-like property kinds (Turn into → Property pane). */
export type PropertyTypeId =
  | 'text'
  | 'number'
  | 'select'
  | 'multiSelect'
  | 'status'
  | 'date'
  | 'person'
  | 'files'
  | 'checkbox'
  | 'url'
  | 'phone'
  | 'email'
  | 'relation'
  | 'rollup'
  | 'formula'
  | 'button'
  | 'uniqueId'
  | 'place'
  | 'createdTime'
  | 'lastEditedTime'
  | 'createdBy'
  | 'lastEditedBy'
  | 'googleDriveFile'
  | 'figmaFile'
  | 'zendeskTicket'

const PROPERTY_TYPE_IDS: ReadonlySet<string> = new Set([
  'text',
  'number',
  'select',
  'multiSelect',
  'status',
  'date',
  'person',
  'files',
  'checkbox',
  'url',
  'phone',
  'email',
  'relation',
  'rollup',
  'formula',
  'button',
  'uniqueId',
  'place',
  'createdTime',
  'lastEditedTime',
  'createdBy',
  'lastEditedBy',
  'googleDriveFile',
  'figmaFile',
  'zendeskTicket',
])

/** True when `value` is a known PropertyTypeId. */
export function isPropertyTypeId(value: unknown): value is PropertyTypeId {
  return typeof value === 'string' && PROPERTY_TYPE_IDS.has(value)
}

/** Read `metadata.propertyType` from a frame message, or null. */
export function readFramePropertyType(
  meta?: Record<string, unknown> | null
): PropertyTypeId | null {
  if (!meta) return null
  return isPropertyTypeId(meta.propertyType) ? meta.propertyType : null
}

/** Human label for a property type (menus + titles). */
export function propertyTypeLabel(type: PropertyTypeId): string {
  const map: Record<PropertyTypeId, string> = {
    text: 'Text',
    number: 'Number',
    select: 'Select',
    multiSelect: 'Multi-select',
    status: 'Status',
    date: 'Date',
    person: 'Person',
    files: 'Files & media',
    checkbox: 'Checkbox',
    url: 'URL',
    phone: 'Phone',
    email: 'Email',
    relation: 'Relation',
    rollup: 'Rollup',
    formula: 'Formula',
    button: 'Button',
    uniqueId: 'ID',
    place: 'Place',
    createdTime: 'Created time',
    lastEditedTime: 'Last edited time',
    createdBy: 'Created by',
    lastEditedBy: 'Last edited by',
    googleDriveFile: 'Google Drive File',
    figmaFile: 'Figma File',
    zendeskTicket: 'Zendesk Ticket',
  }
  return map[type]
}

/** Glyph for the frame’s top property chrome (and menus that import this helper). */
export function propertyTypeIcon(type: PropertyTypeId, className = 'h-4 w-4'): ReactNode {
  const cn = className
  switch (type) {
    case 'text':
      return <AlignJustify className={cn} aria-hidden />
    case 'number':
      return <Hash className={cn} aria-hidden />
    case 'select':
      return <CircleChevronDown className={cn} aria-hidden />
    case 'multiSelect':
      return <List className={cn} aria-hidden />
    case 'status':
      return <CircleDashed className={cn} aria-hidden />
    case 'date':
      return <Calendar className={cn} aria-hidden />
    case 'person':
      return <Users className={cn} aria-hidden />
    case 'files':
      return <Paperclip className={cn} aria-hidden />
    case 'checkbox':
      return <SquareCheck className={cn} aria-hidden />
    case 'url':
      return <Link2 className={cn} aria-hidden />
    case 'phone':
      return <Phone className={cn} aria-hidden />
    case 'email':
      return <AtSign className={cn} aria-hidden />
    case 'relation':
      return <ArrowUpRight className={cn} aria-hidden />
    case 'rollup':
      return <Search className={cn} aria-hidden />
    case 'formula':
      return <Sigma className={cn} aria-hidden />
    case 'button':
      return <MousePointerClick className={cn} aria-hidden />
    case 'uniqueId':
      return <span className="text-[11px] font-semibold leading-none" aria-hidden>№</span>
    case 'place':
      return <MapPin className={cn} aria-hidden />
    case 'createdTime':
    case 'lastEditedTime':
      return <Clock className={cn} aria-hidden />
    case 'createdBy':
    case 'lastEditedBy':
      return <CircleUser className={cn} aria-hidden />
    case 'googleDriveFile':
      return (
        <svg viewBox="0 0 24 24" className={cn} aria-hidden>
          <path fill="#3777E3" d="M8.2 3.2h7.6L22 15.4h-7.6z" />
          <path fill="#FFBA00" d="M8.2 3.2 1.2 15.4h7.6L15.8 3.2z" />
          <path fill="#26A65B" d="M1.2 15.4 5 21.2h14l-3.8-5.8z" />
        </svg>
      )
    case 'figmaFile':
      return (
        <svg viewBox="0 0 24 24" className={cn} aria-hidden>
          <path fill="#F24E1E" d="M8.5 3h3.5v6H8.5a3 3 0 0 1 0-6z" />
          <path fill="#FF7262" d="M12 3h3.5a3 3 0 1 1 0 6H12z" />
          <path fill="#A259FF" d="M8.5 9H12v6H8.5a3 3 0 0 1 0-6z" />
          <path fill="#1ABCFE" d="M12 9h3.5a3 3 0 1 1-3.5 3z" />
          <path fill="#0ACF83" d="M8.5 15H12a3 3 0 1 1-3-3" />
        </svg>
      )
    case 'zendeskTicket':
      return (
        <svg viewBox="0 0 24 24" className={cn} aria-hidden>
          <path
            fill="#03363D"
            d="M12.2 3.2c.5 2.2 2.8 5 7.6 6.1-4.2.9-6.9 3.8-7.6 11.5-.5-2.2-2.8-5-7.6-6.1 4.2-.9 6.9-3.8 7.6-11.5z"
          />
        </svg>
      )
  }
}
