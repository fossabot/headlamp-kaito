/**
 * Simple MCP STDIO Client Manager
 * 
 * Uses the official MCP SDK to directly connect to STDIO MCP servers.
 * Much simpler than the proxy approach - connects directly to servers.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

interface MCPConnection {
  client: Client;
  transport: StdioClientTransport;
  serverName: string;
  isConnected: boolean;
}

class SimpleMCPManager {
  private static instance: SimpleMCPManager | null = null;
  private connections = new Map<string, MCPConnection>();

  private constructor() {}

  static getInstance(): SimpleMCPManager {
    if (!SimpleMCPManager.instance) {
      SimpleMCPManager.instance = new SimpleMCPManager();
    }
    return SimpleMCPManager.instance;
  }

  async connectToServer(serverName: string, command: string, args: string[] = []): Promise<boolean> {
    try {
      // Check if already connected
      if (this.connections.has(serverName)) {
        const connection = this.connections.get(serverName)!;
        if (connection.isConnected) {
          console.log(`✅ Already connected to MCP server: ${serverName}`);
          return true;
        }
      }

      console.log(`🔗 Connecting to STDIO MCP server: ${serverName}`);
      console.log(`� Command: ${command} ${args.join(' ')}`);

      // Create client
      const client = new Client({
        name: "headlamp-kaito-client",
        version: "1.0.0"
      }, {
        capabilities: {}
      });

      // Create STDIO transport
      const transport = new StdioClientTransport({
        command: command,
        args: args
      });

      // Connect
      await client.connect(transport);

      // Store connection
      const connection: MCPConnection = {
        client,
        transport,
        serverName,
        isConnected: true
      };

      this.connections.set(serverName, connection);

      console.log(`✅ Successfully connected to MCP server: ${serverName}`);
      return true;

    } catch (error) {
      console.error(`❌ Failed to connect to MCP server ${serverName}:`, error);
      return false;
    }
  }

  async sendChatMessage(serverName: string, message: string): Promise<string> {
    const connection = this.connections.get(serverName);
    if (!connection || !connection.isConnected) {
      throw new Error(`Not connected to MCP server: ${serverName}`);
    }

    try {
      // This is a simplified example - you would typically use MCP tools
      // For now, let's use a basic approach to get some response
      
      // List available tools first
      const toolsResult = await connection.client.listTools();
      
      if (toolsResult.tools && toolsResult.tools.length > 0) {
        // Try to use the first available tool (like echo)
        const firstTool = toolsResult.tools[0];
        
        if (firstTool.name === 'echo') {
          const result = await connection.client.callTool({
            name: 'echo',
            arguments: { text: message }
          });
          
          if (result.content && Array.isArray(result.content) && result.content.length > 0) {
            const firstContent = result.content[0];
            if (firstContent && typeof firstContent === 'object' && 'text' in firstContent) {
              return (firstContent as any).text || `Echo response from ${serverName}`;
            }
          }
        }
      }

      // Fallback response
      return `Response from MCP server ${serverName}: Received "${message}"`;

    } catch (error) {
      console.error(`Error sending message to ${serverName}:`, error);
      throw new Error(`Failed to send message to MCP server: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listAvailableTools(serverName: string): Promise<any[]> {
    const connection = this.connections.get(serverName);
    if (!connection || !connection.isConnected) {
      return [];
    }

    try {
      const result = await connection.client.listTools();
      return result.tools || [];
    } catch (error) {
      console.error(`Error listing tools for ${serverName}:`, error);
      return [];
    }
  }

  isConnected(serverName: string): boolean {
    const connection = this.connections.get(serverName);
    return connection?.isConnected || false;
  }

  async disconnect(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      return;
    }

    try {
      console.log(`🔌 Disconnecting from MCP server: ${serverName}`);
      await connection.client.close();
      connection.isConnected = false;
      this.connections.delete(serverName);
      console.log(`✅ Disconnected from MCP server: ${serverName}`);
    } catch (error) {
      console.error(`Error disconnecting from ${serverName}:`, error);
    }
  }

  async disconnectAll(): Promise<void> {
    console.log('🔌 Disconnecting from all MCP servers...');
    const disconnectPromises = Array.from(this.connections.keys()).map(serverName => 
      this.disconnect(serverName)
    );
    await Promise.all(disconnectPromises);
    console.log('✅ Disconnected from all MCP servers');
  }

  getConnectedServers(): string[] {
    return Array.from(this.connections.keys()).filter(serverName => 
      this.isConnected(serverName)
    );
  }
}

export default SimpleMCPManager;
