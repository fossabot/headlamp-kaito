# from flask import Flask, jsonify, request
# import requests

# app = Flask(__name__)

# @app.route('/v1/models', methods=['GET'])
# def models():
#     return jsonify({
#         "object": "list",
#         "data": [
#             {"id": "weather-bot", "object": "model", "owned_by": "weather-proxy"}
#         ]
#     })

# @app.route('/v1/chat/completions', methods=['POST'])
# def completions():
#     data = request.json
#     city = data['messages'][-1]['content']
#     weather_api_key = 'YOUR_OPENWEATHERMAP_KEY'
#     url = f'https://api.openweathermap.org/data/2.5/weather?q={city}&appid={weather_api_key}&units=metric'

#     try:
#         weather = requests.get(url).json()
#         desc = weather['weather'][0]['description']
#         temp = weather['main']['temp']
#         reply = f"The current weather in {city} is {desc} with a temperature of {temp}°C."
#     except:
#         reply = f"Sorry, I couldn't fetch weather data for '{city}'."

#     return jsonify({
#         "id": "chatcmpl-weather",
#         "object": "chat.completion",
#         "created": 0,
#         "model": "weather-bot",
#         "choices": [
#             {
#                 "index": 0,
#                 "message": {"role": "assistant", "content": reply},
#                 "finish_reason": "stop"
#             }
#         ]
#     })

# if __name__ == '__main__':
#     app.run(port=8081)
