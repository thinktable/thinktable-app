'use client';

// Demo page for dynamic layouting feature
// Shows how to use the dynamic layouting components with React Flow
import { DynamicLayoutFlow } from '@/components/dynamic-layouting/DynamicLayoutFlow';
import '@/components/dynamic-layouting/dynamic-layouting.css';

export default function DynamicLayoutDemo() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header with instructions */}
      <div className="border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold mb-2">Dynamic Layouting Demo</h1>
          <p className="text-sm text-muted-foreground">
            Click nodes to add children, click placeholders to convert them to nodes, or click the &apos;+&apos; button on edges to insert nodes.
          </p>
        </div>
      </div>

      {/* React Flow component with dynamic layouting */}
      <div className="h-[calc(100vh-120px)] w-full">
        <DynamicLayoutFlow />
      </div>
    </div>
  );
}

