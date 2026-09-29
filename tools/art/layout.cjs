// Draws layout.png: a soft colour sketch of the valley map terrain (forest, mountains, water) for edit.py.
const { chromium } = require(process.env.PW || "playwright");
const T = ["FF....MMM..FFF","F.....MM.....F","..F.......F...","..FF..WW......","......WWW..MM.",".MM....W....M.",".M..F.......F.","....FF..MM....","....F...MM..F.",".F........F...",".FF..WWW......","......WW..FF..","..M.......F...",".MM....FF.....","F.....FF.....F","FFF.......FFFF"];
(async () => { const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {}); const p = await b.newPage();
 const url = await p.evaluate((T) => { const S = 64, W = 14 * S, H = 16 * S; const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
  x.fillStyle = "#8a7550"; x.fillRect(0, 0, W, H);
  const col = { F: "#1f4a1c", M: "#77736b", W: "#1f4f8a" };
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(${60 + rnd() * 60},${50 + rnd() * 40},${30 + rnd() * 20},.25)`; x.fillRect(rnd() * W, rnd() * H, 6 + rnd() * 30, 4 + rnd() * 20); }
  for (const k of ["W", "F", "M"]) { x.filter = "blur(14px)"; x.fillStyle = col[k];
   T.forEach((r, y) => [...r].forEach((ch, X) => { if (ch !== k) return;
     for (let j = 0; j < 7; j++) { x.beginPath(); x.ellipse(X * S + S / 2 + (rnd() - .5) * S * .7, y * S + S / 2 + (rnd() - .5) * S * .7, S * (.25 + rnd() * .3), S * (.2 + rnd() * .3), rnd() * 3, 0, 7); x.fill(); } })); }
  x.filter = "none"; return c.toDataURL("image/png"); }, T);
 require("fs").writeFileSync(__dirname + "/layout.png", Buffer.from(url.split(",")[1], "base64")); await b.close(); })();
