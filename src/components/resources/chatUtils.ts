import {
  request,
  startPortForward,
  stopOrDeletePortForward,
} from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import { MCPModel, loadMCPServers } from '../../config/mcp';

export async function resolvePodAndPort(namespace: string, workspaceName: string) {
  const labelSelector = `kaito.sh/workspace=${workspaceName}`;
  const podsResp = await request(
    `/api/v1/namespaces/${namespace}/pods?labelSelector=${labelSelector}`
  );
  const pod = podsResp?.items?.[0];
  if (!pod) return null;

  const containers = pod.spec.containers || [];
  for (const container of containers) {
    const portObj = container.ports?.[0];
    if (portObj && portObj.containerPort) {
      return {
        podName: pod.metadata.name,
        targetPort: portObj.containerPort,
      };
    }
  }
  return null;
}

export function getClusterOrEmpty() {
  try {
    const clusterValue = getCluster();
    if (clusterValue !== null && clusterValue !== undefined) {
      return clusterValue;
    }
  } catch {}
  return '';
}

export async function startWorkspacePortForward({
  namespace,
  workspaceName,
  podName,
  targetPort,
  localPort,
  portForwardId,
}: {
  namespace: string;
  workspaceName: string;
  podName: string;
  targetPort: string | number;
  localPort: string;
  portForwardId: string;
}) {
  const cluster = getClusterOrEmpty();
  await startPortForward(
    cluster,
    namespace,
    podName,
    targetPort.toString(),
    workspaceName,
    namespace,
    localPort,
    'localhost',
    portForwardId
  );
}

export async function stopWorkspacePortForward(portForwardId: string) {
  const cluster = getClusterOrEmpty();
  await stopOrDeletePortForward(cluster, portForwardId, true);
}

export async function fetchModelsWithRetry(localPort: string, retries = 3, delay = 800) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`http://localhost:${localPort}/v1/models`);
      if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
      const data = await res.json();
      return (data.data || []).map((model: any) => ({
        title: model.id,
        value: model.id,
      }));
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise(res => setTimeout(res, delay));
    }
  }
  return [];
}

export async function fetchModelsFromAllMCPServers(): Promise<MCPModel[]> {
  const servers = loadMCPServers();
  const allModels: MCPModel[] = [];

  if (servers.length === 0) {
    return allModels;
  }

  for (const server of servers) {
    // Handle different transport types
    if (server.transportType === 'stdio') {
      // For STDIO servers, we can't pre-fetch models in browser, they need to be discovered at runtime
      // Add a placeholder model to indicate the server is available
      allModels.push({
        id: `${server.name}-placeholder`,
        object: 'model',
        serverName: server.name,
        baseURL: `stdio://${server.command}`, // Special URL to indicate STDIO transport
        created: Date.now(),
        owned_by: server.name,
      });
      continue;
    }

    // Handle HTTP/SSE servers
    try {
      const baseURL = server.baseURL || server.url;
      if (!baseURL) {
        console.warn(`HTTP MCP server ${server.name} has no baseURL or url configured`);
        continue;
      }

      const res = await fetch(`${baseURL}/v1/models`);
      if (!res.ok) {
        console.warn(`Failed to fetch models from ${server.name}: HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      const models = json.data || [];

      for (const model of models) {
        allModels.push({
          ...model,
          serverName: server.name,
          baseURL: baseURL,
        });
      }
    } catch (error) {
      console.warn(`Error fetching models from MCP server ${server.name}:`, error);
      continue;
    }
  }

  return allModels;
}

/**
 * Check if an MCP model uses HTTP transport
 */
export function isMCPModelHTTPBased(model: MCPModel): boolean {
  return !model.baseURL.startsWith('stdio://');
}

/**
 * Filter MCP models to only include HTTP-based ones
 */
export function filterHTTPMCPModels(models: MCPModel[]): MCPModel[] {
  return models.filter(isMCPModelHTTPBased);
}

/**
 * Get models from STDIO servers
 */
export function getStdioMCPModels(models: MCPModel[]): MCPModel[] {
  return models.filter(model => model.baseURL.startsWith('stdio://'));
}

// Legacy compatibility - keeping old function names
export const isMCPModelBrowserCompatible = isMCPModelHTTPBased;
export const filterBrowserCompatibleMCPModels = filterHTTPMCPModels;
