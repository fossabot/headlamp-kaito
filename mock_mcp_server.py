from flask import Flask, jsonify

app = Flask(__name__)

@app.route("/v1/models", methods=["GET"])
def list_models():
    return jsonify({
        "object": "list",
        "data": [
            {
                "id": "mock-model-1",
                "object": "model",
                "created": 1724799420,
                "owned_by": "mock-org"
            }
        ]
    })

if __name__ == "__main__":
    app.run(port=8080)
