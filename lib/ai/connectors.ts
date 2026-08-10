// Connector registry — external systems the copilot can eventually read/write
export type AiConnectorKind = 'notion' | 'mcp' | 'custom' // Extensible kinds

export interface AiConnector { // Declared connector (runtime wiring is separate)
  id: string // Stable id
  kind: AiConnectorKind // Category
  name: string // UI label
  description: string // Help
  enabled: boolean // Whether usable today
}

export const AI_CONNECTORS: AiConnector[] = [ // Seed list; Notion OAuth already exists in-app
  {
    id: 'notion', // Maps to notion_connections
    kind: 'notion', // Kind
    name: 'Notion', // UI
    description: 'User-connected Notion workspace (OAuth).', // Help
    enabled: true, // Connection exists; AI tools for it come later
  },
  {
    id: 'mcp', // Future MCP clients talking to Thinktable
    kind: 'mcp', // Kind
    name: 'MCP', // UI
    description: 'External agents via Thinktable MCP (next phase).', // Help
    enabled: false, // Stub
  },
]

export function getConnector(id: string): AiConnector | undefined { // Lookup
  return AI_CONNECTORS.find((c) => c.id === id) // First match
}
