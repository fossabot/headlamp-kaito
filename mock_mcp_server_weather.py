from flask import Flask, request, jsonify
import requests

app = Flask(__name__)

@app.route('/v1/models', methods=['GET'])
def models():
    return jsonify({
        "object": "list",
        "data": [
            {"id": "weather-bot", "object": "model", "owned_by": "weather-local"}
        ]
    })

@app.route('/v1/chat/completions', methods=['POST'])
def completions():
    data = request.json
    city = data['messages'][-1]['content']
    print(f"📥 Received city: {city}")

    try:
        geo_url = f"https://nominatim.openstreetmap.org/search?q={city}&format=json&limit=1"
        geo_headers = {"User-Agent": "weather-bot/1.0"}
        geo_data = requests.get(geo_url, headers=geo_headers, timeout=10).json()

        if not geo_data:
            return wrap_reply(f"Sorry, I couldn't find the location '{city}'.")

        lat = geo_data[0]['lat']
        lon = geo_data[0]['lon']
        print(f"📍 Lat/Lon = {lat}, {lon}")
    except Exception as e:
        print("❌ Geocoding failed:", e)
        return wrap_reply(f"Sorry, I couldn't find the location '{city}'.")

    try:
        points_data = requests.get(f"https://api.weather.gov/points/{lat},{lon}", timeout=10).json()
        forecast_url = points_data['properties']['forecast']
        forecast_data = requests.get(forecast_url, timeout=10).json()
        forecast = forecast_data['properties']['periods'][0]['detailedForecast']
        reply = f"The forecast for {city} is: {forecast}"
    except Exception as e:
        print("❌ Weather fetch failed:", e)
        reply = f"Sorry, I couldn't fetch the weather forecast for '{city}'."

    return wrap_reply(reply)

def wrap_reply(reply: str):
    return jsonify({
        "id": "chatcmpl-weather",
        "object": "chat.completion",
        "created": 0,
        "model": "weather-bot",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": reply},
                "finish_reason": "stop"
            }
        ]
    })

if __name__ == '__main__':
    app.run(port=8081)
