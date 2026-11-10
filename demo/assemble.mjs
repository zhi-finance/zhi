// Final edit: voiceover-driven timeline -> 1080p30 MP4 with transitions, push-ins,
// captions, chapter tags, brand mark, ducked score, -14 LUFS master.
//   node assemble.mjs            (expects out/voiceover.mp3 or out/voiceover.wav)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, renderOverlays } from "./cards.mjs";

const OUT = new URL("./out/", import.meta.url).pathname;
const FPS = 30;
const XF = 0.5; // transition length
const VO_DELAY = 0.9; // let the seal land before the first word
const sh = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 1 << 28 }).toString();
const dur = (f) => Number(sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).trim());

const vo = ["voiceover.wav", "voiceover.mp3", "voiceover.m4a"].map((f) => join(OUT, f)).find(existsSync);
if (!vo) throw new Error("put the ElevenLabs voiceover at demo/out/voiceover.mp3");
const script = JSON.parse(readFileSync(new URL("./script.json", import.meta.url), "utf8"));
const NS = script.scenes.length;

// ---------------------------------------------------------------- 1. find scene breaks in the VO
// Estimate each break from the script's character share, then snap to the nearest real pause.
const log = spawnSync("ffmpeg", ["-hide_banner", "-i", vo, "-af", "silencedetect=noise=-38dB:d=0.25", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
const voDur = dur(vo);
const pauses = starts.map((s, i) => ({ s, e: ends[i] ?? s })).filter((p) => p.s > 0.3 && p.e < voDur - 0.3);
const cleanVo = (s) => s.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
const lens = script.scenes.map((x) => cleanVo(x.vo).length);
const totalChars = lens.reduce((a, b) => a + b, 0);
const breaks = [];
let acc = 0;
for (let i = 0; i < NS - 1; i++) {
  acc += lens[i];
  const guess = (acc / totalChars) * voDur;
  const cands = pauses.filter((p) => !breaks.includes(p) && (breaks.length === 0 || p.s > breaks.at(-1).e));
  const best = cands.reduce((a, p) => (Math.abs((p.s + p.e) / 2 - guess) < Math.abs((a.s + a.e) / 2 - guess) ? p : a), cands[0]);
  breaks.push(best);
}
console.log("breaks:", breaks.map((b) => b.s.toFixed(2)).join(" "));
const voStart = [0, ...breaks.map((g) => g.e)];
const voEnd = [...breaks.map((g) => g.s), voDur];

// ---------------------------------------------------------------- 1b. re-space the VO: breathing room between scenes
const GAP = Number(process.env.GAP ?? 2.2);
const INTRO = VO_DELAY + 0.6;
const segStart = []; // where each VO section starts on the video timeline
let tl = INTRO;
for (let i = 0; i < NS; i++) {
  segStart.push(tl);
  tl += voEnd[i] - voStart[i] + GAP;
}
const spaced = join(OUT, "voiceover-spaced.wav");
{
  const parts = script.scenes.map((_, i) => `[0:a]atrim=${voStart[i].toFixed(3)}:${voEnd[i].toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(segStart[i] * 1000)}|${Math.round(segStart[i] * 1000)}[s${i}]`);
  const mix = script.scenes.map((_, i) => `[s${i}]`).join("") + `amix=inputs=${NS}:normalize=0[out]`;
  sh("ffmpeg", ["-y", "-loglevel", "error", "-i", vo, "-filter_complex", parts.join(";") + ";" + mix, "-map", "[out]", spaced]);
}
const total = tl - GAP + 3.4; // outro tail lets the seal land and the music resolve
const cut = [0, ...segStart.slice(1).map((s) => s - GAP / 2)];
cut.push(total);
const sceneDur = cut.slice(1).map((c, i) => c - cut[i]);
console.log("scenes:", sceneDur.map((d) => d.toFixed(1)).join(" "), `total ${total.toFixed(1)}s`);

// ---------------------------------------------------------------- 2. per-scene clips, retimed + push-in
const SOURCES = {
  "cold-open": ["card-intro.mp4"],
  hero: ["hero.mp4"],
  layers: ["layers.mp4"],
  playground: ["playground.mp4"],
  markets: ["markets.mp4"],
  launch: ["launch.mp4"],
  evidence: ["card-real.mp4", "board.mp4", "agent.mp4"],
  outro: ["card-outro.mp4"],
};
const CARD = new Set(["cold-open", "outro"]);
mkdirSync(join(OUT, "scenes"), { recursive: true });
const sceneFiles = [];
for (let i = 0; i < NS; i++) {
  const id = script.scenes[i].id;
  const need = sceneDur[i] + (i < NS - 1 ? XF : 0);
  const srcs = SOURCES[id].map((f) => join(OUT, f));
  let src = srcs[0];
  if (srcs.length > 1) {
    // give every sub-clip its proportional share (keep each one's opening) so none is dropped
    const lens = srcs.map(dur);
    const sum = lens.reduce((a, b) => a + b, 0);
    const budget = need * 1.3; // max footage we can use after the 1.3x speed-up
    const parts = srcs.map((s, k) => {
      const keep = sum > budget ? (lens[k] / sum) * budget : lens[k];
      const p = join(OUT, "scenes", `${id}-part${k}.mp4`);
      sh("ffmpeg", ["-y", "-loglevel", "error", "-i", s, "-t", keep.toFixed(3), "-an", "-c:v", "libx264", "-crf", "14", "-preset", "fast", "-r", String(FPS), p]);
      return p;
    });
    src = join(OUT, "scenes", `${id}-joined.mp4`);
    writeFileSync(join(OUT, "scenes", `${id}.txt`), parts.map((s) => `file '${s}'`).join("\n"));
    sh("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(OUT, "scenes", `${id}.txt`), "-c", "copy", src]);
  }
  const have = dur(src);
  // retime within [0.8x, 1.3x]; pad with the last frame or trim the rest
  const speed = Math.min(1.3, Math.max(0.8, have / need));
  const frames = Math.round(need * FPS);
  const zoom = CARD.has(id) ? "" : `,zoompan=z='1+0.035*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=${FPS}`;
  const vf = `setpts=PTS/${speed.toFixed(4)},fps=${FPS},tpad=stop_mode=clone:stop_duration=${need.toFixed(2)},trim=duration=${need.toFixed(3)},setpts=PTS-STARTPTS${zoom},format=yuv420p`;
  const outf = join(OUT, "scenes", `${String(i).padStart(2, "0")}-${id}.mp4`);
  sh("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-an", "-vf", vf, "-c:v", "libx264", "-crf", "15", "-preset", "medium", outf]);
  sceneFiles.push(outf);
  console.log(`scene ${id}: src ${have.toFixed(1)}s -> ${need.toFixed(1)}s (x${speed.toFixed(2)})`);
}

// ---------------------------------------------------------------- 3. captions (sentences timed by length inside each VO section)
const KEY = /\b(Zhi|Injective|Bittensor|Synth|Blocked\.?|freezes itself|real|every single limit|on-chain|capital|plans|verifies|enforces)\b/g;
const clean = (s) => s.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
const captions = [];
for (let i = 0; i < NS; i++) {
  const sentences = clean(script.scenes[i].vo).match(/[^.!?]+[.!?]+/g) ?? [clean(script.scenes[i].vo)];
  // merge very short fragments with the next sentence for readability
  const chunks = [];
  for (const s of sentences.map((x) => x.trim())) {
    if (chunks.length && chunks.at(-1).length < 28) chunks[chunks.length - 1] += " " + s;
    else chunks.push(s);
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  let t = segStart[i];
  const span = voEnd[i] - voStart[i];
  for (const c of chunks) {
    const d = (c.length / total) * span;
    captions.push({ text: c.replace(KEY, "*$1*"), start: t, end: t + d - 0.04 });
    t += d;
  }
}
const CHAPTERS = ["01 · Plan once", "02 · Three layers", "03 · Try to break it", "04 · Live markets", "05 · Review & sign", "06 · On-chain evidence"];
const browser = await launch();
await renderOverlays(browser, captions.map((c) => c.text), CHAPTERS);
await browser.close();

// ---------------------------------------------------------------- 4. transitions + overlays + audio, one pass
const TRANS = ["fadeblack", "smoothleft", "slideup", "wipeleft", "smoothup", "fadeblack", "fade"];
const args = ["-y", "-loglevel", "error"];
sceneFiles.forEach((f) => args.push("-i", f));
let fc = "";
let prev = "[0:v]";
let offset = 0;
for (let i = 1; i < NS; i++) {
  offset += sceneDur[i - 1];
  const lbl = `[x${i}]`;
  fc += `${prev}[${i}:v]xfade=transition=${TRANS[(i - 1) % TRANS.length]}:duration=${XF}:offset=${(offset).toFixed(3)}${lbl};`;
  prev = lbl;
}
let idx = NS;
const ov = join(OUT, "overlays");
// chapter tags: first 3.2s of scenes 1..6
for (let c = 0; c < CHAPTERS.length; c++) {
  const s = cut[c + 1] + 0.35, d = 3.2;
  args.push("-loop", "1", "-t", String(d), "-i", join(ov, `chap-${c}.png`));
  fc += `[${idx}:v]format=rgba,fade=t=in:st=0:d=0.3:alpha=1,fade=t=out:st=${d - 0.35}:d=0.35:alpha=1,setpts=PTS+${s.toFixed(3)}/TB[ch${c}];`;
  fc += `${prev}[ch${c}]overlay=0:0:enable='between(t,${s.toFixed(3)},${(s + d).toFixed(3)})'[vc${c}];`;
  prev = `[vc${c}]`;
  idx++;
}
captions.forEach((c, k) => {
  const d = Math.max(0.6, c.end - c.start);
  args.push("-loop", "1", "-t", d.toFixed(3), "-i", join(ov, `cap-${k}.png`));
  fc += `[${idx}:v]format=rgba,fade=t=in:st=0:d=0.18:alpha=1,fade=t=out:st=${(d - 0.18).toFixed(3)}:d=0.18:alpha=1,setpts=PTS+${c.start.toFixed(3)}/TB[cp${k}];`;
  fc += `${prev}[cp${k}]overlay=0:0:enable='between(t,${c.start.toFixed(3)},${(c.start + d).toFixed(3)})'[vk${k}];`;
  prev = `[vk${k}]`;
  idx++;
});
fc += `${prev}format=yuv420p[vout];`;
// audio: VO (delayed) + score ducked under it
args.push("-i", spaced, "-i", join(OUT, "music.wav"));
const voI = idx, muI = idx + 1;
fc += `[${voI}:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=0:${total.toFixed(3)},asplit=2[vo][key];`;
fc += `[${muI}:a]atrim=0:${total.toFixed(3)},volume=0.42,afade=t=out:st=${(total - 4).toFixed(3)}:d=4[mu];`;
fc += `[mu][key]sidechaincompress=threshold=0.035:ratio=6:attack=15:release=320[duck];`;
fc += `[vo][duck]amix=inputs=2:normalize=0:weights=1 1,loudnorm=I=-14:TP=-1.2:LRA=9[aout]`;
writeFileSync(join(OUT, "filter.txt"), fc);
const final = join(OUT, "zhi-demo.mp4");
args.push("-filter_complex_script", join(OUT, "filter.txt"), "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-crf", "17", "-preset", "slow", "-profile:v", "high", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-b:a", "256k", "-movflags", "+faststart", "-t", total.toFixed(3), final);
sh("ffmpeg", args);
console.log("final:", final, `${dur(final).toFixed(1)}s`);
