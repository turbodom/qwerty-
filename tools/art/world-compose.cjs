// Composes public/art/world-map.webp (the Seasonal Wasteland map) from the painted art already in public/art:
// the valley landscape as ground, toxic glow on contamination zones and the mine, fort and fortress sprites on
// their sectors (layout = WORLD_LAYOUT in shared/src/world.ts). A fully painted map from edit.py can replace it.
const { chromium } = require(process.env.PW || "playwright");
const fs = require("fs"), path = require("path");
const ART = path.join(__dirname, "../../packages/client/public/art");
const L = ["r.m.f.m.r", ".z..r..z.", "m..z.z..m", "..zrzrz..", "fr.zCz.rf", "..zrzrz..", "m..z.z..m", ".z..r..z.", "r.m.f.m.r"];
const pics = ["map-valley", "mine", "base-player", "base-enemy", "rock1", "rock2", "city-enemy-0"];
const data = Object.fromEntries(pics.map((n) => [n, "data:image/webp;base64," + fs.readFileSync(path.join(ART, n + ".webp")).toString("base64")]));
(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const p = await b.newPage();
  const url = await p.evaluate(async ({ L, data }) => {
    const img = {};
    await Promise.all(Object.entries(data).map(([k, src]) => new Promise((ok) => { const i = new Image(); i.onload = () => { img[k] = i; ok(); }; i.src = src; })));
    const W = 1024, N = 9, S = W / N;
    const c = document.createElement("canvas"); c.width = W; c.height = W; const x = c.getContext("2d");
    let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // ground: the painted landscape, mirrored into a square, warmed and desaturated
    const g = img["map-valley"]; const k = W / g.width;
    x.drawImage(g, 0, (W - g.height * k) / 2, W, g.height * k);
    x.save(); x.globalCompositeOperation = "color"; x.fillStyle = "rgba(120,96,64,.45)"; x.fillRect(0, 0, W, W); x.restore();
    x.save(); x.globalCompositeOperation = "multiply"; x.fillStyle = "rgba(180,150,110,.35)"; x.fillRect(0, 0, W, W); x.restore();
    const at = (X, Y) => [X * S + S / 2, Y * S + S / 2];
    const sprite = (name, cx, cy, size, flip = false) => { const i = img[name]; const kk = size / Math.max(i.width, i.height); const w = i.width * kk, h = i.height * kk;
      x.save(); x.shadowColor = "rgba(0,0,0,.7)"; x.shadowBlur = 10; x.shadowOffsetY = 5; x.translate(cx, cy); if (flip) x.scale(-1, 1); x.drawImage(i, -w / 2, -h / 2, w, h); x.restore(); };
    // roads: faint dusty tracks between neighbouring sectors
    x.save(); x.strokeStyle = "rgba(70,55,40,.35)"; x.lineWidth = 5; x.lineCap = "round";
    for (let Y = 0; Y < N; Y++) for (let X = 0; X < N; X++) { const [a, bb] = at(X, Y); if (X < N - 1 && rnd() < .5) { x.beginPath(); x.moveTo(a, bb); x.quadraticCurveTo(a + S / 2, bb + (rnd() - .5) * 30, a + S, bb); x.stroke(); } if (Y < N - 1 && rnd() < .5) { x.beginPath(); x.moveTo(a, bb); x.quadraticCurveTo(a + (rnd() - .5) * 30, bb + S / 2, a, bb + S); x.stroke(); } }
    x.restore();
    // contamination: dark scorched ground with glowing acid pools
    L.forEach((row, Y) => [...row].forEach((ch, X) => { if (ch !== "z") return; const [cx, cy] = at(X, Y);
      x.save(); x.globalCompositeOperation = "multiply"; let gr = x.createRadialGradient(cx, cy, 4, cx, cy, S * 0.75); gr.addColorStop(0, "rgba(30,45,18,.95)"); gr.addColorStop(1, "rgba(90,100,60,0)"); x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, S * 0.75, 0, 7); x.fill(); x.restore();
      x.save(); x.globalCompositeOperation = "screen"; for (let j = 0; j < 6; j++) { const px = cx + (rnd() - .5) * S * .7, py = cy + (rnd() - .5) * S * .7, r = S * (.05 + rnd() * .08);
        gr = x.createRadialGradient(px, py, 1, px, py, r * 2.2); gr.addColorStop(0, "rgba(170,240,60,.6)"); gr.addColorStop(.3, "rgba(100,190,30,.32)"); gr.addColorStop(1, "rgba(60,120,20,0)"); x.fillStyle = gr; x.beginPath(); x.ellipse(px, py, r * 2.2, r * 1.6, rnd() * 3, 0, 7); x.fill(); }
      x.restore(); }));
    // objects
    L.forEach((row, Y) => [...row].forEach((ch, X) => { const [cx, cy] = at(X, Y);
      if (ch === "m") sprite("mine", cx, cy + 4, S * 0.95, X > 4);
      if (ch === "f") sprite("base-player", cx, cy, S * 1.0, X > 4);
      if (ch === "r") { sprite("rock2", cx - 16, cy + 10, S * 0.6); sprite("rock1", cx + 18, cy - 12, S * 0.55, true); }
    }));
    // the Citadel: a dark fortress over a scorched crater
    const [ccx, ccy] = at(4, 4);
    x.save(); let gr = x.createRadialGradient(ccx, ccy, 10, ccx, ccy, S * 1.6); gr.addColorStop(0, "rgba(20,14,10,.85)"); gr.addColorStop(.6, "rgba(40,24,14,.5)"); gr.addColorStop(1, "rgba(40,24,14,0)"); x.fillStyle = gr; x.beginPath(); x.arc(ccx, ccy, S * 1.6, 0, 7); x.fill();
    gr = x.createRadialGradient(ccx, ccy, 10, ccx, ccy, S * 1.2); gr.addColorStop(0, "rgba(255,120,40,.35)"); gr.addColorStop(1, "rgba(255,120,40,0)"); x.globalCompositeOperation = "screen"; x.fillStyle = gr; x.beginPath(); x.arc(ccx, ccy, S * 1.2, 0, 7); x.fill(); x.restore();
    sprite("base-enemy", ccx, ccy, S * 1.75);
    // vignette and warm light
    x.save(); gr = x.createRadialGradient(W * .45, W * .4, W * .2, W / 2, W / 2, W * .75); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.55)"); x.fillStyle = gr; x.fillRect(0, 0, W, W);
    x.globalCompositeOperation = "soft-light"; gr = x.createLinearGradient(0, 0, W, W); gr.addColorStop(0, "rgba(255,190,110,.55)"); gr.addColorStop(1, "rgba(60,50,80,.4)"); x.fillStyle = gr; x.fillRect(0, 0, W, W); x.restore();
    return c.toDataURL("image/webp", 0.84);
  }, { L, data });
  fs.writeFileSync(path.join(ART, "world-map.webp"), Buffer.from(url.split(",")[1], "base64"));
  await b.close();
})();
