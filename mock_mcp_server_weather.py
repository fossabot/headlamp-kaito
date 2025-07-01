#http://localhost:8081
from flask import Flask, request, jsonify
import requests
import time

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
            {"id": "weather-bot", "object": "model", "owned_by": "weather-local"}
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
        city = "Seattle" 
    else:
        last_message = user_messages[-1].get('content', '').lower().strip()
        print(f"Raw user message: {last_message}")
        
        import re
        
        match = re.search(r'weather\s+in\s+([a-zA-Z\s]+)', last_message)
        if match:
            city = match.group(1).strip()
        elif 'weather for' in last_message:
            match = re.search(r'weather\s+for\s+([a-zA-Z\s]+)', last_message)
            if match:
                city = match.group(1).strip()
        elif 'weather' in last_message and ' in ' in last_message:
            match = re.search(r'weather.*?in\s+([a-zA-Z\s]+)', last_message)
            if match:
                city = match.group(1).strip()
        elif 'weather' in last_message:
            cleaned = re.sub(r'\b(weather|today|tomorrow|forecast|current|now|what|is|the|in)\b', '', last_message)
            cleaned = cleaned.strip()
            if cleaned:
                city = cleaned
            else:
                city = "Seattle"
        else:
            city = last_message
        
        city = re.sub(r'[^\w\s]', '', city).strip()
        if not city or len(city) < 2:
            city = "Seattle"
        
        print(f"🏙️ Extracted city: '{city}'")

    try:
        geo_url = f"https://nominatim.openstreetmap.org/search?q={city}&format=json&limit=1"
        geo_headers = {"User-Agent": "weather-bot/1.0"}
        geo_data = requests.get(geo_url, headers=geo_headers, timeout=10).json()

        if not geo_data:
            return wrap_reply(f"Sorry, I couldn't find the location '{city}'.")

        lat = geo_data[0]['lat']
        lon = geo_data[0]['lon']
        print(f"Lat/Lon = {lat}, {lon}")
    except Exception as e:
        print("Geocoding failed:", e)
        return wrap_reply(f"Sorry, I couldn't find the location '{city}'.")

    try:
        points_data = requests.get(f"https://api.weather.gov/points/{lat},{lon}", timeout=10).json()
        forecast_url = points_data['properties']['forecast']
        forecast_data = requests.get(forecast_url, timeout=10).json()
        forecast = forecast_data['properties']['periods'][0]['detailedForecast']
        reply = f"The forecast for {city} is: {forecast}"
    except Exception as e:
        print("Weather fetch failed:", e)
        reply = f"Sorry, I couldn't fetch the weather forecast for '{city}'."

    if stream:
        return stream_reply(reply)
    else:
        return wrap_reply(reply)

def stream_reply(reply: str):
    from flask import Response
    import json
    
    def generate():
        chunk = {
            "id": "chatcmpl-weather-" + str(int(time.time() * 1000)),
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": "weather-bot",
            "choices": [
                {
                    "index": 0,
                    "delta": {"role": "assistant", "content": reply},
                    "finish_reason": None
                }
            ]
        }
        yield f"data: {json.dumps(chunk)}\n\n"
        
        finish_chunk = {
            "id": "chatcmpl-weather-" + str(int(time.time() * 1000)),
            "object": "chat.completion.chunk", 
            "created": int(time.time()),
            "model": "weather-bot",
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
    
    print(f"🌊 Sending streaming weather response: {reply[:50]}...")
    return Response(generate(), mimetype='text/event-stream')

def wrap_reply(reply: str):
    print(f"Sending weather response: {reply[:50]}...")
    return jsonify({
        "id": "chatcmpl-weather-" + str(int(time.time() * 1000)),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "weather-bot",
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
    print("🚀 Starting Weather MCP Server on port 8081...")
    print("📡 Available endpoints:")
    print("   GET  http://localhost:8081/v1/models")
    print("   POST http://localhost:8081/v1/chat/completions")
    print("\n🔧 To register in Headlamp:")
    print("   1. Open Headlamp MCP Server Manager")
    print("   2. Add server with URL: http://localhost:8081")
    print("   3. Select 'weather-bot' model in chat")
    print("\n👀 Watch this terminal for request logs...")
    print("=" * 60)
    app.run(host='0.0.0.0', port=8081, debug=True)
