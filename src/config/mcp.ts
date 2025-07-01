export interface MCPServerConfig {
  name: string;
  baseURL?: string; // Optional for stdio
  transportType: 'http' | 'stdio';
  // For stdio transport
  command?: string;
  args?: string[];
  // For http transport
  url?: string;
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
  if (!stored) return [];

  const loadedServers = JSON.parse(stored);
  // Migrate legacy servers to include transportType
  return loadedServers.map((server: any) => ({
    ...server,
    transportType: server.transportType || 'http', // Default to http for legacy servers
    url: server.url || server.baseURL, // Ensure url field is set
  }));
}
