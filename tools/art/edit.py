"""Repaints an image with the xAI image edit API (Grok).

Usage: XAI_API_KEY=... python3 edit.py <input.png|jpg> <output.jpg> <model> <prompt file>
Map landscape: node layout.cjs (writes layout.png from the map terrain), then
  python3 edit.py layout.png raw/map-valley.jpg grok-imagine-image-2.0 prompts/map.txt
Hero gear tiers: python3 edit.py raw/hero-body-player-0.jpg raw/hero-body-player-1.jpg grok-imagine-image-2.0 prompts/hero-player-1.txt
City detail pass: python3 edit.py raw/city-player-3.jpg raw/city-player-3-detail.jpg grok-imagine-image-2.0 prompts/city-detail.txt
"""
import json, base64, urllib.request, sys, os
K = os.environ["XAI_API_KEY"]
src, out, model, prompt = sys.argv[1], sys.argv[2], sys.argv[3], open(sys.argv[4]).read()
img = ("data:image/jpeg;base64," if src.endswith(".jpg") else "data:image/png;base64,") + base64.b64encode(open(src,"rb").read()).decode()
body = {"model":model,"prompt":prompt,"image":{"url":img,"type":"image_url"},"response_format":"b64_json"}
req = urllib.request.Request("https://api.x.ai/v1/images/edits", json.dumps(body).encode(), {"Authorization":"Bearer "+K,"Content-Type":"application/json"})
try:
    d = json.load(urllib.request.urlopen(req, timeout=300)); open(out,"wb").write(base64.b64decode(d["data"][0]["b64_json"])); print(out, "ok")
except Exception as e: print(out, getattr(e,"code",""), e.read().decode()[:300] if hasattr(e,"read") else e)
