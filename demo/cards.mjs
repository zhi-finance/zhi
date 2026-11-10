// Renders the branded title cards (HTML + CSS animation) to MP4 clips, and the caption /
// chapter overlays to transparent PNGs, at 1920x1080.
//   node cards.mjs
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const glyph = readFileSync(new URL("../web/lib/glyph.ts", import.meta.url), "utf8");
const ZHI_PATH = JSON.parse(glyph.match(/ZHI_PATH = (".*?");/)[1]);
const BBOX = JSON.parse(glyph.match(/ZHI_BBOX = ({.*?});/)[1]);
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const TX = "0xc3aa27949bf4df473f139720ecbb74909bdde45e4b0bc74816dbae4de7a41d13";

function seal(size, rough = true) {
  const pad = 150, w = BBOX.x2 - BBOX.x1, h = BBOX.y2 - BBOX.y1, side = Math.max(w, h) + pad * 2;
  const ox = BBOX.x1 - (side - w) / 2, oy = BBOX.y1 - (side - h) / 2;
  return `<svg width="${size}" height="${size}" viewBox="${ox} ${oy} ${side} ${side}">
    <filter id="r"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="4"/><feDisplacementMap in="SourceGraphic" scale="${rough ? 26 : 0}"/></filter>
    <g filter="url(#r)"><rect x="${ox + 30}" y="${oy + 30}" width="${side - 60}" height="${side - 60}" rx="${side * 0.08}" fill="#e2492f"/><path d="${ZHI_PATH}" fill="#0b0b0b"/></g></svg>`;
}

const HEAD = `<meta charset="utf-8"><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=block" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}html,body{width:1920px;height:1080px;overflow:hidden;background:#0b0b0b;color:#ededea;font-family:Geist,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.serif{font-family:'Instrument Serif',serif;font-style:italic;font-weight:400}
.mono{font-family:'Geist Mono',monospace;letter-spacing:.16em;text-transform:uppercase;font-size:18px;color:#8f8f8a}
.grain:after{content:"";position:fixed;inset:0;opacity:.07;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.dots{position:fixed;inset:0;background-image:radial-gradient(rgba(237,237,234,.08) 1px,transparent 1px);background-size:28px 28px;mask-image:radial-gradient(ellipse at center,black,transparent 70%)}
@keyframes stamp{0%{transform:scale(2.6) rotate(-22deg);opacity:0;filter:blur(8px)}55%{transform:scale(.94) rotate(-5deg);opacity:1;filter:blur(0)}70%{transform:scale(1.03) rotate(-6deg)}100%{transform:scale(1) rotate(-6deg);opacity:1}}
@keyframes ring{0%{transform:scale(.6);opacity:.9}100%{transform:scale(2.4);opacity:0}}
@keyframes rise{from{opacity:0;transform:translateY(28px);filter:blur(10px)}to{opacity:1;transform:none;filter:blur(0)}}
@keyframes track{from{letter-spacing:.6em;opacity:0}to{letter-spacing:-.04em;opacity:1}}
@keyframes wipe{from{clip-path:inset(0 100% 0 0);opacity:1}to{clip-path:inset(0 0 0 0);opacity:1}}
@keyframes shake{0%,100%{transform:none}20%{transform:translate(-6px,3px)}40%{transform:translate(5px,-4px)}60%{transform:translate(-3px,2px)}80%{transform:translate(2px,-1px)}}
.a{opacity:0;animation-fill-mode:forwards}
</style>`;

const CARDS = {
  intro: {
    dur: 6.5,
    html: `<body class="grain"><div class="dots"></div>
      <div id="shake" style="position:absolute;inset:0;display:grid;place-items:center;animation:shake .35s .62s ease-out">
        <div style="position:relative;display:grid;place-items:center">
          <div class="a" style="position:absolute;width:300px;height:300px;border:3px solid #e2492f;border-radius:40px;animation:ring 1.1s .6s ease-out forwards"></div>
          <div class="a" style="animation:stamp 1s .1s cubic-bezier(.2,.8,.2,1) forwards">${seal(300)}</div>
          <div class="a" style="margin-top:56px;font-size:120px;font-weight:600;animation:track 1.4s 1.3s cubic-bezier(.2,.8,.2,1) forwards">Zhi</div>
          <div class="a" style="margin-top:18px;font-size:44px;color:#8f8f8a;animation:rise 1s 2.3s ease-out forwards">trading agents, <span class="serif" style="color:#ededea;font-size:52px">bound</span> by the chain</div>
          <div class="a mono" style="margin-top:46px;animation:rise .9s 3.1s ease-out forwards">Built on Injective · Verified by Bittensor SN50</div>
        </div>
      </div></body>`,
  },
  real: {
    dur: 4.2,
    html: `<body class="grain"><div class="dots"></div>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 220px">
        <div class="a mono" style="animation:rise .6s .1s ease-out forwards"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#7fcf9e;margin-right:14px"></span>Live · Injective EVM testnet · block-confirmed</div>
        <div class="a" style="margin-top:30px;font-size:150px;font-weight:500;letter-spacing:-.05em;line-height:1;animation:rise .9s .3s cubic-bezier(.2,.8,.2,1) forwards">This is <span class="serif">real.</span></div>
        <div class="a" style="margin-top:56px;font-family:'Geist Mono';font-size:30px;color:#ededea;animation:wipe 1.2s 1.1s cubic-bezier(.6,0,.2,1) forwards">ExecutionLogged · short 0.0001 BTC · ≤ $73,432 · 2.99×</div>
        <div class="a" style="margin-top:18px;font-family:'Geist Mono';font-size:24px;color:#8f8f8a;animation:wipe 1.2s 1.6s cubic-bezier(.6,0,.2,1) forwards">tx ${TX}</div>
      </div>
      <div class="a" style="position:absolute;right:200px;top:300px;animation:stamp .9s 1.9s cubic-bezier(.2,.8,.2,1) forwards">${seal(220)}</div>
      </body>`,
  },
  outro: {
    dur: 9,
    html: `<body class="grain"><div class="dots"></div>
      <div style="position:absolute;inset:0;display:grid;grid-template-columns:1.3fr 1fr;align-items:center;padding:0 200px">
        <div>
          <div class="a" style="font-size:96px;font-weight:500;letter-spacing:-.045em;line-height:1.05;animation:rise .8s .2s ease-out forwards">The model <span class="serif">plans.</span></div>
          <div class="a" style="font-size:96px;font-weight:500;letter-spacing:-.045em;line-height:1.05;animation:rise .8s 1.3s ease-out forwards">The subnet <span class="serif">verifies.</span></div>
          <div class="a" style="font-size:96px;font-weight:500;letter-spacing:-.045em;line-height:1.05;animation:rise .8s 2.4s ease-out forwards">The chain <span class="serif" style="color:#e2492f">enforces.</span></div>
          <div class="a mono" style="margin-top:60px;animation:rise .8s 4.6s ease-out forwards">Build your agent · Injective EVM testnet · live now</div>
        </div>
        <div style="display:grid;place-items:center">
          <div class="a" style="position:absolute;width:340px;height:340px;border:3px solid #e2492f;border-radius:44px;animation:ring 1.2s 4.0s ease-out forwards"></div>
          <div class="a" style="animation:stamp 1s 3.5s cubic-bezier(.2,.8,.2,1) forwards">${seal(340)}</div>
          <div class="a" style="margin-top:40px;font-size:84px;font-weight:600;animation:track 1.2s 4.4s cubic-bezier(.2,.8,.2,1) forwards">Zhi</div>
        </div>
      </div></body>`,
  },
};

async function renderCard(browser, id, { dur, html }) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const dir = join(OUT, "frames-card-" + id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // pause animations, load fonts, then step time deterministically: frame-perfect capture
  await page.setContent(`<!doctype html><html><head>${HEAD}<style>*{animation-play-state:paused!important}</style></head>${html}</html>`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const fps = 30, n = Math.round(dur * fps);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    await page.evaluate((t) => document.getAnimations().forEach((a) => (a.currentTime = t * 1000)), t);
    await page.screenshot({ path: join(dir, `${String(i).padStart(5, "0")}.png`) });
  }
  await ctx.close();
  const mp4 = join(OUT, `card-${id}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "30", "-i", join(dir, "%05d.png"), "-c:v", "libx264", "-crf", "14", "-preset", "slow", "-pix_fmt", "yuv420p", mp4]);
  console.log("card", id, `${dur}s ->`, mp4);
}

// captions + chapter tags as transparent PNGs
export async function renderOverlays(browser, captions, chapters) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><html><head>${HEAD}<style>html,body{background:transparent}</style></head><body><div id="c"></div></body></html>`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const dir = join(OUT, "overlays");
  mkdirSync(dir, { recursive: true });
  for (const [i, text] of captions.entries()) {
    const html = text
      .replace(/&/g, "&amp;")
      .replace(/\*(.+?)\*/g, '<span style="color:#e2492f">$1</span>');
    await page.evaluate((h) => {
      document.getElementById("c").innerHTML = `<div style="position:fixed;left:0;right:0;bottom:92px;display:flex;justify-content:center"><div style="max-width:1400px;padding:16px 30px;border-radius:16px;background:rgba(8,8,8,.78);backdrop-filter:blur(10px);box-shadow:0 12px 40px rgba(0,0,0,.45);font-size:42px;font-weight:500;line-height:1.28;letter-spacing:-.01em;text-align:center;color:#f4f4f1">${h}</div></div>`;
    }, html);
    await page.screenshot({ path: join(dir, `cap-${i}.png`), omitBackground: true });
  }
  for (const [i, text] of chapters.entries()) {
    await page.evaluate((t) => {
      document.getElementById("c").innerHTML = `<div style="position:fixed;left:64px;top:56px;display:flex;align-items:center;gap:14px;padding:12px 20px;border-radius:999px;background:rgba(8,8,8,.82);border:1px solid rgba(237,237,234,.14);font-family:'Geist Mono';font-size:20px;letter-spacing:.16em;text-transform:uppercase;color:#ededea"><span style="width:10px;height:10px;border-radius:50%;background:#e2492f"></span>${t}</div>`;
    }, text);
    await page.screenshot({ path: join(dir, `chap-${i}.png`), omitBackground: true });
  }
  await ctx.close();
}

export async function launch() {
  return chromium.launch({ executablePath: CHROME, args: ["--force-color-profile=srgb"] });
}

if (process.argv[1].endsWith("cards.mjs")) {
  const browser = await launch();
  const only = process.argv.slice(2);
  for (const [id, c] of Object.entries(CARDS)) if (!only.length || only.includes(id)) await renderCard(browser, id, c);
  await browser.close();
}
