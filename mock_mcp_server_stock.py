#http://localhost:8082
from flask import Flask, request, jsonify
import requests
import time
import re
from datetime import datetime, timedelta

app = Flask(__name__)

# Add CORS headers manually
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

@app.route('/v1/models', methods=['GET', 'OPTIONS'])
def models():
    print("/v1/models endpoint called")
    if request.method == 'OPTIONS':
        return '', 200
    return jsonify({
        "object": "list",
        "data": [
            {"id": "stock-market-agent", "object": "model", "owned_by": "stock-local"}
        ]
    })

@app.route('/v1/chat/completions', methods=['POST', 'OPTIONS'])
def completions():
    print("/v1/chat/completions endpoint called!")
    if request.method == 'OPTIONS':
        return '', 200
    
    data = request.json
    print(f"Received data: {data}")
    
    stream = data.get('stream', False)
    print(f"Stream requested: {stream}")
    
    messages = data.get('messages', [])
    user_messages = [msg for msg in messages if msg.get('role') == 'user']
    
    if not user_messages:
        return wrap_reply("Hello! I'm your Stock Market Agent. Ask me about stock prices, market performance, or company information. For example: 'What's the price of AAPL?' or 'Summarize Tesla's recent performance.'")
    
    last_message = user_messages[-1].get('content', '').strip()
    print(f"Raw user message: {last_message}")
    
    # Extract stock symbol and query type
    symbol, query_type = parse_stock_query(last_message)
    
    if not symbol:
        return wrap_reply("I couldn't identify a stock symbol in your query. Please specify a stock ticker (e.g., AAPL, TSLA, MSFT) or company name.")
    
    try:
        stock_data = get_stock_data(symbol)
        if not stock_data:
            return wrap_reply(f"Sorry, I couldn't find stock data for '{symbol}'. Please make sure the symbol is correct.")
        
        reply = format_stock_response(stock_data, symbol, query_type, last_message)
        
    except Exception as e:
        print(f"Stock data fetch failed: {e}")
        reply = f"Sorry, I encountered an error while fetching stock data for '{symbol}'. Please try again later."
    
    if stream:
        return stream_reply(reply)
    else:
        return wrap_reply(reply)

def parse_stock_query(message):
    """Parse the user message to extract stock symbol and query type"""
    message_lower = message.lower()
    
    # Common stock symbols
    stock_patterns = [
        r'\b([A-Z]{1,5})\b',  # Standard ticker symbols
        r'\bapple\b|\baapl\b',
        r'\btesla\b|\btsla\b',
        r'\bmicrosoft\b|\bmsft\b',
        r'\bgoogle\b|\bamazon\b|\bamzn\b|\bgoogl\b',
        r'\bnvidia\b|\bnvda\b',
        r'\bmeta\b|\bmeta\b',
        r'\bnetflix\b|\bnflx\b'
    ]
    
    symbol = None
    
    # Try to extract ticker symbol
    ticker_match = re.search(r'\b([A-Z]{2,5})\b', message)
    if ticker_match:
        symbol = ticker_match.group(1)
    else:
        # Try company name mapping
        company_map = {
            'apple': 'AAPL',
            'tesla': 'TSLA',
            'microsoft': 'MSFT',
            'google': 'GOOGL',
            'alphabet': 'GOOGL',
            'amazon': 'AMZN',
            'nvidia': 'NVDA',
            'meta': 'META',
            'facebook': 'META',
            'netflix': 'NFLX',
            'spotify': 'SPOT',
            'uber': 'UBER',
            'zoom': 'ZM',
            'slack': 'WORK',
            'palantir': 'PLTR'
        }
        
        for company, ticker in company_map.items():
            if company in message_lower:
                symbol = ticker
                break
    
    # Determine query type
    query_type = 'price'  # default
    if any(word in message_lower for word in ['performance', 'summary', 'analysis', 'recent']):
        query_type = 'performance'
    elif any(word in message_lower for word in ['news', 'update', 'latest']):
        query_type = 'news'
    elif any(word in message_lower for word in ['chart', 'graph', 'trend']):
        query_type = 'trend'
    
    print(f"📈 Extracted symbol: '{symbol}', query type: '{query_type}'")
    return symbol, query_type

def get_stock_data(symbol):
    """Fetch stock data using a free API"""
    try:
        # Using Alpha Vantage demo API (replace with actual API key for production)
        # For demo purposes, we'll use a mock response or try Yahoo Finance alternative
        
        # Try Yahoo Finance API alternative (free)
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        response = requests.get(url, headers=headers, timeout=10)
        data = response.json()
        
        if 'chart' not in data or not data['chart']['result']:
            return None
        
        result = data['chart']['result'][0]
        meta = result['meta']
        
        # Get current price
        current_price = meta.get('regularMarketPrice', 0)
        previous_close = meta.get('previousClose', 0)
        change = current_price - previous_close
        change_percent = (change / previous_close * 100) if previous_close else 0
        
        # Get additional info
        market_cap = meta.get('marketCap', 'N/A')
        currency = meta.get('currency', 'USD')
        
        stock_info = {
            'symbol': symbol,
            'current_price': current_price,
            'previous_close': previous_close,
            'change': change,
            'change_percent': change_percent,
            'currency': currency,
            'market_cap': market_cap,
            'exchange': meta.get('exchangeName', 'Unknown'),
            'company_name': meta.get('longName', symbol)
        }
        
        return stock_info
        
    except Exception as e:
        print(f"Error fetching stock data: {e}")
        # Return mock data as fallback
        return get_mock_stock_data(symbol)

def get_mock_stock_data(symbol):
    """Return mock stock data for demonstration"""
    import random
    
    mock_prices = {
        'AAPL': {'price': 180.50, 'name': 'Apple Inc.'},
        'TSLA': {'price': 245.30, 'name': 'Tesla, Inc.'},
        'MSFT': {'price': 420.80, 'name': 'Microsoft Corporation'},
        'GOOGL': {'price': 142.65, 'name': 'Alphabet Inc.'},
        'AMZN': {'price': 155.20, 'name': 'Amazon.com Inc.'},
        'NVDA': {'price': 875.45, 'name': 'NVIDIA Corporation'},
        'META': {'price': 485.90, 'name': 'Meta Platforms Inc.'},
        'NFLX': {'price': 485.25, 'name': 'Netflix Inc.'}
    }
    
    base_info = mock_prices.get(symbol, {'price': 100.00, 'name': f'{symbol} Corp'})
    
    # Add some random variation
    current_price = base_info['price'] + random.uniform(-5, 5)
    previous_close = current_price + random.uniform(-3, 3)
    change = current_price - previous_close
    change_percent = (change / previous_close * 100) if previous_close else 0
    
    return {
        'symbol': symbol,
        'current_price': round(current_price, 2),
        'previous_close': round(previous_close, 2),
        'change': round(change, 2),
        'change_percent': round(change_percent, 2),
        'currency': 'USD',
        'market_cap': 'N/A (Mock)',
        'exchange': 'NASDAQ',
        'company_name': base_info['name']
    }

def format_stock_response(stock_data, symbol, query_type, original_message):
    """Format the response based on the query type"""
    
    company_name = stock_data['company_name']
    current_price = stock_data['current_price']
    change = stock_data['change']
    change_percent = stock_data['change_percent']
    currency = stock_data['currency']
    
    # Format change indicator
    change_indicator = "📈" if change >= 0 else "📉"
    change_sign = "+" if change >= 0 else ""
    
    if query_type == 'performance':
        response = f"""📊 **{company_name} ({symbol}) Performance Summary**

💰 **Current Price**: {currency} {current_price:,.2f}
{change_indicator} **Daily Change**: {change_sign}{change:.2f} ({change_sign}{change_percent:.2f}%)

📈 **Recent Performance Analysis**:
- The stock is currently {'gaining' if change >= 0 else 'declining'} today
- Trading at {currency} {current_price:,.2f} per share
- {'Positive momentum' if change >= 0 else 'Experiencing some selling pressure'} in recent trading

🏢 **Company**: {company_name}
🏛️ **Exchange**: {stock_data.get('exchange', 'N/A')}
💎 **Market Cap**: {stock_data.get('market_cap', 'N/A')}

*Data is for informational purposes only and should not be considered as investment advice.*"""

    elif query_type == 'news':
        response = f"""📰 **Latest Updates for {company_name} ({symbol})**

💰 **Current Price**: {currency} {current_price:,.2f} ({change_sign}{change_percent:.2f}%)

📊 **Market Activity**:
- Stock is {'up' if change >= 0 else 'down'} {abs(change_percent):.2f}% today
- Trading volume appears {'healthy' if abs(change_percent) < 3 else 'elevated'}
- Current trend shows {'bullish' if change >= 0 else 'bearish'} sentiment

*For detailed news and analysis, please check financial news sources like Bloomberg, Reuters, or Yahoo Finance.*"""

    else:  # Default price query
        response = f"""💰 **{company_name} ({symbol}) Stock Price**

**Current Price**: {currency} {current_price:,.2f}
{change_indicator} **Change**: {change_sign}{change:.2f} ({change_sign}{change_percent:.2f}%)
**Previous Close**: {currency} {stock_data['previous_close']:,.2f}

📊 **Market Status**: {'Gaining value' if change >= 0 else 'Losing value'} today
🏛️ **Exchange**: {stock_data.get('exchange', 'N/A')}

*Real-time data may have slight delays. Always verify with official financial sources for trading decisions.*"""

    return response

def stream_reply(reply: str):
    from flask import Response
    import json
    
    def generate():
        # Split reply into chunks for streaming effect
        words = reply.split(' ')
        chunk_size = 5
        
        for i in range(0, len(words), chunk_size):
            chunk_content = ' '.join(words[i:i + chunk_size])
            if i + chunk_size < len(words):
                chunk_content += ' '
            
            chunk = {
                "id": "chatcmpl-stock-" + str(int(time.time() * 1000)),
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": "stock-market-agent",
                "choices": [
                    {
                        "index": 0,
                        "delta": {"content": chunk_content},
                        "finish_reason": None
                    }
                ]
            }
            yield f"data: {json.dumps(chunk)}\n\n"
            time.sleep(0.05)  # Small delay for streaming effect
        
        finish_chunk = {
            "id": "chatcmpl-stock-" + str(int(time.time() * 1000)),
            "object": "chat.completion.chunk", 
            "created": int(time.time()),
            "model": "stock-market-agent",
            "choices": [
                {
                    "index": 0,
                    "delta": {},
                    "finish_reason": "stop"
                }
            ]
        }
        yield f"data: {json.dumps(finish_chunk)}\n\n"
        yield "data: [DONE]\n\n"
    
    print(f"📈 Sending streaming stock response: {reply[:50]}...")
    return Response(generate(), mimetype='text/event-stream')

def wrap_reply(reply: str):
    print(f"Sending stock response: {reply[:50]}...")
    return jsonify({
        "id": "chatcmpl-stock-" + str(int(time.time() * 1000)),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "stock-market-agent",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": reply},
                "finish_reason": "stop"
            }
        ],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": len(reply.split()),
            "total_tokens": 10 + len(reply.split())
        }
    })

if __name__ == '__main__':
    print("🚀 Starting Stock Market MCP Server on port 8082...")
    print("📈 Available endpoints:")
    print("   GET  http://localhost:8082/v1/models")
    print("   POST http://localhost:8082/v1/chat/completions")
    print("\n🔧 To register in Headlamp:")
    print("   1. Open Headlamp MCP Server Manager")
    print("   2. Add server with URL: http://localhost:8082")
    print("   3. Select 'stock-market-agent' model in chat")
    print("   - 'What's the price of AAPL today?'")
    print("   - 'Summarize Tesla's recent performance'")
    print("   - 'How is Microsoft stock doing?'")
    print("   - 'Give me Google stock price'")
    print("=" * 60)
    app.run(host='0.0.0.0', port=8082, debug=True)
