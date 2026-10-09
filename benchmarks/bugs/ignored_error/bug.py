import json

def load_port(text: str) -> int | None:
    try:
        return int(json.loads(text)["port"])
    except (ValueError, KeyError):
        return None

port = load_port('{"host": "x"}')
print(f"listening on {port + 1}")
