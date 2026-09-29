// Draws world-layout.png: a colour sketch of the Seasonal Wasteland sector grid (WORLD_LAYOUT in shared/src/world.ts) for edit.py.
const { chromium } = require(process.env.PW || "playwright");
const L = ["r.m.f.m.r", ".z..r..z.", "m..z.z..m", "..zrzrz..", "fr.zCz.rf", "..zrzrz..", "m..z.z..m", ".z..r..z.", "r.m.f.m.r"];
(async () => { const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {}); const p = await b.newPage();
 const url = await p.evaluate((L) => { const S = 114, N = 9, W = N * S; const c = document.createElement("canvas"); c.width = W; c.height = W; const x = c.getContext("2d");
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  x.fillStyle = "#8d7651"; x.fillRect(0, 0, W, W);
  for (let i = 0; i < 5000; i++) { x.fillStyle = `rgba(${70 + rnd() * 60},${55 + rnd() * 40},${30 + rnd() * 20},.25)`; x.fillRect(rnd() * W, rnd() * W, 6 + rnd() * 30, 4 + rnd() * 20); }
  // meandering highways: spokes from the centre and a ring road
  x.strokeStyle = "rgba(55,45,35,.6)"; x.lineWidth = 8; x.lineCap = "round";
  const c0 = W / 2, road = (pts) => { x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) { const [a, b] = pts[i - 1], [e, f] = pts[i]; x.quadraticCurveTo(a + (e - a) / 2 + (rnd() - .5) * 60, b + (f - b) / 2 + (rnd() - .5) * 60, e, f); } x.stroke(); };
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + .2; road([[c0, c0], [c0 + Math.cos(a) * W * .25, c0 + Math.sin(a) * W * .25], [c0 + Math.cos(a) * W * .62, c0 + Math.sin(a) * W * .62]]); }
  x.beginPath(); x.ellipse(c0, c0, W * .36, W * .33, .3, 0, 7); x.stroke();
  const blob = (cx, cy, r, color, n = 8, blur = 10) => { x.filter = `blur(${blur}px)`; x.fillStyle = color;
    for (let j = 0; j < n; j++) { x.beginPath(); x.ellipse(cx + (rnd() - .5) * r, cy + (rnd() - .5) * r, r * (.3 + rnd() * .3), r * (.25 + rnd() * .3), rnd() * 3, 0, 7); x.fill(); } x.filter = "none"; };
  L.forEach((row, y) => [...row].forEach((k, X) => { const cx = X * S + S / 2, cy = y * S + S / 2;
   if (k === "z") { blob(cx, cy, S * .8, "#4f7a22", 9, 14); blob(cx, cy, S * .35, "#9adf3a", 4, 6); }
   if (k === "m") { blob(cx, cy, S * .6, "#4a4540", 6, 8); x.fillStyle = "#b86a2a"; for (let j = 0; j < 4; j++) x.fillRect(cx - 30 + rnd() * 50, cy - 30 + rnd() * 50, 10, 10); }
   if (k === "r") { for (let j = 0; j < 14; j++) { x.fillStyle = `rgb(${120 + rnd() * 40},${118 + rnd() * 40},${112 + rnd() * 40})`; x.fillRect(cx - 42 + rnd() * 76, cy - 42 + rnd() * 76, 8 + rnd() * 16, 8 + rnd() * 16); } }
   if (k === "f") { x.strokeStyle = "#3b2a1c"; x.lineWidth = 9; x.strokeRect(cx - 34, cy - 34, 68, 68); x.fillStyle = "#6b5642"; x.fillRect(cx - 14, cy - 14, 28, 28); }
   if (k === "C") { x.fillStyle = "#3a3a3e"; x.fillRect(cx - S * .75, cy - S * .75, S * 1.5, S * 1.5); for (let j = 0; j < 40; j++) { x.fillStyle = `rgb(${80 + rnd() * 60},${80 + rnd() * 60},${86 + rnd() * 60})`; x.fillRect(cx - 80 + rnd() * 150, cy - 80 + rnd() * 150, 8 + rnd() * 18, 8 + rnd() * 18); }
     x.strokeStyle = "#1c1c20"; x.lineWidth = 10; x.strokeRect(cx - S * .75, cy - S * .75, S * 1.5, S * 1.5); }
  }));
  return c.toDataURL("image/png"); }, L);
 require("fs").writeFileSync(__dirname + "/world-layout.png", Buffer.from(url.split(",")[1], "base64")); await b.close(); })();
