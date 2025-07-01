#!/usr/bin/env python3
"""
Simple STDIO MCP Server for testing
This server communicates via stdin/stdout using the MCP protocol
"""

import json
import sys
import logging

# Setup logging to stderr so it doesn't interfere with MCP communication
logging.basicConfig(level=logging.DEBUG, stream=sys.stderr)
logger = logging.getLogger(__name__)

def send_message(message):
    """Send a message via stdout"""
    json_str = json.dumps(message)
    print(json_str, flush=True)
    logger.debug(f"Sent: {json_str}")

def read_message():
    """Read a message from stdin"""
    try:
        line = sys.stdin.readline().strip()
        if not line:
            return None
        message = json.loads(line)
        logger.debug(f"Received: {line}")
        return message
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error: {e}")
        return None

def handle_initialize(params):
    """Handle initialize request"""
    return {
        "jsonrpc": "2.0",
        "result": {
            "serverInfo": {
                "name": "test-stdio-mcp-server",
                "version": "1.0.0"
            },
            "capabilities": {
                "tools": {
                    "listChanged": False
                }
            }
        }
    }

def handle_tools_list(params):
    """Handle tools/list request"""
    return {
        "jsonrpc": "2.0",
        "result": {
            "tools": [
                {
                    "name": "echo",
                    "description": "Echo back the input text",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "text": {
                                "type": "string",
                                "description": "Text to echo back"
                            }
                        },
                        "required": ["text"]
                    }
                },
                {
                    "name": "random_number",
                    "description": "Generate a random number",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "min": {
                                "type": "integer",
                                "description": "Minimum value",
                                "default": 1
                            },
                            "max": {
                                "type": "integer", 
                                "description": "Maximum value",
                                "default": 100
                            }
                        }
                    }
                }
            ]
        }
    }

def handle_tools_call(params):
    """Handle tools/call request"""
    import random
    
    tool_name = params.get("name")
    arguments = params.get("arguments", {})
    
    if tool_name == "echo":
        text = arguments.get("text", "")
        return {
            "jsonrpc": "2.0",
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": f"Echo: {text}"
                    }
                ]
            }
        }
    elif tool_name == "random_number":
        min_val = arguments.get("min", 1)
        max_val = arguments.get("max", 100)
        number = random.randint(min_val, max_val)
        return {
            "jsonrpc": "2.0",
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": f"Random number between {min_val} and {max_val}: {number}"
                    }
                ]
            }
        }
    else:
        return {
            "jsonrpc": "2.0",
            "error": {
                "code": -32601,
                "message": f"Unknown tool: {tool_name}"
            }
        }

def main():
    """Main server loop"""
    logger.info("STDIO MCP Server starting...")
    
    while True:
        try:
            message = read_message()
            if message is None:
                break
                
            method = message.get("method")
            params = message.get("params", {})
            msg_id = message.get("id")
            
            logger.info(f"Handling method: {method}")
            
            if method == "initialize":
                response = handle_initialize(params)
            elif method == "tools/list":
                response = handle_tools_list(params)
            elif method == "tools/call":
                response = handle_tools_call(params)
            else:
                response = {
                    "jsonrpc": "2.0",
                    "error": {
                        "code": -32601,
                        "message": f"Method not found: {method}"
                    }
                }
            
            if msg_id is not None:
                response["id"] = msg_id
                
            send_message(response)
            
        except KeyboardInterrupt:
            logger.info("Server interrupted")
            break
        except Exception as e:
            logger.error(f"Error: {e}")
            break
    
    logger.info("STDIO MCP Server stopping...")

if __name__ == "__main__":
    main()
