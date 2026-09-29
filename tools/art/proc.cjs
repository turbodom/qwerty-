// Post-processes the raw Grok pictures in headless Chromium: keys out the magenta background, crops,
// resizes, makes textures seamless and writes WebP.
// Usage: node proc.cjs <out dir>   (PW = path of a playwright install, CHROME = chromium binary, both optional)
const { chromium } = require(process.env.PW || "playwright");
const fs = require("fs"), path = require("path");
const D = __dirname, RAW = path.join(D, "raw"), OUT = process.argv[2];
const specs = JSON.parse(fs.readFileSync(path.join(D, "specs.json"), "utf8"));
(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const p = await b.newPage();
  await p.setContent("<html><body></body></html>");
  await p.evaluate(() => {
    window.proc = async (src, s) => {
      const img = new Image(); img.src = src; await img.decode();
      let c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      let x = c.getContext("2d"); x.drawImage(img, 0, 0);
      const W = c.width, H = c.height;
      if (s.kind === "sprite" || s.kind === "icon") {
        const id = x.getImageData(0, 0, W, H), d = id.data;
        // background colour = median of border pixels
        const rs = [], gs = [], bs = [];
        for (let i = 0; i < W; i += 4) for (const y of [0, H - 1]) { const k = (y * W + i) * 4; rs.push(d[k]); gs.push(d[k + 1]); bs.push(d[k + 2]); }
        for (let j = 0; j < H; j += 4) for (const xx of [0, W - 1]) { const k = (j * W + xx) * 4; rs.push(d[k]); gs.push(d[k + 1]); bs.push(d[k + 2]); }
        const med = (a) => a.sort((u, v) => u - v)[a.length >> 1];
        const br = med(rs), bg = med(gs), bb = med(bs);
        const dist = new Float32Array(W * H);
        for (let i = 0; i < W * H; i++) { const k = i * 4; dist[i] = Math.hypot(d[k] - br, d[k + 1] - bg, d[k + 2] - bb); }
        // flood fill from the border through background-like pixels
        const T_IN = 70, T_OUT = 130;
        const bgMask = new Uint8Array(W * H), st = [];
        for (let i = 0; i < W; i++) st.push(i, (H - 1) * W + i);
        for (let j = 0; j < H; j++) st.push(j * W, j * W + W - 1);
        while (st.length) { const i = st.pop(); if (bgMask[i] || dist[i] > T_OUT) continue; bgMask[i] = 1;
          const xx = i % W, yy = (i / W) | 0;
          if (xx > 0) st.push(i - 1); if (xx < W - 1) st.push(i + 1); if (yy > 0) st.push(i - W); if (yy < H - 1) st.push(i + W); }
        for (let i = 0; i < W * H; i++) {
          const k = i * 4;
          if (bgMask[i]) { const a = Math.max(0, Math.min(1, (dist[i] - T_IN) / (T_OUT - T_IN))); d[k + 3] = Math.round(a * 255); }
          else if (dist[i] < 110) { const a = Math.max(0, Math.min(1, (dist[i] - 55) / 55)); d[k + 3] = Math.round(a * 255); bgMask[i] = a < 0.5 ? 1 : 0; }
          // despill magenta: red and blue both above green -> pull toward green level
          const r = d[k], g = d[k + 1], bl = d[k + 2];
          const m = Math.min(r, bl) - g;
          if (m > 0 && (bgMask[i] || isEdge(i))) { const f = bgMask[i] ? 0.9 : 0.6; d[k] = r - m * f; d[k + 2] = bl - m * f; }
        }
        function isEdge(i) { const xx = i % W, yy = (i / W) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = xx + dx, Y = yy + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && bgMask[Y * W + X]) return true; } return false; }
        x.putImageData(id, 0, 0);
        // crop to alpha bbox
        let x0 = W, y0 = H, x1 = 0, y1 = 0;
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (d[(j * W + i) * 4 + 3] > 24) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
        const cw = x1 - x0 + 1, ch = y1 - y0 + 1, sc = Math.min(1, s.size / Math.max(cw, ch));
        const pad = s.kind === "icon" ? Math.round(s.size * 0.04) : 2;
        const o = document.createElement("canvas");
        if (s.kind === "icon") { o.width = o.height = s.size; } else { o.width = Math.round(cw * sc) + pad * 2; o.height = Math.round(ch * sc) + pad * 2; }
        const ox = o.getContext("2d"); ox.imageSmoothingQuality = "high";
        const isc = s.kind === "icon" ? (s.size - pad * 2) / Math.max(cw, ch) : sc;
        const dw = cw * isc, dh = ch * isc;
        ox.drawImage(c, x0, y0, cw, ch, (o.width - dw) / 2, (o.height - dh) / 2, dw, dh);
        return o.toDataURL("image/webp", 0.86);
      }
      // backgrounds / textures: resize to s.w x s.h (cover)
      const o = document.createElement("canvas"); o.width = s.w; o.height = s.h;
      const ox = o.getContext("2d"); ox.imageSmoothingQuality = "high";
      const sc = Math.max(s.w / W, s.h / H); ox.drawImage(c, (s.w - W * sc) / 2, (s.h - H * sc) / 2, W * sc, H * sc);
      if (s.kind === "tex") {
        // seamless: blend with the half-shifted copy, weight 0 at the edges
        const w = s.w, h = s.h, a = ox.getImageData(0, 0, w, h), sh = ox.createImageData(w, h);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = (j * w + i) * 4, k2 = (((j + h / 2) % h) * w + ((i + w / 2) % w)) * 4; for (let q = 0; q < 4; q++) sh.data[k + q] = a.data[k2 + q]; }
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const ex = Math.min(i, w - 1 - i) / (w / 2), ey = Math.min(j, h - 1 - j) / (h / 2);
          const t = Math.min(1, Math.min(ex, ey) * 2.2); const k = (j * w + i) * 4;
          for (let q = 0; q < 3; q++) a.data[k + q] = a.data[k + q] * t + sh.data[k + q] * (1 - t);
        }
        ox.putImageData(a, 0, 0);
      }
      return o.toDataURL("image/webp", s.q || 0.82);
    };
  });
  for (const s of specs) {
    const f = path.join(RAW, s.src + ".jpg");
    if (!fs.existsSync(f)) { console.log("missing", s.src); continue; }
    const url = await p.evaluate(([src, s]) => window.proc(src, s), ["data:image/jpeg;base64," + fs.readFileSync(f).toString("base64"), s]);
    const outF = path.join(OUT, s.out + ".webp");
    fs.mkdirSync(path.dirname(outF), { recursive: true });
    fs.writeFileSync(outF, Buffer.from(url.split(",")[1], "base64"));
    console.log(s.out, fs.statSync(outF).size);
  }
  await b.close();
})();
