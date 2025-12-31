'use client'

import { useRef } from 'react';
import Shape from './Shape';
import { cn } from '@/lib/utils';
import type { ShapeType } from './types';

interface ShapeGridItemProps {
  shapeType: ShapeType;
  isSelected: boolean;
  onSelect: () => void;
}

export function ShapeGridItem({ shapeType, isSelected, onSelect }: ShapeGridItemProps) {
  const dragImageRef = useRef<HTMLDivElement>(null);

  const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/reactflow', shapeType);
    console.log('Drag started with shape type:', shapeType);
    if (dragImageRef.current) {
      e.dataTransfer.setDragImage(dragImageRef.current, 0, 0);
    }
    // Prevent dropdown from closing during drag
    e.stopPropagation();
  };

  return (
    <button
      draggable
      onDragStart={handleDragStart}
      onClick={onSelect}
      className={cn(
        "p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center opacity-50 hover:opacity-100 cursor-grab active:cursor-grabbing relative",
        isSelected && "bg-gray-100 dark:bg-gray-800 opacity-100"
      )}
      title={shapeType.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
    >
      <Shape
        type={shapeType}
        width={28}
        height={28}
        fill="transparent"
        strokeWidth={1}
        stroke="#222"
        className="dark:[&_*]:stroke-gray-300"
      />
      <div className="absolute -left-[10000px] -top-[10000px] pointer-events-none" ref={dragImageRef}>
        <Shape
          type={shapeType}
          width={80}
          height={80}
          fill="#3F8AE2"
          fillOpacity={0.7}
          stroke="#3F8AE2"
          strokeWidth={2}
        />
      </div>
    </button>
  );
}

