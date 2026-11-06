/** Demo-local continuous capture + segment-retiming proof. Not a Stop Motion public API. */
import { chromium } from "@playwright/test";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { parseArgs } from "node:util";
import { createPacedMouse } from "./paced-mouse.mjs";
const exec = promisify(execFile);
const { values, positionals } = parseArgs({ allowPositionals: true, options: { codec: { type: "string", default: "hevc" } } });
if (positionals.length > 1 || !["hevc", "h264"].includes(values.codec)) throw new Error('Usage: record-moon-boop.mjs [speech-directory] [--codec hevc|h264]');
const codec = values.codec;
const narrationDirectory = positionals[0] && path.resolve(positionals[0]);
const speechLengths = new Map();
if (narrationDirectory)
  for (const name of [
    "intro.wav",
    "collector.wav",
    "kittens.wav",
    "victory.wav",
  ]) {
    const { stdout } = await exec("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      path.join(narrationDirectory, name),
    ]);
    speechLengths.set(name, Number(stdout.trim()));
  }
const out = path.resolve(
  "ignore/moon-boop-videos",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await mkdir(path.join(out, "frames"), { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=d3d11"],
});
const frames = [],
  pointerTrack = [],
  segments = [],
  writes = [],
  errors = [];
let page, cdp,
  recording = false,
  firstTime,
  lastTime = -Infinity;
try {
  page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://triangular-demo.localhost:4200/cat-space-program", {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(
    () =>
      window.moonBoopDemo?.ready() &&
      document.querySelector("scene canvas").height > 400,
  );
  await page.addStyleTag({
    content:
      "#demo-pointer{position:fixed;z-index:99999;pointer-events:none;width:24px;height:30px;background:#fff4cc;clip-path:polygon(0 0,0 85%,24% 65%,43% 100%,60% 91%,42% 59%,78% 59%);filter:drop-shadow(1px 2px 2px #000);left:1050px;top:400px;transform:translate(-2px,-2px)}#demo-pointer.pressed{background:#a9e7a6}",
  });
  await page.evaluate(() => {
    const cursor = document.createElement("div");
    cursor.id = "demo-pointer";
    document.body.append(cursor);
    document.addEventListener("pointermove", (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
    });
    document.addEventListener("pointerdown", () =>
      cursor.classList.add("pressed"),
    );
    document.addEventListener("pointerup", () =>
      cursor.classList.remove("pressed"),
    );
  });
  const { click } = await createPacedMouse(page, {
    x: 1050, y: 400, onSample: sample => pointerTrack.push(sample),
  });
  const act = (action, value) =>
    page.evaluate(
      ({ action, value }) => window.moonBoopDemo.act(action, value),
      { action, value },
    );
  await act("reset", "kittens");
  await act("pause");
  cdp = await page.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", (frame) => {
    void cdp
      .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
      .catch(() => {});
    const timestamp = frame.metadata.timestamp;
    if (!recording || timestamp - lastTime < 1 / 15) return;
    firstTime ??= timestamp;
    lastTime = timestamp;
    const file = `frames/${String(frames.length).padStart(5, "0")}.jpg`;
    frames.push({
      file,
      sourceTime: timestamp - firstTime,
      capturedAt: timestamp,
    });
    writes.push(
      writeFile(path.join(out, file), Buffer.from(frame.data, "base64")),
    );
  });
  const clock = () => Date.now() / 1000 - firstTime;
  const segment = async (id, speed, caption, fn, speech) => {
    const start = clock();
    await fn();
    if (speech && speechLengths.has(speech))
      await hold(
        Math.max(
          0,
          speechLengths.get(speech) + 0.25 - (clock() - start) / speed,
        ) * 1000,
      );
    segments.push({ id, start, end: clock(), speed, caption, speech });
  };
  const hold = (milliseconds) => page.waitForTimeout(milliseconds); // Authored presentation holds, never readiness gates.
  recording = true;
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 82,
    maxWidth: 1440,
    maxHeight: 960,
    everyNthFrame: 1,
  });
  // The recorder's first frame is the source-time origin, independent of page-load time.
  while (firstTime === undefined) {
    await hold(20);
  }
  await segment(
    "briefing",
    1,
    "Operation Moon Boop · one human, eighteen cats",
    async () => {
      await hold(5800);
    },
    "intro.wav",
  );
  await segment(
    "assign",
    1,
    "A few clicks. The collector handles the walking.",
    async () => {
      await click(page.getByRole("button", { name: "Resume", exact: true }));
      for (let i = 0; i < 3; i++)
        await click(
          page.getByRole("button", { name: "Stack one waiting cat" }),
        );
      await click(page.getByRole("button", { name: "Zoomies shoes" }));
      await click(
        page.getByRole("button", {
          name: "Start collecting cats",
          exact: true,
        }),
      );
      await act("select", "collector");
      await click(
        page.getByRole("button", { name: "Show focus box", exact: true }),
      );
      await hold(2500);
    },
    "collector.wav",
  );
  await segment(
    "kitten-countdown",
    3,
    "Waiting for six kittens · footage accelerated",
    async () => {
      await page.waitForFunction(
        () =>
          window.moonBoopDemo.read().cats.filter((c) => c.source === "nursery")
            .length >= 6,
        undefined,
        { timeout: 90000 },
      );
    },
  );
  await segment(
    "kitten-arrival",
    1,
    "Six tiny astronauts. One extremely patient human.",
    async () => {
      await click(
        page.getByRole("button", { name: "Follow human", exact: true }),
      );
      await hold(5200);
      await click(page.getByRole("button", { name: "Overview", exact: true }));
    },
    "kittens.wav",
  );
  await segment(
    "gathering",
    5,
    "Gathering and hauling · footage accelerated",
    async () => {
      await page.waitForFunction(
        () => window.moonBoopDemo.read().time >= 37,
        undefined,
        { timeout: 120000 },
      );
    },
  );
  await segment(
    "moon-boop",
    1,
    "One giant boop for catkind.",
    async () => {
      // Use the same normal manual action for the final launch-stack contribution.
      while (!(await page.evaluate(() => window.moonBoopDemo.read().won))) {
        const state = await page.evaluate(() => window.moonBoopDemo.read());
        if (!state.cats.some((c) => c.place === "waiting"))
          throw new Error("No waiting cats for the final tower");
        await click(
          page.getByRole("button", { name: "Stack one waiting cat" }),
        );
      }
      await click(page.getByRole("button", { name: "Moon cam", exact: true }));
      await act("select", "tower");
      await page.screenshot({ path: path.join(out, "victory.png") });
      await hold(5800);
    },
    "victory.wav",
  );
  recording = false;
  await cdp.send("Page.stopScreencast");
  await Promise.all(writes);
  if (errors.length) throw new Error(errors.join("\n"));
  await writeFile(
    path.join(out, "frame-times.json"),
    JSON.stringify(frames, null, 2),
  );
  await writeFile(path.join(out, "pointer-track.json"), JSON.stringify(pointerTrack.map(p => ({ ...p, sourceTime: p.at - firstTime })), null, 2));
  let outputTime = 0;
  for (const entry of segments) {
    entry.outputStart = outputTime;
    entry.outputDuration = (entry.end - entry.start) / entry.speed;
    outputTime += entry.outputDuration;
  }
  const result = {
    producer: "demo-local CDP capture and FFmpeg retiming proof",
    sourceMode: "continuous-browser-page",
    frames: frames.length,
    sourceDuration: frames.at(-1).sourceTime,
    outputDuration: outputTime,
    codec,
    pointerSamples: pointerTrack.length,
    segments,
    state: await page.evaluate(() => window.moonBoopDemo.read()),
    errors,
    limitations: [
      "Diagnostic recording, not performance evidence.",
      "Game simulation clamps stalled-frame deltas; source wall time and game time are retained separately.",
      "No in-game sound effects yet; optional supplied narration is mixed on the output timeline.",
      "CDP capture is an explicit demo-local proof, not the packaged Stop Motion continuous-video API.",
    ],
  };
  await writeFile(
    path.join(out, "recording.json"),
    JSON.stringify(result, null, 2),
  );
  await browser.close();
  const concat =
    frames
      .map(
        (f, i) =>
          `file '${f.file}'\nduration ${Math.max(0.001, (frames[i + 1]?.sourceTime ?? f.sourceTime + 1 / 15) - f.sourceTime)}`,
      )
      .join("\n") + `\nfile '${frames.at(-1).file}'\n`;
  await writeFile(path.join(out, "source-frames.txt"), concat);
  await exec(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "source-frames.txt",
      "-fps_mode",
      "vfr",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "source.mp4",
    ],
    { cwd: out, maxBuffer: 4 * 1024 * 1024 },
  );
  await copyFile(
    path.join(process.env.WINDIR ?? "C:/Windows", "Fonts/segoeui.ttf"),
    path.join(out, "font.ttf"),
  );
  const inputs = ["-i", "source.mp4"];
  const audio = [];
  if (narrationDirectory)
    for (const entry of segments.filter((s) => s.speech)) {
      const filename = `speech-${audio.length}.wav`;
      await copyFile(
        path.join(narrationDirectory, entry.speech),
        path.join(out, filename),
      );
      inputs.push("-i", filename);
      audio.push(entry);
    }
  const filters = [],
    videos = [];
  segments.forEach((s, i) => {
    const speedBadge =
      s.speed > 1
        ? `,drawbox=x=iw-190:y=220:w=160:h=48:color=black@0.7:t=fill,drawtext=fontfile=font.ttf:text='${s.speed}x SPEED':x=w-174:y=230:fontsize=24:fontcolor=0xe6edc9`
        : "";
    filters.push(
      `[0:v]trim=start=${s.start}:end=${s.end},setpts=(PTS-STARTPTS)/${s.speed},fps=30,scale=in_range=pc:out_range=tv,format=yuv420p,drawbox=x=330:y=820:w=1080:h=50:color=black@0.65:t=fill,drawtext=fontfile=font.ttf:text='${s.caption}':x=348:y=834:fontsize=22:fontcolor=white${speedBadge}[v${i}]`,
    );
    videos.push(`[v${i}]`);
  });
  filters.push(`${videos.join("")}concat=n=${segments.length}:v=1:a=0[v]`);
  audio.forEach((s, i) =>
    filters.push(
      `[${i + 1}:a]adelay=${Math.round(s.outputStart * 1000)}:all=1[a${i}]`,
    ),
  );
  if (audio.length)
    filters.push(
      `${audio.map((_, i) => `[a${i}]`).join("")}amix=inputs=${audio.length}:normalize=0,apad,atrim=duration=${outputTime}[a]`,
    );
  await writeFile(path.join(out, "edit-filter.txt"), filters.join(";\n"));
  await exec(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      ...inputs,
      "-filter_complex_script",
      "edit-filter.txt",
      "-map",
      "[v]",
      ...(audio.length ? ["-map", "[a]", "-c:a", "aac", "-b:a", "128k"] : []),
      "-c:v",
      codec === "hevc" ? "libx265" : "libx264",
      "-preset",
      "medium",
      "-crf",
      codec === "hevc" ? "28" : "23",
      ...(codec === "hevc" ? ["-tag:v", "hvc1"] : []),
      "-pix_fmt",
      "yuv420p",
      "-color_range",
      "tv",
      "-movflags",
      "+faststart",
      "demo.mp4",
    ],
    { cwd: out, maxBuffer: 4 * 1024 * 1024 },
  );
  console.log(
    JSON.stringify({
      out,
      video: path.join(out, "demo.mp4"),
      source: path.join(out, "source.mp4"),
      duration: outputTime,
      narration: audio.length > 0,
      codec,
    }),
  );
} catch (error) {
  recording = false;
  await page?.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  await cdp?.send("Page.stopScreencast").catch(() => {});
  await Promise.allSettled(writes);
  await writeFile(
    path.join(out, "failure.json"),
    JSON.stringify(
      { error: error.stack, errors, frames: frames.length, segments },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
