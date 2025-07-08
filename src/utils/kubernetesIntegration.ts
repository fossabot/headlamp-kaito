import { request } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';

export interface KubernetesEndpoint {
  id: string;
  name: string;
  type: 'kaito' | 'kubernetes' | 'generic';
  apiVersion?: string;
  kind?: string;
  namespace?: string;
  description?: string;
  enabled: boolean;
}

export interface KubernetesResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: any;
  status?: any;
}

export class KubernetesIntegration {
  private endpoints: KubernetesEndpoint[];
  private cluster: string;

  constructor() {
    this.endpoints = [];
    this.cluster = this.getClusterName();
  }

  private getClusterName(): string {
    try {
      const clusterValue = getCluster();
      return clusterValue || 'default';
    } catch {
      return 'default';
    }
  }

  setEndpoints(endpoints: KubernetesEndpoint[]): void {
    this.endpoints = endpoints.filter(endpoint => endpoint.enabled);
  }

  getEndpoints(): KubernetesEndpoint[] {
    return this.endpoints;
  }

  async getNamespaces(): Promise<string[]> {
    try {
      const response = await request('/api/v1/namespaces');
      return response.items?.map((ns: any) => ns.metadata.name) || [];
    } catch (error) {
      console.error('Error fetching namespaces:', error);
      return [];
    }
  }

  async getKaitoWorkspaces(namespace?: string): Promise<KubernetesResource[]> {
    try {
      const path = namespace 
        ? `/apis/kaito.sh/v1alpha1/namespaces/${namespace}/workspaces`
        : `/apis/kaito.sh/v1alpha1/workspaces`;
      
      const response = await request(path);
      return response.items || [];
    } catch (error) {
      console.error('Error fetching Kaito workspaces:', error);
      return [];
    }
  }

  async getKaitoWorkspaceStatus(namespace: string, workspaceName: string): Promise<any> {
    try {
      const response = await request(
        `/apis/kaito.sh/v1alpha1/namespaces/${namespace}/workspaces/${workspaceName}`
      );
      return response.status;
    } catch (error) {
      console.error('Error fetching Kaito workspace status:', error);
      return null;
    }
  }

  async getPods(namespace?: string, labelSelector?: string): Promise<KubernetesResource[]> {
    try {
      const path = namespace 
        ? `/api/v1/namespaces/${namespace}/pods`
        : `/api/v1/pods`;
      
      const query = labelSelector ? `?labelSelector=${encodeURIComponent(labelSelector)}` : '';
      const response = await request(path + query);
      return response.items || [];
    } catch (error) {
      console.error('Error fetching pods:', error);
      return [];
    }
  }

  async getServices(namespace?: string, labelSelector?: string): Promise<KubernetesResource[]> {
    try {
      const path = namespace 
        ? `/api/v1/namespaces/${namespace}/services`
        : `/api/v1/services`;
      
      const query = labelSelector ? `?labelSelector=${encodeURIComponent(labelSelector)}` : '';
      const response = await request(path + query);
      return response.items || [];
    } catch (error) {
      console.error('Error fetching services:', error);
      return [];
    }
  }

  async getDeployments(namespace?: string, labelSelector?: string): Promise<KubernetesResource[]> {
    try {
      const path = namespace 
        ? `/apis/apps/v1/namespaces/${namespace}/deployments`
        : `/apis/apps/v1/deployments`;
      
      const query = labelSelector ? `?labelSelector=${encodeURIComponent(labelSelector)}` : '';
      const response = await request(path + query);
      return response.items || [];
    } catch (error) {
      console.error('Error fetching deployments:', error);
      return [];
    }
  }

  async getResourceByApiVersion(
    apiVersion: string,
    kind: string,
    namespace?: string,
    name?: string
  ): Promise<KubernetesResource | KubernetesResource[]> {
    try {
      const [group, version] = apiVersion.includes('/') 
        ? apiVersion.split('/')
        : ['', apiVersion];
      
      const kindLower = kind.toLowerCase();
      const pluralKind = this.pluralize(kindLower);
      
      let path: string;
      if (group) {
        path = `/apis/${group}/${version}`;
      } else {
        path = `/api/${version}`;
      }
      
      if (namespace) {
        path += `/namespaces/${namespace}`;
      }
      
      path += `/${pluralKind}`;
      
      if (name) {
        path += `/${name}`;
        const response = await request(path);
        return response;
      } else {
        const response = await request(path);
        return response.items || [];
      }
    } catch (error) {
      console.error('Error fetching resource:', error);
      return [];
    }
  }

  private pluralize(kind: string): string {
    // Simple pluralization for common Kubernetes resources
    const pluralMap: Record<string, string> = {
      'pod': 'pods',
      'service': 'services',
      'deployment': 'deployments',
      'configmap': 'configmaps',
      'secret': 'secrets',
      'namespace': 'namespaces',
      'node': 'nodes',
      'persistentvolume': 'persistentvolumes',
      'persistentvolumeclaim': 'persistentvolumeclaims',
      'workspace': 'workspaces',
      'inference': 'inferences',
    };
    
    return pluralMap[kind] || `${kind}s`;
  }

  async queryResources(query: string): Promise<any> {
    // Parse natural language query and convert to API calls
    const lowerQuery = query.toLowerCase();
    
    try {
      if (lowerQuery.includes('workspace')) {
        if (lowerQuery.includes('status')) {
          const namespaces = await this.getNamespaces();
          const results = [];
          for (const ns of namespaces) {
            const workspaces = await this.getKaitoWorkspaces(ns);
            results.push(...workspaces);
          }
          return results;
        } else {
          return await this.getKaitoWorkspaces();
        }
      } else if (lowerQuery.includes('pod')) {
        const match = lowerQuery.match(/namespace\s+(\w+)/);
        const namespace = match ? match[1] : undefined;
        return await this.getPods(namespace);
      } else if (lowerQuery.includes('service')) {
        const match = lowerQuery.match(/namespace\s+(\w+)/);
        const namespace = match ? match[1] : undefined;
        return await this.getServices(namespace);
      } else if (lowerQuery.includes('deployment')) {
        const match = lowerQuery.match(/namespace\s+(\w+)/);
        const namespace = match ? match[1] : undefined;
        return await this.getDeployments(namespace);
      } else if (lowerQuery.includes('namespace')) {
        return await this.getNamespaces();
      } else {
        // Generic query - try to get all resources
        const namespaces = await this.getNamespaces();
        return {
          namespaces,
          workspaces: await this.getKaitoWorkspaces(),
        };
      }
    } catch (error) {
      console.error('Error querying resources:', error);
      throw error;
    }
  }

  formatResourceSummary(resources: any): string {
    if (Array.isArray(resources)) {
      if (resources.length === 0) {
        return 'No resources found matching your query.';
      }
      
      const resourceType = resources[0]?.kind || 'Resource';
      let summary = `Found ${resources.length} ${resourceType}(s):\n\n`;
      
      resources.forEach((resource, index) => {
        const name = resource.metadata?.name || 'Unknown';
        const namespace = resource.metadata?.namespace || 'N/A';
        const status = this.getResourceStatus(resource);
        
        summary += `${index + 1}. **${name}**\n`;
        summary += `   - Namespace: ${namespace}\n`;
        summary += `   - Status: ${status}\n`;
        
        if (resource.spec?.instanceType) {
          summary += `   - Instance Type: ${resource.spec.instanceType}\n`;
        }
        
        if (resource.spec?.image) {
          summary += `   - Image: ${resource.spec.image}\n`;
        }
        
        summary += '\n';
      });
      
      return summary;
    } else if (typeof resources === 'object' && resources !== null) {
      if (resources.namespaces) {
        let summary = `Found ${resources.namespaces.length} namespace(s):\n`;
        resources.namespaces.forEach((ns: string, index: number) => {
          summary += `${index + 1}. ${ns}\n`;
        });
        
        if (resources.workspaces) {
          summary += `\nFound ${resources.workspaces.length} Kaito workspace(s):\n`;
          resources.workspaces.forEach((ws: any, index: number) => {
            summary += `${index + 1}. ${ws.metadata?.name || 'Unknown'} (${ws.metadata?.namespace || 'N/A'})\n`;
          });
        }
        
        return summary;
      } else {
        return JSON.stringify(resources, null, 2);
      }
    } else {
      return 'No data returned from query.';
    }
  }

  private getResourceStatus(resource: any): string {
    if (resource.status?.conditions) {
      const readyCondition = resource.status.conditions.find(
        (c: any) => c.type === 'Ready' || c.type === 'InferenceReady'
      );
      if (readyCondition) {
        return readyCondition.status === 'True' ? 'Ready' : 'Not Ready';
      }
    }
    
    if (resource.status?.phase) {
      return resource.status.phase;
    }
    
    return 'Unknown';
  }
}

export const kubernetesIntegration = new KubernetesIntegration();
