import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box,
  Dialog,
  DialogContent,
  Typography,
  IconButton,
  Avatar,
  Paper,
  Stack,
  Chip,
  Fab,
  CircularProgress,
  Tooltip,
  TextField,
  Autocomplete,
  Button,
  DialogTitle,
  DialogActions,
  Slider,
} from '@mui/material';
import { styled } from '@mui/system';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, generateText } from 'ai';
import { experimental_createMCPClient as createMCPClient } from 'ai';
import { DEFAULT_OPENAI_CONFIG } from '../config/openai';
import ModelSettingsDialog, { ModelConfig } from './ModelSettingsDialog';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import {
  request,
  startPortForward,
  stopOrDeletePortForward,
} from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { useTheme } from '@mui/material/styles';
import {
  resolvePodAndPort,
  startWorkspacePortForward,
  stopWorkspacePortForward,
  fetchModelsWithRetry,
  getClusterOrEmpty,
} from './resources/chatUtils';
import { MCPServerConfig, MCPTool, MCPModel, loadMCPServers } from '../config/mcp';
import { fetchToolsFromAllMCPServers, fetchModelsFromAllMCPServers } from './resources/chatUtils';
import MCPServerManager from './MCPServerManager';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isLoading?: boolean;
}

const ChatDialog = styled(Dialog)(() => ({
  '& .MuiDialog-paper': {
    borderRadius: '16px',
    maxWidth: '900px',
    width: '90vw',
    height: '85vh',
    maxHeight: '800px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: '#ffffff',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    border: '1px solid rgba(0,0,0,0.08)',
  },
  '@keyframes blink': {
    '0%, 50%': { opacity: 1 },
    '51%, 100%': { opacity: 0 },
  },
}));

const ChatHeader = styled(Box)(() => ({
  padding: '24px 32px 16px',
  borderBottom: '1px solid rgba(0,0,0,0.1)',
  background: 'rgba(0,0,0,0.02)',
}));

const MessagesContainer = styled(Box)(() => ({
  flex: 1,
  overflowY: 'auto',
  padding: '16px 0',
  display: 'flex',
  flexDirection: 'column',
  '&::-webkit-scrollbar': {
    width: '6px',
  },
  '&::-webkit-scrollbar-track': {
    background: 'transparent',
  },
  '&::-webkit-scrollbar-thumb': {
    background: 'rgba(0,0,0,0.2)',
    borderRadius: '3px',
    '&:hover': {
      background: 'rgba(0,0,0,0.3)',
    },
  },
}));

const MessageBubble = styled(Box)(({ isUser }) => ({
  display: 'flex',
  flexDirection: isUser ? 'row-reverse' : 'row',
  alignItems: 'flex-start',
  gap: '12px',
  padding: '8px 32px',
  marginBottom: '16px',
  '&:hover': {
    background: 'rgba(0,0,0,0.02)',
  },
}));

const MessageContent = styled(Paper)(({ isUser }) => ({
  maxWidth: '75%',
  padding: '16px 20px',
  borderRadius: isUser ? '20px 20px 6px 20px' : '20px 20px 20px 6px',
  background: isUser ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' : '#f8fafc',
  color: isUser ? '#ffffff' : '#1e293b',
  border: 'none',
  boxShadow: isUser ? '0 4px 12px rgba(59, 130, 246, 0.3)' : '0 2px 8px rgba(0,0,0,0.1)',
  transition: 'all 0.2s ease',
  '&:hover': {
    transform: 'translateY(-1px)',
    boxShadow: isUser ? '0 6px 16px rgba(59, 130, 246, 0.4)' : '0 4px 12px rgba(0,0,0,0.15)',
  },
}));

const InputContainer = styled(Box)(() => ({
  padding: '20px 32px 28px',
  borderTop: '1px solid rgba(0,0,0,0.1)',
  background: 'rgba(255,255,255,0.8)',
  backdropFilter: 'blur(10px)',
}));

const StyledInputBox = styled(Box)(() => ({
  borderRadius: '24px',
  backgroundColor: '#ffffff',
  border: '2px solid rgba(0,0,0,0.12)',
  transition: 'all 0.2s ease',
  padding: '14px 20px',
  minHeight: '48px',
  display: 'flex',
  alignItems: 'center',
  cursor: 'text',
  '&:hover': {
    border: '2px solid #3b82f6',
  },
  '&:focus-within': {
    border: '2px solid #3b82f6',
    boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.2)',
  },
}));

const SendButton = styled(IconButton)(() => ({
  width: '48px',
  height: '48px',
  marginLeft: '12px',
  background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  color: '#ffffff',
  '&:hover': {
    background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
    transform: 'scale(1.05)',
  },
  '&:disabled': {
    background: 'rgba(0,0,0,0.1)',
    color: 'rgba(0,0,0,0.3)',
  },
  transition: 'all 0.2s ease',
}));

interface ChatUIProps {
  open?: boolean;
  onClose?: () => void;
  namespace: string;
  workspaceName?: string;
  theme?: any;
}

/**
 * ChatUI Component - Hybrid AI + MCP Architecture
 *
 * Architecture Overview:
 * - AI Model: Always uses port-forwarded Kubernetes service for primary inference
 * - MCP Context: Optionally augments responses with tools from MCP servers
 * - Tool Execution: MCP tools are called when relevant to user queries
 *
 * Data Flow:
 * 1. User submits query
 * 2. AI model processes query using port-forwarded endpoint
 * 3. If MCP tools are available and relevant, they augment the response
 * 4. Combined AI + tool results are returned to user
 *
 * Key Principles:
 * - Port forwarding is ONLY used for AI model inference
 * - MCP servers provide tools/context, not model inference
 * - Graceful degradation: chat works even if MCP tools fail
 * - Legacy MCP model selection is supported for backward compatibility
 */
const ChatUI: React.FC<ChatUIProps & { embedded?: boolean }> = ({
  open = true,
  onClose,
  namespace,
  workspaceName,
  embedded = false,
  theme: themeProp,
}) => {
  const theme = themeProp || useTheme();
  const [config, setConfig] = useState<ModelConfig>(DEFAULT_OPENAI_CONFIG);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { temperature = 0.7, maxTokens = 1000 } = config || {};
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        "Hello! I'm your AI assistant with access to MCP tools for enhanced capabilities. How can I help you today?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [isPortForwardRunning, setIsPortForwardRunning] = useState(false);
  const portForwardIdRef = useRef<string | null>(null);
  const [portForwardStatus, setPortForwardStatus] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const [models, setModels] = useState<{ title: string; value: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState<{ title: string; value: string } | null>(null);
  const [isPortReady, setIsPortReady] = useState(false);
  const [baseURL, setBaseURL] = useState('http://localhost:8080/v1');
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false);

  // MCP Context Management (separate from model selection)
  const [mcpContextEnabled, setMcpContextEnabled] = useState(false);
  const [availableMCPServers, setAvailableMCPServers] = useState<string[]>([]);
  const [selectedMCPServers, setSelectedMCPServers] = useState<string[]>([]);
  const [mcpTools, setMcpTools] = useState<any[]>([]);

  // Legacy MCP model state (deprecated - keeping for backward compatibility)
  const [availableMCPModels, setAvailableMCPModels] = useState<MCPModel[]>([]);
  const [selectedMCPModel, setSelectedMCPModel] = useState<MCPModel | null>(null);

  // Load MCP servers and tools on component mount
  useEffect(() => {
    const loadMCPData = async () => {
      try {
        const servers = loadMCPServers();
        const serverNames = servers.map(server => server.name);
        setAvailableMCPServers(serverNames);

        // Load persisted MCP context settings
        const savedMcpEnabled = localStorage.getItem('mcpContextEnabled');
        const savedSelectedServers = localStorage.getItem('selectedMCPServers');

        if (savedMcpEnabled !== null) {
          setMcpContextEnabled(JSON.parse(savedMcpEnabled));
        }

        if (savedSelectedServers) {
          const parsedServers = JSON.parse(savedSelectedServers);
          // Only keep servers that still exist in configuration
          const validServers = parsedServers.filter((server: string) =>
            serverNames.includes(server)
          );
          setSelectedMCPServers(validServers);
        }

        // Legacy: Load MCP models (to be deprecated)
        const mcpModels = await fetchModelsFromAllMCPServers();
        setAvailableMCPModels(mcpModels);
      } catch (error) {
        console.error('Failed to load MCP data:', error);
      }
    };

    loadMCPData();
  }, []);

  // Persist MCP context settings when they change
  useEffect(() => {
    localStorage.setItem('mcpContextEnabled', JSON.stringify(mcpContextEnabled));
  }, [mcpContextEnabled]);

  useEffect(() => {
    localStorage.setItem('selectedMCPServers', JSON.stringify(selectedMCPServers));
  }, [selectedMCPServers]);

  // Reload MCP tools when MCP context settings change
  useEffect(() => {
    const reloadMCPTools = async () => {
      if (mcpContextEnabled && selectedMCPServers.length > 0) {
        try {
          console.log('Reloading MCP tools for selected servers:', selectedMCPServers);
          const tools = await getMCPToolsForChat(selectedMCPServers);
          setMcpTools(tools);
        } catch (error) {
          console.error('Failed to reload MCP tools:', error);
        }
      } else {
        setMcpTools([]);
      }
    };

    reloadMCPTools();
  }, [mcpContextEnabled, selectedMCPServers]);

  useEffect(() => {
    console.log('selectedMCPModel changed:', selectedMCPModel);
  }, [selectedMCPModel]);

  const handleInputChange = (e: React.FormEvent<HTMLDivElement>) => {
    const text = (e.target as HTMLElement).textContent || '';
    setInput(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  const clearInput = () => {
    if (inputRef.current) {
      inputRef.current.textContent = '';
      setInput('');
    }
  };

  const handleChipClick = (text: string) => {
    setInput(text);
    if (inputRef.current) {
      inputRef.current.textContent = text;
      inputRef.current.focus();
    }
  };
  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    console.log('🚀 Starting chat request with architecture:');
    console.log('  AI Model:', selectedModel?.value, 'via', baseURL);
    console.log(
      '  MCP Context:',
      mcpContextEnabled ? `${selectedMCPServers.length} servers` : 'disabled'
    );
    console.log('  Available Tools:', mcpTools.length);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    clearInput();
    setIsLoading(true);

    const aiMessageId = (Date.now() + 1).toString();
    const aiMessage: Message = {
      id: aiMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages(prev => [...prev, aiMessage]);

    try {
      const conversationHistory = messages.concat(userMessage).map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

      // Validate AI model configuration
      const modelId = selectedModel?.value;
      if (!modelId) {
        throw new Error('No AI model selected.');
      }

      // Create AI model provider (always use port-forwarded endpoint)
      const aiModelBaseURL = baseURL.includes('/v1') ? baseURL : `${baseURL}/v1`;
      console.log('📡 Using AI model endpoint:', aiModelBaseURL);

      const openAICompatibleProvider = createOpenAICompatible({
        baseURL: aiModelBaseURL,
        apiKey: '',
        name: 'openai-compatible',
      });

      const model = openAICompatibleProvider.chatModel(modelId);

      // Collect available MCP tools from selected servers
      const availableTools = await collectMCPTools();

      // Choose appropriate chat mode based on tool availability
      if (availableTools.length > 0) {
        console.log('🔧 Using enhanced mode with', availableTools.length, 'MCP tools');
        await handleEnhancedChat(model, conversationHistory, availableTools, aiMessageId);
      } else {
        console.log('💬 Using standard chat mode (no MCP tools)');
        await handleStandardChat(model, conversationHistory, aiMessageId);
      }
    } catch (error) {
      console.error('❌ Chat error:', error);
      await handleChatError(error, aiMessageId);
    } finally {
      setIsLoading(false);
    }
  };

  // Collect MCP tools from all selected sources
  const collectMCPTools = async (): Promise<any[]> => {
    const serversToUse: string[] = [];

    // Add servers from MCP context integration (primary)
    if (mcpContextEnabled && selectedMCPServers.length > 0) {
      serversToUse.push(...selectedMCPServers);
    }

    // Add server from legacy MCP model selection (backward compatibility)
    if (selectedMCPModel && !serversToUse.includes(selectedMCPModel.serverName)) {
      console.log('🔄 Legacy compatibility: Adding', selectedMCPModel.serverName);
      serversToUse.push(selectedMCPModel.serverName);
    }

    if (serversToUse.length === 0) {
      return [];
    }

    try {
      const tools = await getMCPToolsForChat(serversToUse);
      console.log('✅ Loaded', tools.length, 'tools from', serversToUse.length, 'servers');
      return tools;
    } catch (error) {
      console.error('⚠️ Failed to load MCP tools, continuing without:', error);
      return [];
    }
  };

  // Handle chat with MCP tool augmentation
  const handleEnhancedChat = async (
    model: any,
    conversationHistory: any[],
    tools: any[],
    messageId: string
  ) => {
    const result = await generateText({
      model,
      messages: conversationHistory,
      tools: tools.reduce((acc, tool) => {
        acc[tool.function.name] = {
          description: tool.function.description,
          parameters: tool.function.parameters,
          execute: async (args: any) => {
            return await executeMCPToolFromChat(tool.originalName, tool.serverName, args);
          },
        };
        return acc;
      }, {} as any),
      temperature,
      maxTokens,
      toolChoice: 'auto',
    });

    let finalContent = result.text;

    // Process any tool calls that were made
    if (result.toolCalls && result.toolCalls.length > 0) {
      console.log('🔧 Processing', result.toolCalls.length, 'tool calls');

      const toolResults: string[] = [];
      for (const toolCall of result.toolCalls) {
        try {
          const [serverName, ...toolNameParts] = toolCall.toolName.split('_');
          const toolName = toolNameParts.join('_');

          console.log(`⚙️ Executing: ${toolName} on ${serverName}`);
          const toolResult = await executeMCPToolFromChat(toolName, serverName, toolCall.args);

          toolResults.push(`**${toolCall.toolName}:** ${JSON.stringify(toolResult, null, 2)}`);
        } catch (error) {
          console.error(`❌ Tool execution failed: ${toolCall.toolName}:`, error);
          toolResults.push(
            `**${toolCall.toolName} failed:** ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }
      }

      if (toolResults.length > 0) {
        finalContent += '\n\n**Tool Results:**\n' + toolResults.join('\n\n');
      }
    }

    setMessages(prev =>
      prev.map(msg =>
        msg.id === messageId ? { ...msg, content: finalContent, isLoading: false } : msg
      )
    );
  };

  // Handle standard chat without tools
  const handleStandardChat = async (model: any, conversationHistory: any[], messageId: string) => {
    const { textStream } = await streamText({
      model,
      messages: conversationHistory,
      temperature,
      maxTokens,
    });

    let streamedText = '';
    for await (const textChunk of textStream) {
      streamedText += textChunk;
      setMessages(prev =>
        prev.map(msg =>
          msg.id === messageId ? { ...msg, content: streamedText, isLoading: true } : msg
        )
      );
    }

    setMessages(prev =>
      prev.map(msg => (msg.id === messageId ? { ...msg, isLoading: false } : msg))
    );
  };

  // Handle chat errors with fallback responses
  const handleChatError = async (error: unknown, messageId: string) => {
    let errorMessage = '';
    if (error instanceof Error) {
      if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
        errorMessage = 'Connection timed out. The AI service might be unavailable.';
      } else if (error.message.includes('CONNECTION') || error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Cannot connect to AI service. Please check the endpoint configuration.';
      } else {
        errorMessage = `AI service error: ${error.message}`;
      }
    } else {
      errorMessage = 'Unknown error occurred while connecting to AI service.';
    }

    const fallbackResponses = [
      'I can help you with a wide range of technical questions or general inquiries.',
      'Feel free to ask about software development, troubleshooting, or best practices.',
      'What specific topic or problem would you like assistance with?',
    ];

    const fallbackContent = `${errorMessage}\n\n${
      fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)]
    }\n\n(Using fallback response - please check AI service configuration)`;

    setMessages(prev =>
      prev.map(msg =>
        msg.id === messageId ? { ...msg, content: fallbackContent, isLoading: false } : msg
      )
    );
  };

  const startPortForwardProcess = async () => {
    console.log('🔧 Starting AI model port forwarding...');
    setIsPortForwardRunning(true);
    setPortForwardStatus('Starting port forward...');

    try {
      if (!workspaceName) {
        throw new Error('Missing workspace name for port forwarding.');
      }

      // Resolve pod and port for the AI model service
      const resolved = await resolvePodAndPort(namespace, workspaceName);
      if (!resolved) {
        throw new Error(`Could not resolve pod or target port for workspace: ${workspaceName}`);
      }

      const { podName, targetPort } = resolved;
      const localPort = String(10000 + Math.floor(Math.random() * 10000));
      const portForwardId = `${workspaceName}/${namespace}`;

      console.log(`📡 Forwarding ${podName}:${targetPort} to localhost:${localPort}`);

      // Start port forwarding for AI model service
      await startWorkspacePortForward({
        namespace,
        workspaceName,
        podName,
        targetPort,
        localPort,
        portForwardId,
      });

      // Configure AI model endpoint
      const aiModelURL = `http://localhost:${localPort}/v1`;
      setBaseURL(aiModelURL);

      console.log('🤖 Loading available AI models...');
      try {
        const modelOptions = await fetchModelsWithRetry(localPort);
        setModels(modelOptions);
        if (modelOptions.length > 0) {
          setSelectedModel(prev => prev ?? modelOptions[0]);
          console.log('✅ AI models loaded:', modelOptions.map(m => m.title).join(', '));
        }
        setIsPortReady(true);
      } catch (err) {
        console.error('❌ Failed to fetch AI models:', err);
        setPortForwardStatus(
          `Model loading failed: ${err instanceof Error ? err.message : String(err)}`
        );
        setIsPortReady(false);
      }

      portForwardIdRef.current = portForwardId;
      setPortForwardStatus(`AI model ready on localhost:${localPort}`);
      console.log('🎉 AI model port forwarding complete');
    } catch (error) {
      console.error('❌ Port forward error:', error);
      setPortForwardStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setIsPortForwardRunning(false);
      setIsPortReady(false);
      portForwardIdRef.current = null;
    }
  };

  const stopAIPortForward = () => {
    const portForwardId = portForwardIdRef.current;
    if (!portForwardId) {
      console.log('🔌 No active port forward to stop');
      setIsPortForwardRunning(false);
      setPortForwardStatus('Port forward not running');
      return;
    }

    console.log('🛑 Stopping AI model port forward...');
    setPortForwardStatus('Stopping port forward...');
    setIsPortReady(false);
    setIsPortForwardRunning(false);
    portForwardIdRef.current = null;

    stopWorkspacePortForward(portForwardId)
      .then(() => {
        console.log('✅ Port forward stopped successfully');
        setPortForwardStatus('Port forward stopped');
        const stopMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: 'AI model connection stopped successfully.',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, stopMessage]);
      })
      .catch(error => {
        console.error(`❌ Failed to stop port forward:`, error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        setPortForwardStatus(`Error stopping: ${errorMsg}`);
        const errorMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: `Failed to stop AI model connection: ${errorMsg}`,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMessage]);
      });
  };

  const clearChat = () => {
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content:
          "Hello! I'm your AI assistant with access to MCP tools for enhanced capabilities. How can I help you today?",
        timestamp: new Date(),
      },
    ]);
  };

  // Initialize AI model port forwarding when chat opens
  useEffect(() => {
    if (!open || isPortForwardRunning || portForwardIdRef.current) {
      return; // Skip if dialog not open or port forward already active
    }

    console.log('🚀 Initializing AI model connection for chat...');
    startPortForwardProcess();
  }, [open]);

  useEffect(() => {
    if (!mcpDialogOpen) return;

    const loadMCPModels = async () => {
      try {
        const mcpModels = await fetchModelsFromAllMCPServers();
        setAvailableMCPModels(mcpModels);
      } catch (error) {
        console.error('Failed to load MCP models:', error);
        setAvailableMCPModels([]);
      }
    };
    loadMCPModels();
  }, [mcpDialogOpen]);

  const handleMCPModelSelect = (mcpModel: MCPModel) => {
    console.warn('⚠️ Legacy MCP Model Selection - This feature is deprecated');
    console.warn('   Please use MCP Context Integration instead for better tool management');
    console.log('📎 Adding legacy MCP server for backward compatibility:', mcpModel.serverName);

    // Legacy mode: Just add the server for tool access, don't change AI model
    // The selected AI model remains the primary inference engine
    setSelectedMCPModel(mcpModel);

    console.log('✅ Legacy MCP server configured for tool access only');
  };

  const renderChatContent = (
    messages: Message[],
    messagesEndRef: React.RefObject<HTMLDivElement>,
    inputRef: React.RefObject<HTMLDivElement>,
    input: string,
    handleInputChange: (e: React.FormEvent<HTMLDivElement>) => void,
    handleKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void,
    handleSend: () => void,
    handleChipClick: (text: string) => void,
    clearChat: () => void,
    theme: any,
    isLoading: boolean,
    isPortReady: boolean,
    models: { title: string; value: string }[],
    selectedModel: { title: string; value: string } | null,
    setSelectedModel: React.Dispatch<React.SetStateAction<{ title: string; value: string } | null>>
  ) => (
    <>
      <MessagesContainer>
        {messages.map(message => (
          <MessageBubble key={message.id} isUser={message.role === 'user'}>
            <Avatar
              sx={{
                width: 32,
                height: 32,
                bgcolor: message.role === 'user' ? '#3b82f6' : '#64748b',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: 'bold',
              }}
            >
              {message.role === 'user' ? '' : '🤖'}
            </Avatar>
            <MessageContent isUser={message.role === 'user'}>
              <Box
                sx={{
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'inherit',
                  fontSize: '14px',
                  fontWeight: 400,
                  '& p': { margin: 0, padding: 0 },
                  '& strong': { fontWeight: 600 },
                  '& em': { fontStyle: 'italic' },
                  '& code': {
                    backgroundColor:
                      message.role === 'user' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.05)',
                    padding: '2px 4px',
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                  },
                }}
              >
                <ReactMarkdown>{message.content}</ReactMarkdown>
                {message.isLoading && (
                  <span
                    style={{
                      display: 'inline-block',
                      width: '2px',
                      height: '18px',
                      backgroundColor: message.role === 'user' ? '#ffffff' : '#64748b',
                      marginLeft: '2px',
                      animation: 'blink 1s infinite',
                    }}
                  />
                )}
              </Box>
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  mt: 1,
                  opacity: 0.8,
                  fontSize: '11px',
                  color: 'inherit',
                }}
              >
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Typography>
            </MessageContent>
          </MessageBubble>
        ))}
        <div ref={messagesEndRef} />
      </MessagesContainer>
      <InputContainer
        sx={{
          background: theme.palette.background.default,
          color: theme.palette.primary.main,
        }}
      >
        <Stack direction="row" spacing={2} alignItems="flex-end" width="100%">
          <StyledInputBox
            onClick={() => inputRef.current?.focus()}
            sx={{
              flex: 1,
              backgroundColor: theme.palette.background.default,
              color: theme.palette.primary.main,
              border: `2px solid ${theme.palette.divider}`,
            }}
          >
            <Typography
              ref={inputRef}
              component="div"
              contentEditable
              suppressContentEditableWarning
              onInput={handleInputChange}
              onKeyDown={handleKeyDown}
              sx={{
                flex: 1,
                fontSize: '16px',
                fontWeight: 400,
                lineHeight: 1.5,
                color: input.trim() ? theme.palette.primary.main : theme.palette.text.secondary,
                outline: 'none',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                minHeight: '20px',
                '&:empty::before': {
                  content: '"Ask me a question..."',
                  color: theme.palette.text.secondary,
                  fontStyle: 'normal',
                },
              }}
            />
          </StyledInputBox>
          <SendButton onClick={handleSend} disabled={!input.trim() || isLoading || !isPortReady}>
            {isLoading ? <CircularProgress size={20} color="inherit" /> : '➤'}
          </SendButton>
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          mt={2}
          flexWrap="wrap"
          justifyContent="space-between"
          alignItems="center"
        >
          <Box display="flex" flexWrap="wrap" gap={1} color={theme.palette.primary.main}>
            <Chip
              label="What can you do?"
              size="small"
              variant="outlined"
              onClick={() => handleChipClick('What can you help me with?')}
              sx={{
                color: theme.palette.primary.main,
                borderColor: theme.palette.divider,
              }}
            />
            <Chip
              label="Deploy an app"
              size="small"
              variant="outlined"
              onClick={() => handleChipClick('How do I deploy an application?')}
              sx={{
                color: theme.palette.primary.main,
                borderColor: theme.palette.divider,
              }}
            />
            <Chip
              label="Troubleshoot issues"
              size="small"
              variant="outlined"
              onClick={() => handleChipClick('Can you help me troubleshoot a problem?')}
              sx={{
                color: theme.palette.primary.main,
                borderColor: theme.palette.divider,
              }}
            />
          </Box>
          <Tooltip title="Select a model">
            <Autocomplete
              options={models}
              getOptionLabel={opt => opt.title}
              value={selectedModel ?? null}
              onChange={(e, val) => {
                if (val) {
                  setSelectedModel(val);
                }
              }}
              sx={{
                width: '150px',
                '& .MuiInputBase-root': {
                  height: '32px',
                  color: theme.palette.primary.main,
                  backgroundColor: theme.palette.background.default,
                },
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: theme.palette.divider,
                },
              }}
              renderInput={params => (
                <TextField
                  {...params}
                  label="Model"
                  variant="outlined"
                  sx={{
                    '& .MuiInputLabel-root': {
                      fontSize: '12px',
                      color: theme.palette.primary.main,
                    },
                  }}
                />
              )}
            />
          </Tooltip>
        </Stack>
      </InputContainer>
    </>
  );

  if (embedded) {
    return (
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          background: theme.palette.background.default,
        }}
      >
        <Box
          sx={{
            width: '100%',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            p: 1,
            pb: 0,
          }}
        >
          <Stack direction="row" spacing={1}>
            <Tooltip
              title={
                mcpContextEnabled && selectedMCPServers.length > 0
                  ? `MCP Context Active (${selectedMCPServers.length} servers, ${mcpTools.length} tools)`
                  : 'MCP Context Off - Click to configure'
              }
            >
              <Chip
                label={
                  mcpContextEnabled && selectedMCPServers.length > 0
                    ? `MCP (${selectedMCPServers.length})`
                    : 'MCP OFF'
                }
                size="small"
                variant={mcpContextEnabled && selectedMCPServers.length > 0 ? 'filled' : 'outlined'}
                color={mcpContextEnabled && selectedMCPServers.length > 0 ? 'success' : 'default'}
                onClick={() => setMcpDialogOpen(true)}
                sx={{
                  fontSize: '9px',
                  height: '20px',
                  minWidth: '40px',
                  cursor: 'pointer',
                  '&:hover': {
                    backgroundColor:
                      mcpContextEnabled && selectedMCPServers.length > 0
                        ? 'success.light'
                        : 'grey.100',
                  },
                }}
              />
            </Tooltip>
            <Tooltip title="Model Settings">
              <IconButton
                onClick={() => setSettingsOpen(true)}
                size="small"
                sx={{
                  color: theme.palette.primary.main,
                  fontSize: '18px',
                  width: 32,
                  height: 32,
                  '&:hover': {
                    backgroundColor: theme.palette.action.hover,
                    color: theme.palette.primary.dark,
                    transform: 'scale(1.1)',
                  },
                  transition: 'all 0.2s ease',
                }}
                aria-label="Model Settings"
              >
                ⚙
              </IconButton>
            </Tooltip>
            <IconButton
              onClick={() => {
                stopAIPortForward();
                onClose?.();
              }}
              size="small"
              sx={{
                color: theme.palette.error.main,
                fontSize: '18px',
                width: 32,
                height: 32,
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  color: theme.palette.error.dark,
                  transform: 'scale(1.1)',
                },
                transition: 'all 0.2s ease',
              }}
              aria-label="Close chat"
            >
              ✕
            </IconButton>
          </Stack>
        </Box>

        {renderChatContent(
          messages,
          messagesEndRef,
          inputRef,
          input,
          handleInputChange,
          handleKeyDown,
          handleSend,
          handleChipClick,
          clearChat,
          theme,
          isLoading,
          isPortReady,
          models,
          selectedModel,
          setSelectedModel
        )}

        <ModelSettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          config={config}
          onSave={setConfig}
        />

        <Dialog
          open={mcpDialogOpen}
          onClose={() => setMcpDialogOpen(false)}
          maxWidth="md"
          fullWidth
          PaperProps={{
            sx: { borderRadius: '16px' },
          }}
        >
          <DialogTitle>
            <Typography variant="h5" fontWeight={600}>
              MCP Context Configuration
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Configure which MCP servers to use for context augmentation
            </Typography>
          </DialogTitle>
          <DialogContent>
            <MCPServerManager />

            <Box sx={{ mt: 3, p: 2, bgcolor: 'rgba(59, 130, 246, 0.05)', borderRadius: '8px' }}>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 2 }}
              >
                <Typography variant="h6">MCP Context Integration</Typography>
                <Button
                  variant={mcpContextEnabled ? 'contained' : 'outlined'}
                  color={mcpContextEnabled ? 'success' : 'primary'}
                  onClick={() => setMcpContextEnabled(!mcpContextEnabled)}
                  sx={{ minWidth: '120px' }}
                >
                  {mcpContextEnabled ? 'Enabled' : 'Enable'}
                </Button>
              </Stack>

              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                When enabled, the AI can use tools from selected MCP servers to enhance responses.
                Your chosen AI model will handle general queries while MCP tools augment responses
                when needed.
              </Typography>

              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                Select MCP Servers for Context:
              </Typography>

              <Autocomplete
                multiple
                options={availableMCPServers}
                value={selectedMCPServers}
                onChange={(event, newValue) => setSelectedMCPServers(newValue)}
                disabled={!mcpContextEnabled}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      color="primary"
                      size="small"
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
                renderInput={params => (
                  <TextField
                    {...params}
                    variant="outlined"
                    placeholder={
                      mcpContextEnabled
                        ? 'Select MCP servers...'
                        : 'Enable MCP context to select servers'
                    }
                    sx={{ mb: 2 }}
                  />
                )}
              />

              {mcpContextEnabled && selectedMCPServers.length > 0 && (
                <Box sx={{ mt: 2, p: 2, bgcolor: 'rgba(0, 0, 0, 0.05)', borderRadius: '8px' }}>
                  <Typography variant="body2" color="success.main" sx={{ fontWeight: 500 }}>
                    ✓ MCP Context Active: {selectedMCPServers.length} server
                    {selectedMCPServers.length > 1 ? 's' : ''} selected
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Available tools: {mcpTools.length}
                  </Typography>
                </Box>
              )}
            </Box>

            {/* Legacy MCP Models Section - Keep for backward compatibility */}
            {availableMCPModels.length > 0 && (
              <Box sx={{ mt: 3, p: 2, border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px' }}>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  Legacy: MCP Models (Deprecated)
                </Typography>
                <Typography variant="body2" color="warning.main" sx={{ mb: 2 }}>
                  ⚠️ This mode is deprecated. Use MCP Context Integration above instead.
                </Typography>
                <Stack spacing={1}>
                  {availableMCPModels.map((mcpModel, index) => (
                    <Box
                      key={`${mcpModel.serverName}-${mcpModel.id}-${index}`}
                      sx={{
                        p: 2,
                        border: '1px solid rgba(0,0,0,0.1)',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        bgcolor:
                          selectedMCPModel?.id === mcpModel.id
                            ? 'rgba(255, 193, 7, 0.1)'
                            : 'transparent',
                        '&:hover': {
                          bgcolor: 'rgba(255, 193, 7, 0.05)',
                        },
                      }}
                      onClick={() => {
                        console.log('MCP Model clicked:', mcpModel);
                        handleMCPModelSelect(mcpModel);
                        setMcpDialogOpen(false);
                        console.log('Dialog closed, MCP model should be selected');
                      }}
                    >
                      <Typography variant="subtitle1" fontWeight={600}>
                        {mcpModel.id}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Server: {mcpModel.serverName} | URL: {mcpModel.baseURL}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
          </DialogContent>
          <DialogActions sx={{ p: 2 }}>
            <Button onClick={() => setMcpDialogOpen(false)} variant="contained">
              Close
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }
  return (
    <ChatDialog
      open={open}
      onClose={() => {
        stopAIPortForward();
        if (onClose) onClose();
      }}
      maxWidth={false}
      PaperProps={{
        sx: { m: 2, background: theme.palette.background.paper },
      }}
    >
      <ChatHeader sx={{ background: theme.palette.background.default }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" width="100%">
          <Stack direction="row" alignItems="center" spacing={2}>
            {' '}
            <Avatar
              sx={{
                bgcolor: '#2563eb',
                width: 40,
                height: 40,
              }}
            >
              🤖
            </Avatar>
            <Box>
              <Typography variant="h6" fontWeight="600" color={theme.palette.text.primary}>
                Chat with {selectedModel?.title ?? 'Model'}
                {mcpContextEnabled && selectedMCPServers.length > 0 && (
                  <Chip
                    label={`+${selectedMCPServers.length} MCP`}
                    size="small"
                    color="success"
                    variant="outlined"
                    sx={{ ml: 1, fontSize: '10px', height: '20px' }}
                  />
                )}
                {selectedMCPModel && (
                  <Chip
                    label={`+${selectedMCPModel.serverName} (Legacy)`}
                    size="small"
                    color="warning"
                    variant="outlined"
                    sx={{ ml: 1, fontSize: '10px', height: '20px' }}
                  />
                )}
              </Typography>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: isPortForwardRunning ? '#10b981' : '#f59e0b',
                    animation: 'pulse 2s infinite',
                    '@keyframes pulse': {
                      '0%, 100%': { opacity: 1 },
                      '50%': { opacity: 0.5 },
                    },
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  {isPortForwardRunning ? 'AI Model Connected' : 'Connecting to AI Model...'}
                  {mcpContextEnabled && selectedMCPServers.length > 0 && (
                    <> • {mcpTools.length} MCP tools ready</>
                  )}
                  {selectedMCPModel && <> • Legacy: {selectedMCPModel.serverName}</>}
                </Typography>
              </Stack>
            </Box>
          </Stack>{' '}
          <Stack direction="row" spacing={1}>
            <Tooltip
              title={
                mcpContextEnabled && selectedMCPServers.length > 0
                  ? `MCP Context Active (${selectedMCPServers.length} servers, ${mcpTools.length} tools)`
                  : 'MCP Context Off - Click to configure'
              }
            >
              <Chip
                label={
                  mcpContextEnabled && selectedMCPServers.length > 0
                    ? `MCP (${selectedMCPServers.length})`
                    : 'MCP OFF'
                }
                size="small"
                variant={mcpContextEnabled && selectedMCPServers.length > 0 ? 'filled' : 'outlined'}
                color={mcpContextEnabled && selectedMCPServers.length > 0 ? 'success' : 'default'}
                onClick={() => setMcpDialogOpen(true)}
                sx={{
                  fontSize: '10px',
                  height: '24px',
                  cursor: 'pointer',
                  '&:hover': {
                    backgroundColor:
                      mcpContextEnabled && selectedMCPServers.length > 0
                        ? 'success.light'
                        : 'grey.100',
                  },
                }}
              />
            </Tooltip>
            <Tooltip title="Model Settings">
              <IconButton onClick={() => setSettingsOpen(true)} size="small">
                ⚙️
              </IconButton>
            </Tooltip>
            <Tooltip title="Clear conversation">
              <IconButton onClick={clearChat} size="small">
                🗑️
              </IconButton>
            </Tooltip>
            <Tooltip title="Close chat">
              <IconButton
                onClick={() => {
                  stopAIPortForward();
                  onClose?.();
                }}
                size="small"
                sx={{
                  color: '#ef4444',
                  fontSize: '18px',
                  width: 32,
                  height: 32,
                  '&:hover': {
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    color: '#dc2626',
                    transform: 'scale(1.1)',
                  },
                  transition: 'all 0.2s ease',
                }}
              >
                ✕
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </ChatHeader>

      <DialogContent
        sx={{
          p: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: theme.palette.background.default,
        }}
      >
        {renderChatContent(
          messages,
          messagesEndRef,
          inputRef,
          input,
          handleInputChange,
          handleKeyDown,
          handleSend,
          handleChipClick,
          clearChat,
          theme,
          isLoading,
          isPortReady,
          models,
          selectedModel,
          setSelectedModel
        )}
      </DialogContent>

      {/* MCP Server Management Dialog */}
      <Dialog
        open={mcpDialogOpen}
        onClose={() => setMcpDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: { borderRadius: '16px' },
        }}
      >
        <DialogContent sx={{ p: 0 }}>
          <MCPServerManager />
          <Box sx={{ p: 2, borderTop: '1px solid rgba(0,0,0,0.1)' }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Available MCP Models
            </Typography>
            {availableMCPModels.length > 0 ? (
              <Stack spacing={1}>
                {availableMCPModels.map((mcpModel, index) => (
                  <Box
                    key={`${mcpModel.serverName}-${mcpModel.id}-${index}`}
                    sx={{
                      p: 2,
                      border: '1px solid rgba(0,0,0,0.1)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      bgcolor:
                        selectedMCPModel?.id === mcpModel.id
                          ? 'rgba(59, 130, 246, 0.1)'
                          : 'transparent',
                      '&:hover': {
                        bgcolor: 'rgba(59, 130, 246, 0.05)',
                      },
                    }}
                    onClick={() => {
                      console.log('MCP Model clicked:', mcpModel);
                      handleMCPModelSelect(mcpModel);
                      setMcpDialogOpen(false);
                      console.log('Dialog closed, MCP model should be selected');
                    }}
                  >
                    <Typography variant="subtitle1" fontWeight={600}>
                      {mcpModel.id}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Server: {mcpModel.serverName} | URL: {mcpModel.baseURL}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            ) : (
              <Typography color="text.secondary">
                No MCP models available. Add MCP servers above to see available models.
              </Typography>
            )}
          </Box>
        </DialogContent>
      </Dialog>

      <ModelSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        onSave={setConfig}
      />
    </ChatDialog>
  );
};

const ChatFAB: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  return (
    <Fab
      onClick={onClick}
      sx={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
        color: '#ffffff',
        width: 64,
        height: 64,
        boxShadow: '0 8px 32px rgba(59, 130, 246, 0.3)',
        '&:hover': {
          transform: 'scale(1.1)',
          boxShadow: '0 12px 40px rgba(59, 130, 246, 0.4)',
        },
        transition: 'all 0.3s ease',
        zIndex: 1000,
      }}
    >
      <Typography fontSize={24}>🤖</Typography>
    </Fab>
  );
};

const ChatWithFAB: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ChatFAB onClick={() => setOpen(true)} />
      <ChatUI open={open} onClose={() => setOpen(false)} namespace="default" />
    </>
  );
};

// Helper functions for MCP tools management

/**
 * Load MCP tools from selected servers for chat augmentation
 * @param selectedServers Array of server names to load tools from
 * @returns Array of tool definitions compatible with AI SDK
 */
async function getMCPToolsForChat(selectedServers?: string[]): Promise<any[]> {
  try {
    console.log('🔧 Loading MCP tools from servers:', selectedServers);

    const servers = loadMCPServers();
    const filteredServers = selectedServers
      ? servers.filter(server => selectedServers.includes(server.name))
      : servers;

    if (filteredServers.length === 0) {
      console.log('📭 No MCP servers configured or selected');
      return [];
    }

    const allTools: any[] = [];

    for (const server of filteredServers) {
      try {
        console.log(`🔌 Connecting to MCP server: ${server.name} at ${server.url}`);
        
        let tools: any[] = [];
        
        // Check if this is an OP.GG or other HTTP-based MCP server
        if (server.url.includes('mcp-api.op.gg') || server.url.includes('/tools')) {
          tools = await loadToolsFromHttpMCP(server);
        } else {
          tools = await loadToolsFromSSEMCP(server);
        }
        
        if (tools.length === 0) {
          console.log(`📭 No tools available from ${server.name}`);
          continue;
        }

        // Convert to AI SDK format
        tools.forEach(tool => {
          const aiTool = {
            serverName: server.name,
            originalName: tool.name,
            serverUrl: server.url,
            function: {
              name: `${server.name}_${tool.name}`,
              description: tool.description || `Tool ${tool.name} from ${server.name}`,
              parameters: tool.inputSchema || {},
            },
          };
          
          allTools.push(aiTool);
          console.log(`✅ Loaded tool: ${aiTool.function.name}`);
        });
        
        console.log(`🎉 Successfully loaded ${tools.length} tools from ${server.name}`);
      } catch (error) {
        console.error(`❌ Failed to connect to MCP server ${server.name}:`, error);
        // Continue with other servers even if one fails
      }
    }

    console.log(`🔧 Total MCP tools loaded: ${allTools.length}`);
    return allTools;
  } catch (error) {
    console.error('❌ Critical error loading MCP tools:', error);
    return [];
  }
}

/**
 * Execute an MCP tool with proper error handling
 * @param toolName The original tool name (without server prefix)
 * @param serverName The name of the MCP server
 * @param args The arguments to pass to the tool
 * @returns Tool execution result
 */
async function executeMCPToolFromChat(
  toolName: string,
  serverName: string,
  args: any
): Promise<any> {
  try {
    console.log(`⚙️ Executing MCP tool: ${toolName} on server: ${serverName}`);
    console.log('📥 Tool arguments:', args);

    // For now, return a structured mock response
    // In a real implementation, this would call the actual MCP tool
    const result = {
      success: true,
      tool: toolName,
      server: serverName,
      timestamp: new Date().toISOString(),
      message: `Tool ${toolName} executed successfully on ${serverName}`,
      arguments: args,
      result: `Mock result for ${toolName} - this would contain actual tool output`,
      // TODO: Replace with actual MCP tool execution
    };

    console.log('✅ Tool execution completed:', result);
    return result;
  } catch (error) {
    console.error(`❌ MCP tool execution failed: ${toolName}@${serverName}:`, error);
    throw new Error(
      `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export default ChatUI;
export { ChatWithFAB };
