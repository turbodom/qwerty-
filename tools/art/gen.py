"""Generates the raw game pictures with the xAI image API (Grok).

Usage: XAI_API_KEY=... python3 gen.py prompts.json [name ...]
Writes raw/<name>.jpg next to this file and skips pictures that already exist.
Then run proc.cjs to cut out the backgrounds and write packages/client/public/art/*.webp.
"""
import json, base64, os, sys, urllib.request, concurrent.futures as cf, time
KEY = os.environ["XAI_API_KEY"]
D = os.path.dirname(os.path.abspath(__file__))
STYLE = "Photorealistic cinematic post-apocalyptic AAA game art, gritty realistic materials, rust, concrete, worn military gear, dramatic warm lighting, highly detailed, no text, no letters, no watermark."
SPRITE = " A single object centered, fully visible with margin around it, isometric three-quarter top-down view like a strategy game, isolated on a perfectly flat solid pure magenta (#FF00FF) background, no ground, no cast shadow on the background, no frame, no border."
UNIT = " Full body character, standing in a combat pose, facing right, three-quarter side view, fully visible with margin around it, isolated on a perfectly flat solid pure magenta (#FF00FF) background, no ground, no cast shadow on the background, no frame."
ICON = " Game inventory icon, a single object centered filling most of the square, isolated on a perfectly flat solid pure magenta (#FF00FF) background, no frame, no border."
def gen(item):
    name, prompt, ar = item["name"], item["prompt"], item.get("ar", "1:1")
    kind = item.get("kind", "sprite")
    out = os.path.join(D, "raw", name + ".jpg")
    if os.path.exists(out): return name + " skip"
    full = STYLE + " " + prompt + (SPRITE if kind == "sprite" else UNIT if kind == "unit" else ICON if kind == "icon" else "")
    body = json.dumps({"model": item.get("model", "grok-imagine-image"), "prompt": full, "n": 1, "response_format": "b64_json", "aspect_ratio": ar}).encode()
    for attempt in range(3):
        try:
            req = urllib.request.Request("https://api.x.ai/v1/images/generations", body, {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
            d = json.load(urllib.request.urlopen(req, timeout=240))
            open(out, "wb").write(base64.b64decode(d["data"][0]["b64_json"]))
            return name + " ok"
        except Exception as e:
            err = e.read().decode()[:200] if hasattr(e, "read") else str(e)
            time.sleep(3)
    return name + " FAIL " + err
items = json.load(open(sys.argv[1]))
only = set(sys.argv[2:])
if only: items = [i for i in items if i["name"] in only]
with cf.ThreadPoolExecutor(6) as ex:
    for r in ex.map(gen, items): print(r, flush=True)
