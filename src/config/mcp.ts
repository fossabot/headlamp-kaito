export interface MCPServerConfig {
  name: string;
  baseURL: string;
}

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
