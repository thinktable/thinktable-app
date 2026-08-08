'use client'

// Zoom % control for the bottom nav menu (moved from the top-bar editor toolbar)
import { useEffect, useRef, useState } from 'react'
import { useReactFlow } from 'reactflow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export function NavZoomControl({ className }: { className?: string }) {
  const reactFlowInstance = useReactFlow() // RF instance for get/set viewport
  const [zoom, setZoom] = useState(1) // Current zoom (1 = 100%)
  const [isEditingZoom, setIsEditingZoom] = useState(false) // Inline % edit active
  const [zoomEditValue, setZoomEditValue] = useState('100') // Draft string while editing
  const zoomInputRef = useRef<HTMLInputElement>(null) // Focus target for inline edit
  const [menuOpen, setMenuOpen] = useState(false) // Preset menu open state

  // Keep display in sync with viewport; snap near-100% to exactly 100%
  useEffect(() => {
    const updateZoom = () => {
      if (isEditingZoom) return // Don't overwrite while typing
      const currentZoom = reactFlowInstance.getViewport().zoom
      if (currentZoom >= 0.98 && currentZoom <= 1.02 && currentZoom !== 1) {
        const viewport = reactFlowInstance.getViewport()
        reactFlowInstance.setViewport({ ...viewport, zoom: 1 })
        setZoom(1)
        setZoomEditValue('100')
      } else {
        setZoom(currentZoom)
        setZoomEditValue(Math.round(currentZoom * 100).toString())
      }
    }
    updateZoom()
    const interval = setInterval(updateZoom, 100)
    return () => clearInterval(interval)
  }, [reactFlowInstance, isEditingZoom])

  const handleZoomInputFocus = () => {
    setIsEditingZoom(true) // Swap button for input
    setMenuOpen(false) // Close presets while editing
    setZoomEditValue(Math.round(zoom * 100).toString())
    setTimeout(() => zoomInputRef.current?.select(), 0)
  }

  const handleZoomInputBlur = () => {
    setIsEditingZoom(false)
    const numericValue = parseFloat(zoomEditValue)
    if (!isNaN(numericValue)) {
      const newZoom = Math.max(0.1, Math.min(2, numericValue / 100)) // Clamp 10%–200%
      const viewport = reactFlowInstance.getViewport()
      reactFlowInstance.setViewport({ ...viewport, zoom: newZoom })
      setZoom(newZoom)
      setZoomEditValue(Math.round(newZoom * 100).toString())
    } else {
      setZoomEditValue(Math.round(zoom * 100).toString()) // Revert invalid
    }
  }

  const handleZoomInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') zoomInputRef.current?.blur()
    if (e.key === 'Escape') {
      setZoomEditValue(Math.round(zoom * 100).toString())
      zoomInputRef.current?.blur()
    }
  }

  const handleZoomChange = (zoomValue: number | 'fit') => {
    if (zoomValue === 'fit') {
      // Fit content into the map, accounting for top bar + prompt box
      const topBar = document.querySelector('[class*="bg-white"][class*="shadow-sm"][class*="border-b"]') as HTMLElement
      const inputBox = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]')?.closest('[class*="pointer-events-auto"]') as HTMLElement
      const reactFlowElement = document.querySelector('.react-flow') as HTMLElement

      let topPadding = 0
      let bottomPadding = 0
      if (topBar && reactFlowElement) {
        const topBarHeight = topBar.offsetHeight
        const reactFlowHeight = reactFlowElement.offsetHeight
        if (topBarHeight > 0) topPadding = topBarHeight / reactFlowHeight
      }
      if (inputBox && reactFlowElement) {
        const inputBoxRect = inputBox.getBoundingClientRect()
        const reactFlowRect = reactFlowElement.getBoundingClientRect()
        const inputBoxHeight = reactFlowRect.bottom - inputBoxRect.top + 16
        const reactFlowHeight = reactFlowElement.offsetHeight
        if (inputBoxHeight > 0 && inputBoxHeight < reactFlowHeight) {
          bottomPadding = inputBoxHeight / reactFlowHeight
        }
      }

      const uiPadding = Math.max(topPadding, bottomPadding, 0.05)
      const nodes = reactFlowInstance.getNodes()
      if (nodes.length === 0) {
        reactFlowInstance.fitView({ padding: uiPadding, minZoom: 0.1, maxZoom: 1, duration: 300 })
        return
      }

      const panelWidth = 768
      const panelHeight = 400
      const minX = Math.min(...nodes.map((n) => n.position.x))
      const maxX = Math.max(...nodes.map((n) => n.position.x + panelWidth))
      const minY = Math.min(...nodes.map((n) => n.position.y))
      const maxY = Math.max(...nodes.map((n) => n.position.y + panelHeight))
      const contentWidth = maxX - minX
      const contentHeight = maxY - minY
      const contentCenterX = minX + contentWidth / 2
      const contentCenterY = minY + contentHeight / 2
      const reactFlowWidth = reactFlowElement?.clientWidth || 0
      const reactFlowHeight = reactFlowElement?.clientHeight || 0
      if (reactFlowWidth === 0 || reactFlowHeight === 0) {
        reactFlowInstance.fitView({ padding: uiPadding, minZoom: 0.1, maxZoom: 1, duration: 300 })
        return
      }

      const availableWidth = reactFlowWidth * (1 - uiPadding * 2)
      const availableHeight = reactFlowHeight * (1 - uiPadding * 2)
      let calculatedZoom = Math.min(availableWidth / contentWidth, availableHeight / contentHeight)
      calculatedZoom = Math.max(0.3, Math.min(1, calculatedZoom)) // Free mode min 30%, cap 100%
      const targetViewportY = reactFlowHeight / 2 - contentCenterY * calculatedZoom

      window.dispatchEvent(new CustomEvent('fit-view-start'))
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const currentInputBox = document.querySelector('textarea[placeholder*="Type"], textarea[placeholder*="message"]')?.closest('[class*="pointer-events-auto"]') as HTMLElement
          const currentReactFlowElement = document.querySelector('.react-flow') as HTMLElement
          if (currentInputBox && currentReactFlowElement) {
            const inputBoxRect = currentInputBox.getBoundingClientRect()
            const reactFlowRect = currentReactFlowElement.getBoundingClientRect()
            const promptBoxCenterX = (inputBoxRect.left + inputBoxRect.right) / 2 - reactFlowRect.left
            reactFlowInstance.setViewport(
              { x: promptBoxCenterX - contentCenterX * calculatedZoom, y: targetViewportY, zoom: calculatedZoom },
              { duration: 300 }
            )
          } else {
            reactFlowInstance.setViewport(
              { x: reactFlowWidth / 2 - contentCenterX * calculatedZoom, y: targetViewportY, zoom: calculatedZoom },
              { duration: 300 }
            )
          }
          setTimeout(() => window.dispatchEvent(new CustomEvent('fit-view-end')), 350)
        })
      })
    } else {
      let finalZoom = zoomValue
      if (zoomValue >= 0.98 && zoomValue <= 1.02) finalZoom = 1 // Snap near-100%
      const viewport = reactFlowInstance.getViewport()
      reactFlowInstance.setViewport(
        { x: viewport.x, y: viewport.y, zoom: finalZoom },
        finalZoom !== zoomValue ? { duration: 150 } : undefined
      )
    }
    setTimeout(() => setZoom(reactFlowInstance.getViewport().zoom), 10)
  }

  if (isEditingZoom) {
    return (
      <Input
        ref={zoomInputRef}
        type="text"
        value={`${zoomEditValue}%`}
        onChange={(e) => setZoomEditValue(e.target.value.replace('%', ''))}
        onBlur={handleZoomInputBlur}
        onKeyDown={handleZoomInputKeyDown}
        className={cn(
          'h-6 w-12 px-0.5 text-xs text-center text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 focus:border-blue-500 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0',
          className
        )}
        onFocus={(e) => e.target.select()}
        autoFocus
      />
    )
  }

  return (
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-6 px-1.5 text-xs text-gray-900 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-[#2a2a2a]',
            className
          )}
          style={{ minWidth: '40px' }} // Stable width as % digits change
          onDoubleClick={(e) => {
            e.preventDefault() // Double-click edits the % inline (same as former top-bar click)
            e.stopPropagation()
            handleZoomInputFocus()
          }}
          title="Zoom — click for presets, double-click to type"
        >
          <span className="inline-block text-center" style={{ width: '28px' }}>
            {Math.round(zoom * 100)}%
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-32">
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault() // Keep menu open while focusing inline edit
            setMenuOpen(false)
            handleZoomInputFocus()
          }}
        >
          Custom…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleZoomChange('fit')}>Fit</DropdownMenuItem>
        <DropdownMenuSeparator />
        {[0.5, 0.75, 0.9, 1, 1.25, 1.5, 2].map((z) => (
          <DropdownMenuItem
            key={z}
            onClick={() => handleZoomChange(z)}
            className={cn(zoom === z && 'bg-gray-100 dark:bg-gray-800')}
          >
            {Math.round(z * 100)}%
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
