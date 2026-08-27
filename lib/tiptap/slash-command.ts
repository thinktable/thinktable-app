// TipTap slash command extension — opens Notion-style / menu (Media section).

import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { SlashCommandMenu, type SlashCommandMenuRef } from '@/components/slash-command-menu'
import { filterSlashCommandItems, type SlashCommandItem } from '@/lib/tiptap/slash-command-items'
import { applySlashMenuPlacement } from '@/lib/menu-placement'

const slashPluginKey = new PluginKey('slashCommand')

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        pluginKey: slashPluginKey,
        allowSpaces: false, // Space ends the menu and leaves a literal /
        startOfLine: false,
        allowedPrefixes: null, // Trigger / anywhere in text, not only after whitespace
        floatingUi: { strategy: 'fixed' as const }, // Escape RF frame transforms; clamp in viewport
        command: ({
          editor,
          range,
          props,
        }: {
          editor: import('@tiptap/core').Editor
          range: { from: number; to: number }
          props: SlashCommandItem & { language?: string }
        }) => {
          props.command({ editor, range, language: props.language })
        },
      },
    }
  },

  addProseMirrorPlugins() {
    const extension = this

    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        editor: extension.editor,
        ...extension.options.suggestion,
        items: ({ query }) => filterSlashCommandItems(query),
        render: () => {
          let component: ReactRenderer | null = null
          let unmountPopup: (() => void) | null = null
          let menuRef: SlashCommandMenuRef | null = null
          let getClientRect: (() => DOMRect | null) | null = null // Live caret from TipTap

          const place = () => {
            const el = component?.element as HTMLElement | undefined
            if (!el) return
            const rect = getClientRect?.() ?? null
            applySlashMenuPlacement(el, {
              anchor: rect
                ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
                : null,
            })
          }

          return {
            onStart: (props: SuggestionProps<SlashCommandItem, SlashCommandItem>) => {
              getClientRect = props.clientRect
              component = new ReactRenderer(SlashCommandMenu, {
                props: {
                  ...props,
                  menuRef: (ref: SlashCommandMenuRef | null) => {
                    menuRef = ref
                  },
                },
                editor: props.editor,
                className:
                  'tt-menu-surface relative z-[1001] overflow-visible rounded-lg border border-gray-200 shadow-lg dark:border-[#2f2f2f]',
              })
              component.element.style.visibility = 'hidden' // Avoid flash before first clamp
              unmountPopup = props.mount(component.element, {
                // Own left/top/maxHeight every floating-ui tick (keyboard + RF move the caret)
                onPosition: () => place(),
                autoUpdate: { animationFrame: true }, // Caret moves inside transformed RF frames
              })
              requestAnimationFrame(place) // First paint after React commits the list
            },
            onUpdate: (props: SuggestionProps<SlashCommandItem, SlashCommandItem>) => {
              getClientRect = props.clientRect
              component?.updateProps({
                ...props,
                menuRef: (ref: SlashCommandMenuRef | null) => {
                  menuRef = ref
                },
              })
              requestAnimationFrame(place) // List height changes with the query filter
            },
            onExit: () => {
              unmountPopup?.()
              unmountPopup = null
              menuRef = null
              getClientRect = null
              component?.destroy()
              component = null
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === 'Escape') return false
              return menuRef?.onKeyDown({ event: props.event }) ?? false
            },
          }
        },
      }),
    ]
  },
})
