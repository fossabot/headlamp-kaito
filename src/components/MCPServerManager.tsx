import React, { useState, useEffect } from 'react';
import { MCPServerConfig } from '../config/mcp';
import { TextField, Button, List, ListItem, Typography, Box } from '@mui/material';

const LOCAL_STORAGE_KEY = 'mcpServers';

const MCPServerManager: React.FC = () => {
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [name, setName] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) setServers(JSON.parse(stored));
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
    const trimmedURL = baseURL.trim().replace(/\/+$/, '');
    if (!trimmedURL || !name) {
      setError('Name and URL required');
      return;
    }

    const isValid = await validateMCPServer(trimmedURL);
    if (!isValid) {
      setError('Invalid MCP server (no /v1/models found)');
      return;
    }

    const newServer = { name, baseURL: trimmedURL };
    const updated = [...servers, newServer];
    setServers(updated);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
    setName('');
    setBaseURL('');
  };

  const handleRemove = (index: number) => {
    const updated = [...servers];
    updated.splice(index, 1);
    setServers(updated);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
  };

  return (
    <Box>
      <Typography variant="h6">Register MCP Server</Typography>
      <TextField label="Name" value={name} onChange={e => setName(e.target.value)} />
      <TextField label="Base URL" value={baseURL} onChange={e => setBaseURL(e.target.value)} />
      <Button variant="contained" onClick={handleAdd}>
        Add
      </Button>
      {error && <Typography color="error">{error}</Typography>}
      <List>
        {servers.map((server, i) => (
          <ListItem key={i}>
            {server.name} — {server.baseURL}
            <Button onClick={() => handleRemove(i)}>Remove</Button>
          </ListItem>
        ))}
      </List>
    </Box>
  );
};

export default MCPServerManager;
