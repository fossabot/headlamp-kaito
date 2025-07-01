import React, { useState, useEffect } from 'react';
import { MCPServerConfig } from '../config/mcp';
import {
  TextField,
  Button,
  List,
  ListItem,
  Typography,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Stack,
} from '@mui/material';

const LOCAL_STORAGE_KEY = 'mcpServers';

const MCPServerManager: React.FC = () => {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [name, setName] = useState('');
  const [transportType, setTransportType] = useState<'http' | 'stdio'>('http');
  const [baseURL, setBaseURL] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      const loadedServers = JSON.parse(stored);
      // Migrate legacy servers to include transportType
      const migratedServers = loadedServers.map((server: any) => ({
        ...server,
        transportType: server.transportType || 'http', // Default to http for legacy servers
        url: server.url || server.baseURL, // Ensure url field is set
      }));
      setServers(migratedServers);

      // Save migrated servers back to localStorage if any migration was needed
      const needsMigration = loadedServers.some((server: any) => !server.transportType);
      if (needsMigration) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(migratedServers));
      }
    }
  }, []);

  const validateMCPServer = async (url: string): Promise<boolean> => {
    try {
      const res = await fetch(`${url}/v1/models`);
      if (!res.ok) return false;
      const json = await res.json();
      return Array.isArray(json?.data);
    } catch {
      return false;
    }
  };

  const handleAdd = async () => {
    setError('');

    if (!name.trim()) {
      setError('Server name is required');
      return;
    }

    let newServer: MCPServerConfig;

    if (transportType === 'http') {
      const trimmedURL = baseURL.trim().replace(/\/+$/, '');
      if (!trimmedURL) {
        setError('Base URL is required for HTTP transport');
        return;
      }

      const isValid = await validateMCPServer(trimmedURL);
      if (!isValid) {
        setError('Invalid MCP server (no /v1/models found)');
        return;
      }

      newServer = {
        name: name.trim(),
        transportType: 'http',
        baseURL: trimmedURL,
        url: trimmedURL,
      };
    } else {
      // stdio transport
      if (!command.trim()) {
        setError('Command is required for stdio transport');
        return;
      }

      const argsArray = args.trim() ? args.split(/\s+/) : [];

      newServer = {
        name: name.trim(),
        transportType: 'stdio',
        command: command.trim(),
        args: argsArray,
      };
    }

    const updated = [...servers, newServer];
    setServers(updated);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));

    // Reset form
    setName('');
    setBaseURL('');
    setCommand('');
    setArgs('');
    setTransportType('http');
  };

  const handleRemove = (index: number) => {
    const updated = [...servers];
    updated.splice(index, 1);
    setServers(updated);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 600 }}>
        Manage MCP Servers
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Add MCP (Model Context Protocol) servers to access additional AI models. Choose between
        HTTP/SSE transport for remote servers or STDIO transport for local executables.
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
        <TextField
          label="Server Name"
          value={name}
          onChange={e => setName(e.target.value)}
          fullWidth
          placeholder="e.g., My Local Server"
        />

        <FormControl fullWidth>
          <InputLabel>Transport Type</InputLabel>
          <Select
            value={transportType}
            label="Transport Type"
            onChange={e => setTransportType(e.target.value as 'http' | 'stdio')}
          >
            <MenuItem value="http">HTTP/SSE</MenuItem>
            <MenuItem value="stdio">STDIO</MenuItem>
          </Select>
        </FormControl>

        {transportType === 'http' ? (
          <TextField
            label="Base URL"
            value={baseURL}
            onChange={e => setBaseURL(e.target.value)}
            fullWidth
            placeholder="e.g., http://localhost:8080"
            helperText="The base URL of your MCP server (without /v1/models)"
          />
        ) : (
          <>
            <TextField
              label="Command"
              value={command}
              onChange={e => setCommand(e.target.value)}
              fullWidth
              placeholder="e.g., python, node, ./my-mcp-server"
              helperText="The command to execute the MCP server"
            />
            <TextField
              label="Arguments"
              value={args}
              onChange={e => setArgs(e.target.value)}
              fullWidth
              placeholder="e.g., server.py --port 8080"
              helperText="Command line arguments (space-separated)"
            />
          </>
        )}

        <Button
          variant="contained"
          onClick={handleAdd}
          sx={{ alignSelf: 'flex-start' }}
          disabled={
            !name.trim() ||
            (transportType === 'http' && !baseURL.trim()) ||
            (transportType === 'stdio' && !command.trim())
          }
        >
          Add Server
        </Button>
      </Box>
      {error && (
        <Typography color="error" sx={{ mb: 3, p: 2, bgcolor: 'error.50', borderRadius: 1 }}>
          {error}
        </Typography>
      )}

      {servers.length > 0 && (
        <>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Registered Servers
          </Typography>
          <List>
            {servers.map((server, i) => (
              <ListItem
                key={`server-${i}`}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  mb: 1,
                  bgcolor: 'background.default',
                }}
              >
                <Box sx={{ flex: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="subtitle1" fontWeight={600}>
                      {server.name}
                    </Typography>
                    <Chip
                      label={(server.transportType || 'http').toUpperCase()}
                      size="small"
                      variant="outlined"
                      color={(server.transportType || 'http') === 'http' ? 'primary' : 'secondary'}
                    />
                  </Stack>
                  {(server.transportType || 'http') === 'http' ? (
                    <Typography variant="body2" color="text.secondary">
                      URL: {server.baseURL || server.url}
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Command: {server.command} {server.args?.join(' ')}
                    </Typography>
                  )}
                </Box>
                <Button
                  onClick={() => handleRemove(i)}
                  size="small"
                  color="error"
                  variant="outlined"
                >
                  Remove
                </Button>
              </ListItem>
            ))}
          </List>
        </>
      )}
    </Box>
  );
};

export default MCPServerManager;
