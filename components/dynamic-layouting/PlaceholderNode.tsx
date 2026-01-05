import { memo, useState, useRef, useEffect } from 'react';
// React Flow imports for node components and positioning
import { Handle, Position, NodeProps } from 'reactflow';
import { createPortal } from 'react-dom';

// PlaceholderNode: Visual indicator showing where the next chat panel will be added
// This is a visual-only component - placeholders are managed by usePlaceholderManager
// They show below the last added panel or below the selected panel
// Styled to match React Flow placeholder appearance: dashed border, simple "+" label
// Clicking shows a dropdown menu with Note and Flashcard options
// Only registers clicks on mouse release (mouseup) to prevent accidental clicks during drag
const PlaceholderNode = ({ id, data }: NodeProps) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const mouseDownRef = useRef<{ x: number; y: number } | null>(null); // Track mouse down position to detect drags
  const shouldOpenOnMouseUpRef = useRef(false); // Track if we should open on mouseup (only if closed on mousedown)
  const dragThreshold = 5; // Pixels of movement to consider it a drag (not a click)
  const containerRef = useRef<HTMLDivElement>(null); // Ref for positioning dropdown

  return (
    <>
      <div 
        ref={containerRef}
        className="react-flow__node-placeholder transition-opacity duration-200 ease-in-out"
        title="Click to create a new panel"
        style={{
          width: '200px', // Match note panel minWidth
          height: 'auto', // Match note panel behavior - collapses to content (like empty note)
          minHeight: '60px', // Minimal height for empty note placeholder (accounts for padding)
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'transparent',
          border: '1px dashed #b1b1b7',
          color: '#b1b1b7',
          boxShadow: 'none',
          borderRadius: '16px', // Match note panel rounded-2xl (1rem = 16px)
          opacity: data?.hidden ? 0 : 1, // Fade out when hidden
          cursor: 'grab', // Use grab cursor to indicate draggability
        }}
          onPointerDown={(e) => {
            // If dropdown is open, close it on pointer down
            if (dropdownOpen) {
              e.stopPropagation(); // Prevent React Flow selection
              e.preventDefault(); // Prevent DropdownMenuTrigger from reopening
              setDropdownOpen(false);
              shouldOpenOnMouseUpRef.current = false; // Don't reopen on mouseup
            } else {
              // Record pointer down position to detect if this is a drag or click
              // Don't prevent default or stop propagation - let React Flow handle dragging
              mouseDownRef.current = { x: e.clientX, y: e.clientY };
              shouldOpenOnMouseUpRef.current = true; // Allow opening on mouseup if it's a click
            }
          }}
          onPointerUp={(e) => {
            // Only register click on pointer release if it wasn't a drag
            if (mouseDownRef.current && shouldOpenOnMouseUpRef.current) {
              const deltaX = Math.abs(e.clientX - mouseDownRef.current.x);
              const deltaY = Math.abs(e.clientY - mouseDownRef.current.y);
              const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
              
              // Only open dropdown if pointer didn't move much (it's a click, not a drag)
              if (distance < dragThreshold) {
                e.stopPropagation(); // Prevent React Flow from handling this as a click
                e.preventDefault(); // Prevent any default behavior
                setDropdownOpen(true);
              }
              // If it was a drag, don't prevent default - let React Flow handle it
              
              // Reset pointer down position and flag
              mouseDownRef.current = null;
              shouldOpenOnMouseUpRef.current = false;
            } else if (mouseDownRef.current) {
              // Reset if we had a mousedown but shouldn't open
              mouseDownRef.current = null;
              shouldOpenOnMouseUpRef.current = false;
            }
          }}
          onMouseDown={(e) => {
            // If dropdown is open, close it on mouse down
            if (dropdownOpen) {
              e.stopPropagation(); // Prevent React Flow selection
              e.preventDefault(); // Prevent DropdownMenuTrigger from reopening
              setDropdownOpen(false);
              shouldOpenOnMouseUpRef.current = false; // Don't reopen on mouseup
            }
            // Don't prevent default or stop propagation when dropdown is closed
            // This allows React Flow to handle dragging
            // Record mouse down position to detect if this is a drag or click (only if dropdown was closed)
            if (!dropdownOpen) {
              mouseDownRef.current = { x: e.clientX, y: e.clientY };
              shouldOpenOnMouseUpRef.current = true; // Allow opening on mouseup if it's a click
            }
          }}
          onMouseUp={(e) => {
            // Only register click on mouse release if it wasn't a drag
            if (mouseDownRef.current && shouldOpenOnMouseUpRef.current) {
              const deltaX = Math.abs(e.clientX - mouseDownRef.current.x);
              const deltaY = Math.abs(e.clientY - mouseDownRef.current.y);
              const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
              
              // Only open dropdown if mouse didn't move much (it's a click, not a drag)
              if (distance < dragThreshold) {
                e.stopPropagation(); // Prevent React Flow from handling this as a click
                e.preventDefault(); // Prevent any default behavior
                setDropdownOpen(true);
              }
              // If it was a drag, don't prevent default - let React Flow handle it
              
              // Reset mouse down position and flag
              mouseDownRef.current = null;
              shouldOpenOnMouseUpRef.current = false;
            } else if (mouseDownRef.current) {
              // Reset if we had a mousedown but shouldn't open
              mouseDownRef.current = null;
              shouldOpenOnMouseUpRef.current = false;
            }
          }}
        >
          {/* Display the placeholder label (typically '+') */}
          {data.label}
      {/* Top handle - target (can receive connections) */}
      <Handle type="target" position={Position.Top} id="top" isConnectable={false} />
      {/* Top handle - source (can send connections) */}
      <Handle type="source" position={Position.Top} id="top" isConnectable={false} />
      {/* Bottom handle - target (can receive connections) */}
      <Handle type="target" position={Position.Bottom} id="bottom" isConnectable={false} />
      {/* Bottom handle - source (can send connections) */}
      <Handle type="source" position={Position.Bottom} id="bottom" isConnectable={false} />
      {/* Left handle - target (can receive connections) */}
      <Handle type="target" position={Position.Left} id="left" isConnectable={false} />
      {/* Left handle - source (can send connections) */}
      <Handle type="source" position={Position.Left} id="left" isConnectable={false} />
      {/* Right handle - target (can receive connections) */}
      <Handle type="target" position={Position.Right} id="right" isConnectable={false} />
      {/* Right handle - source (can send connections) */}
      <Handle type="source" position={Position.Right} id="right" isConnectable={false} />
      </div>
      {dropdownOpen && containerRef.current && typeof window !== 'undefined' && createPortal(
        <>
          {/* Backdrop to close on outside click */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 40,
            }}
            onClick={() => setDropdownOpen(false)}
          />
          {/* Dropdown menu */}
          <div
            style={{
              position: 'fixed',
              left: containerRef.current.getBoundingClientRect().left + 'px',
              top: containerRef.current.getBoundingClientRect().bottom + 4 + 'px',
              zIndex: 50,
              backgroundColor: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              padding: '4px',
              minWidth: 'fit-content',
            }}
            className="dark:bg-[#1f1f1f] dark:border-[#2f2f2f]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('create-note-at-placeholder', { 
                    detail: { placeholderId: id } 
                  }));
                }
                setDropdownOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 12px',
                borderRadius: '4px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: '14px',
              }}
              className="hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              Note
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('create-flashcard-at-placeholder', { 
                    detail: { placeholderId: id } 
                  }));
                }
                setDropdownOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 12px',
                borderRadius: '4px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: '14px',
              }}
              className="hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              Flashcard
            </button>
          </div>
        </>,
        document.body
      )}
    </>
  );
};

export default memo(PlaceholderNode);

