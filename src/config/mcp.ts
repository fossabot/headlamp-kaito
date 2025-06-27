// Type to represent a user-added MCP server
export interface MCPServerConfig {
  name: string;
  baseURL: string;
}

// Type to represent a single model returned by an MCP server
export interface MCPModel {
  id: string;
  object: 'model';
  created?: number;
  owned_by?: string;
  serverName: string;
  baseURL: string;
}

export function loadMCPServers(): MCPServerConfig[] {
  const stored = localStorage.getItem('mcpServers');
  return stored ? JSON.parse(stored) : [];
}
