// Records each demo scene from the live Zhi app (production build) at 1920x1080.
// Frames come from Chrome's screencast (JPEG q=92) with real timestamps, then ffmpeg
// turns each scene into a constant-30fps H.264 clip. A visible cursor + click ripples
// are injected so viewers can follow every action.
//   node record.mjs [sceneId ...]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const BASE = process.env.ZHI_URL ?? "http://localhost:3200";
const OUT = new URL("./out/", import.meta.url).pathname;
const VAULT = "0x9e229Bd01D43b2Ce6774c67c3843B316285E8f26";
const BTC_TESTNET = "0xfd704649cf3a516c0c145ab0111717c44640d8dbe52a462ae35cadf2f6df1515";
mkdirSync(OUT, { recursive: true });

const CURSOR = `
(() => {
  if (window.__zhiCursor) return; window.__zhiCursor = true;
  const add = () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(237,237,234,.95);box-shadow:0 0 0 2px rgba(11,11,11,.9),0 6px 18px rgba(0,0,0,.5);z-index:2147483647;pointer-events:none;transition:transform .12s ease, width .15s, height .15s;transform:translate(-100px,-100px)';
    document.body.appendChild(c);
    let x=-100,y=-100;
    window.addEventListener('mousemove', e => { x=e.clientX; y=e.clientY; c.style.transform = 'translate('+x+'px,'+y+'px)'; }, true);
    window.addEventListener('mousedown', () => {
      c.style.width = c.style.height = '16px'; c.style.margin='-8px 0 0 -8px';
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;left:'+x+'px;top:'+y+'px;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid #e2492f;z-index:2147483646;pointer-events:none;transition:all .55s cubic-bezier(.2,.8,.2,1);opacity:1';
      document.body.appendChild(r);
      requestAnimationFrame(()=>{ r.style.width=r.style.height='64px'; r.style.margin='-32px 0 0 -32px'; r.style.opacity='0'; });
      setTimeout(()=>r.remove(), 700);
    }, true);
    window.addEventListener('mouseup', () => { c.style.width = c.style.height = '22px'; c.style.margin='-11px 0 0 -11px'; }, true);
    const s = document.createElement('style');
    s.textContent = 'nextjs-portal{display:none!important} *{cursor:none!important} ::-webkit-scrollbar{display:none}';
    document.head.appendChild(s);
  };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function glide(page, sel, { click = true, offset = [0, 0], steps = 32 } = {}) {
  const el = typeof sel === "string" ? page.locator(sel).first() : sel;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const b = await el.boundingBox();
  if (!b) throw new Error("no box for " + sel);
  await page.mouse.move(b.x + b.width / 2 + offset[0], b.y + b.height / 2 + offset[1], { steps });
  await sleep(180);
  if (click) {
    await page.mouse.down();
    await sleep(90);
    await page.mouse.up();
  }
}

async function smoothScroll(page, dy, ms = 1600) {
  await page.evaluate(
    ([dy, ms]) =>
      new Promise((res) => {
        const y0 = window.scrollY, t0 = performance.now();
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const f = (t) => {
          const k = Math.min(1, (t - t0) / ms);
          window.scrollTo(0, y0 + dy * ease(k));
          k < 1 ? requestAnimationFrame(f) : res();
        };
        requestAnimationFrame(f);
      }),
    [dy, ms],
  );
}

async function scrollTo(page, sel, ms = 1600, offset = -90) {
  const y = await page.evaluate(([s, o]) => {
    const el = s.startsWith("text=")
      ? [...document.querySelectorAll("h1,h2,h3,p,span")].find((e) => e.textContent?.trim().startsWith(s.slice(5)))
      : document.querySelector(s);
    return el ? el.getBoundingClientRect().top + o : 0;
  }, [sel, offset]);
  await smoothScroll(page, y, ms);
}

async function typeSlow(page, text, delay = 34) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(delay + Math.random() * 30);
  }
}

const SCENES = {
  async hero(page) {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await sleep(2500);
    await page.mouse.move(1400, 500, { steps: 40 });
    await sleep(1800);
    await glide(page, "#idea");
    await typeSlow(page, "Short BTC when the book is tight, 3x, stop at 1.5%");
    await sleep(900);
    await page.mouse.move(1300, 420, { steps: 50 });
    await sleep(3200);
  },
  async layers(page) {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await sleep(800);
    await scrollTo(page, "#how", 1800, -40);
    await sleep(1600);
    await smoothScroll(page, 760, 2200);
    await sleep(1800);
    await smoothScroll(page, 760, 2200);
    await sleep(1800);
    await smoothScroll(page, 700, 2000);
    await sleep(1600);
  },
  async playground(page) {
    await page.goto(BASE + "/#playground", { waitUntil: "networkidle" });
    await sleep(600);
    await scrollTo(page, "#playground", 10, -20);
    await sleep(1400);
    await glide(page, page.getByRole("button", { name: "Prompt-injected 20×" }));
    await sleep(2600);
    await glide(page, page.getByRole("button", { name: "Fat-finger $9,000" }));
    await sleep(2400);
    await glide(page, page.getByRole("button", { name: "Down 5% today" }));
    await sleep(2800);
    await glide(page, "#pg-lev", { click: false });
    await page.mouse.down();
    await page.mouse.move(300, 0, { steps: 1 }).catch(() => {});
    await page.mouse.up();
    await glide(page, page.getByRole("button", { name: "A normal trade" }));
    await sleep(2600);
  },
  async markets(page) {
    await page.goto(BASE + "/markets?m=BTC", { waitUntil: "networkidle" });
    await sleep(3500);
    await glide(page, page.getByRole("button", { name: /BTC-USD/ }));
    await sleep(500);
    await typeSlow(page, "TSLA", 90);
    await sleep(1100);
    await page.keyboard.press("Enter");
    await sleep(3200);
    await glide(page, page.getByRole("button", { name: /TSLA-USD/ }));
    await sleep(400);
    await typeSlow(page, "BTC", 90);
    await sleep(800);
    await page.keyboard.press("Enter");
    await sleep(2600);
    await glide(page, page.getByRole("button", { name: "4h" }));
    await sleep(1600);
    await glide(page, page.getByRole("radio", { name: "short" }));
    await sleep(1000);
    await glide(page, page.getByRole("tab", { name: "Trades" }));
    await sleep(1400);
    await glide(page, page.getByRole("button", { name: /Build short agent/ }), { click: false });
    await sleep(1500);
  },
  async launch(page) {
    await page.goto(`${BASE}/terminal?market=${BTC_TESTNET}&side=short&lev=3&pct=10&tp=3&sl=1.5`, { waitUntil: "networkidle" });
    await sleep(2500);
    await scrollTo(page, "text=2 · Review the rule tree", 1800, -110);
    await sleep(2400);
    await smoothScroll(page, 520, 2400);
    await sleep(2200);
    await smoothScroll(page, 520, 2000);
    await sleep(2400);
  },
  async board(page) {
    await page.goto(BASE + "/agents", { waitUntil: "networkidle" });
    await sleep(3600);
    await glide(page, page.getByRole("link", { name: "View" }).first(), { click: false });
    await sleep(1200);
  },
  agent: {
    async prep(page) {
      await page.goto(`${BASE}/agents/${VAULT}`, { waitUntil: "networkidle" });
      await page.getByText(/[1-9]\d* events/i).waitFor({ timeout: 45_000 });
      await sleep(1500);
    },
    async run(page) {
      await sleep(2500);
      await page.mouse.move(700, 560, { steps: 40 });
      await sleep(2500);
      await smoothScroll(page, 380, 2000);
      await sleep(2600);
      await smoothScroll(page, -380, 1600);
      await glide(page, page.getByRole("button", { name: /poke\(\)/ }), { click: false });
      await sleep(2200);
    },
  },
};

async function record(id) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    args: ["--force-color-profile=srgb", "--hide-scrollbars", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "dark", reducedMotion: "no-preference" });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const dir = join(OUT, "frames-" + id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async (f) => {
    const n = frames.length;
    writeFileSync(join(dir, `${String(n).padStart(5, "0")}.jpg`), Buffer.from(f.data, "base64"));
    frames.push(f.metadata.timestamp);
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  const scene = SCENES[id];
  if (scene.prep) await scene.prep(page);
  else await page.goto("about:blank");
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await (scene.run ?? scene)(page);
  await cdp.send("Page.stopScreencast");
  await browser.close();

  // drop the about:blank lead-in: start from the first frame after navigation settled
  const list = frames.map((t, i) => ({ t, f: `${String(i).padStart(5, "0")}.jpg` }));
  const start = list.findIndex((x, i) => i > 2) ;
  let concat = "";
  for (let i = start; i < list.length; i++) {
    const d = i + 1 < list.length ? list[i + 1].t - list[i].t : 0.04;
    concat += `file '${list[i].f}'\nduration ${Math.max(0.001, d).toFixed(4)}\n`;
  }
  concat += `file '${list.at(-1).f}'\n`;
  writeFileSync(join(dir, "list.txt"), concat);
  const mp4 = join(OUT, `${id}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "slow", mp4], { cwd: dir });
  const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4]).toString().trim();
  console.log(`${id}: ${frames.length} frames -> ${mp4} (${Number(dur).toFixed(1)}s)`);
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
for (const id of ids) await record(id);
