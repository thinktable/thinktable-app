'use client';

import Link from "next/link";
import { useState } from "react";
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  BackgroundVariant,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';

// Custom node component for feature showcases
function FeatureNode({ data }: { data: { label: string; description: string; color: string } }) {
  return (
    <div 
      className="px-4 py-3 rounded-lg shadow-lg border-2 min-w-[200px]"
      style={{ 
        backgroundColor: data.color,
        borderColor: data.color,
      }}
    >
      <div className="font-semibold text-white mb-1">{data.label}</div>
      <div className="text-xs text-white/90">{data.description}</div>
    </div>
  );
}

const nodeTypes = {
  feature: FeatureNode,
};

// Use Case 1: Brainstorming Session
function BrainstormingShowcase() {
  const [nodes, setNodes, onNodesChange] = useNodesState([
    {
      id: '1',
      type: 'feature',
      position: { x: 250, y: 100 },
      data: { 
        label: 'AI Chat Input', 
        description: 'Start brainstorming',
        color: '#3b82f6'
      },
    },
    {
      id: '2',
      type: 'feature',
      position: { x: 100, y: 250 },
      data: { 
        label: 'Idea 1', 
        description: 'Auto-generated',
        color: '#8b5cf6'
      },
    },
    {
      id: '3',
      type: 'feature',
      position: { x: 400, y: 250 },
      data: { 
        label: 'Idea 2', 
        description: 'Auto-generated',
        color: '#8b5cf6'
      },
    },
    {
      id: '4',
      type: 'feature',
      position: { x: 250, y: 400 },
      data: { 
        label: 'Connected Concept', 
        description: 'Smart linking',
        color: '#10b981'
      },
    },
  ]);

  const [edges, setEdges, onEdgesChange] = useEdgesState([
    { id: 'e1-2', source: '1', target: '2', animated: true },
    { id: 'e1-3', source: '1', target: '3', animated: true },
    { id: 'e2-4', source: '2', target: '4', animated: true },
    { id: 'e3-4', source: '3', target: '4', animated: true },
  ]);

  return (
    <div className="h-[400px] w-full border-2 border-gray-200 rounded-lg bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        minZoom={0.5}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} />
        <Controls />
        <MiniMap 
          nodeColor="#3b82f6"
          position="bottom-right"
          className="bg-white border border-gray-200 rounded"
        />
      </ReactFlow>
    </div>
  );
}

// Use Case 2: Meeting Notes to Workflow
function WorkflowShowcase() {
  const [nodes, setNodes, onNodesChange] = useNodesState([
    {
      id: '1',
      type: 'feature',
      position: { x: 50, y: 150 },
      data: { 
        label: 'Meeting Notes', 
        description: 'Raw text input',
        color: '#3b82f6'
      },
    },
    {
      id: '2',
      type: 'feature',
      position: { x: 250, y: 50 },
      data: { 
        label: 'Action Item 1', 
        description: 'Extracted',
        color: '#f59e0b'
      },
    },
    {
      id: '3',
      type: 'feature',
      position: { x: 250, y: 150 },
      data: { 
        label: 'Action Item 2', 
        description: 'Extracted',
        color: '#f59e0b'
      },
    },
    {
      id: '4',
      type: 'feature',
      position: { x: 250, y: 250 },
      data: { 
        label: 'Action Item 3', 
        description: 'Extracted',
        color: '#f59e0b'
      },
    },
    {
      id: '5',
      type: 'feature',
      position: { x: 500, y: 150 },
      data: { 
        label: 'Workflow View', 
        description: 'Visualized',
        color: '#10b981'
      },
    },
  ]);

  const [edges, setEdges, onEdgesChange] = useEdgesState([
    { id: 'e1-2', source: '1', target: '2' },
    { id: 'e1-3', source: '1', target: '3' },
    { id: 'e1-4', source: '1', target: '4' },
    { id: 'e2-5', source: '2', target: '5' },
    { id: 'e3-5', source: '3', target: '5' },
    { id: 'e4-5', source: '4', target: '5' },
  ]);

  return (
    <div className="h-[400px] w-full border-2 border-gray-200 rounded-lg bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        minZoom={0.5}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} />
        <Controls />
        <MiniMap 
          nodeColor="#3b82f6"
          position="bottom-right"
          className="bg-white border border-gray-200 rounded"
        />
      </ReactFlow>
    </div>
  );
}

// Use Case 3: Research Topics
function ResearchShowcase() {
  const [nodes, setNodes, onNodesChange] = useNodesState([
    {
      id: '1',
      type: 'feature',
      position: { x: 300, y: 50 },
      data: { 
        label: 'Main Topic', 
        description: 'Research focus',
        color: '#3b82f6'
      },
    },
    {
      id: '2',
      type: 'feature',
      position: { x: 100, y: 200 },
      data: { 
        label: 'Sub-topic A', 
        description: 'Related concept',
        color: '#8b5cf6'
      },
    },
    {
      id: '3',
      type: 'feature',
      position: { x: 300, y: 200 },
      data: { 
        label: 'Sub-topic B', 
        description: 'Related concept',
        color: '#8b5cf6'
      },
    },
    {
      id: '4',
      type: 'feature',
      position: { x: 500, y: 200 },
      data: { 
        label: 'Sub-topic C', 
        description: 'Related concept',
        color: '#8b5cf6'
      },
    },
    {
      id: '5',
      type: 'feature',
      position: { x: 50, y: 350 },
      data: { 
        label: 'Detail 1', 
        description: 'Deep dive',
        color: '#10b981'
      },
    },
    {
      id: '6',
      type: 'feature',
      position: { x: 250, y: 350 },
      data: { 
        label: 'Detail 2', 
        description: 'Deep dive',
        color: '#10b981'
      },
    },
    {
      id: '7',
      type: 'feature',
      position: { x: 450, y: 350 },
      data: { 
        label: 'Detail 3', 
        description: 'Deep dive',
        color: '#10b981'
      },
    },
  ]);

  const [edges, setEdges, onEdgesChange] = useEdgesState([
    { id: 'e1-2', source: '1', target: '2' },
    { id: 'e1-3', source: '1', target: '3' },
    { id: 'e1-4', source: '1', target: '4' },
    { id: 'e2-5', source: '2', target: '5' },
    { id: 'e2-6', source: '2', target: '6' },
    { id: 'e3-6', source: '3', target: '6' },
    { id: 'e4-7', source: '4', target: '7' },
  ]);

  return (
    <div className="h-[400px] w-full border-2 border-gray-200 rounded-lg bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        minZoom={0.5}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} />
        <Controls />
        <MiniMap 
          nodeColor="#3b82f6"
          position="bottom-right"
          className="bg-white border border-gray-200 rounded"
        />
      </ReactFlow>
    </div>
  );
}

export default function ProductPage() {
  const [activeTab, setActiveTab] = useState<'brainstorm' | 'workflow' | 'research'>('brainstorm');

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Navigation */}
      <nav className="container mx-auto px-6 py-4 flex justify-between items-center">
        <Link href="/" className="text-2xl font-bold text-blue-600">ThinkTable</Link>
        <div className="flex gap-6">
          <Link href="/" className="text-gray-700 hover:text-blue-600 transition-colors">
            Home
          </Link>
          <Link href="/login" className="text-gray-700 hover:text-blue-600 transition-colors">
            Login
          </Link>
          <Link 
            href="/signup" 
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-6 py-16 text-center">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">
          See ThinkTable in Action
        </h1>
        <p className="text-xl text-gray-600 max-w-3xl mx-auto">
          Explore how AI-powered chat transforms into interactive mind maps. 
          Each conversation becomes a visual learning experience.
        </p>
      </section>

      {/* Feature Showcases */}
      <section className="container mx-auto px-6 py-12">
        <div className="max-w-6xl mx-auto">
          {/* Tab Navigation */}
          <div className="flex gap-4 mb-8 border-b border-gray-200">
            <button
              onClick={() => setActiveTab('brainstorm')}
              className={`px-6 py-3 font-semibold transition-colors ${
                activeTab === 'brainstorm'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Brainstorming
            </button>
            <button
              onClick={() => setActiveTab('workflow')}
              className={`px-6 py-3 font-semibold transition-colors ${
                activeTab === 'workflow'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Meeting Notes
            </button>
            <button
              onClick={() => setActiveTab('research')}
              className={`px-6 py-3 font-semibold transition-colors ${
                activeTab === 'research'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Research Topics
            </button>
          </div>

          {/* Showcase Content */}
          <div className="bg-white rounded-xl shadow-xl p-8 mb-8">
            {activeTab === 'brainstorm' && (
              <div>
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Transform Brainstorming Sessions
                </h2>
                <p className="text-gray-600 mb-6">
                  Start a conversation with AI, and watch as your ideas automatically connect and branch out. 
                  Each thought becomes a node, and relationships are visualized in real-time.
                </p>
                <ReactFlowProvider>
                  <BrainstormingShowcase />
                </ReactFlowProvider>
              </div>
            )}

            {activeTab === 'workflow' && (
              <div>
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Convert Meeting Notes to Workflows
                </h2>
                <p className="text-gray-600 mb-6">
                  Paste your meeting notes and let AI extract action items, decisions, and dependencies. 
                  See your notes transform into a clear, actionable workflow diagram.
                </p>
                <ReactFlowProvider>
                  <WorkflowShowcase />
                </ReactFlowProvider>
              </div>
            )}

            {activeTab === 'research' && (
              <div>
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Organize Research Topics Visually
                </h2>
                <p className="text-gray-600 mb-6">
                  Explore complex topics by breaking them down into interconnected concepts. 
                  Navigate relationships, see connections, and understand how ideas relate to each other.
                </p>
                <ReactFlowProvider>
                  <ResearchShowcase />
                </ReactFlowProvider>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* React Flow Pro Features */}
      <section className="container mx-auto px-6 py-16 bg-white rounded-2xl my-12">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Coming Soon: React Flow Pro Features
          </h2>
          <p className="text-xl text-gray-600 mb-8">
            We&apos;re integrating advanced React Flow capabilities to make your mind maps even more powerful.
          </p>
          <div className="grid md:grid-cols-3 gap-6 text-left">
            <div className="p-6 bg-blue-50 rounded-lg">
              <h3 className="font-semibold text-gray-900 mb-2">Custom Node Types</h3>
              <p className="text-gray-600 text-sm">
                Create specialized nodes for different types of content - code snippets, images, links, and more.
              </p>
            </div>
            <div className="p-6 bg-purple-50 rounded-lg">
              <h3 className="font-semibold text-gray-900 mb-2">Advanced Layouts</h3>
              <p className="text-gray-600 text-sm">
                Automatic layout algorithms to organize your maps beautifully - hierarchical, force-directed, and more.
              </p>
            </div>
            <div className="p-6 bg-green-50 rounded-lg">
              <h3 className="font-semibold text-gray-900 mb-2">Collaboration</h3>
              <p className="text-gray-600 text-sm">
                Real-time collaboration with multiple users editing the same map simultaneously.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-6 py-16 text-center">
        <h2 className="text-4xl font-bold text-gray-900 mb-4">
          Ready to Transform Your Ideas?
        </h2>
        <p className="text-xl text-gray-600 mb-8">
          Start creating visual mind maps from your conversations today.
        </p>
        <Link 
          href="/signup" 
          className="bg-blue-600 text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-blue-700 transition-colors inline-block"
        >
          Start Free Trial
        </Link>
      </section>

      {/* Footer */}
      <footer className="container mx-auto px-6 py-8 border-t border-gray-200">
        <div className="flex justify-between items-center">
          <div className="text-gray-600">© 2024 ThinkTable. All rights reserved.</div>
          <div className="flex gap-6">
            <Link href="/product" className="text-gray-600 hover:text-blue-600 transition-colors">Product</Link>
            <Link href="/about" className="text-gray-600 hover:text-blue-600 transition-colors">About</Link>
            <Link href="/contact" className="text-gray-600 hover:text-blue-600 transition-colors">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}



