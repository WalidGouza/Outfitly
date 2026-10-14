// Renders the app's motion videos into frontend/public/video/.
//   npm run render              light + dark loops (WebM + MP4) and posters
//   npm run render -- --stills  only review stills of key frames, into out/
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "frontend", "public", "video");
const stillsOnly = process.argv.includes("--stills");

const serveUrl = await bundle({ entryPoint: path.join(here, "src", "index.ts") });

for (const [id, theme] of [
  ["StudioLoopLight", "light"],
  ["StudioLoopDark", "dark"],
]) {
  const composition = await selectComposition({ serveUrl, id });

  if (stillsOnly) {
    await mkdir(path.join(here, "out"), { recursive: true });
    for (const frame of [0, 40, 80, 125, 172, 196, 222, 239]) {
      await renderStill({
        serveUrl,
        composition,
        frame,
        output: path.join(here, "out", `${theme}-${String(frame).padStart(3, "0")}.png`),
      });
    }
    console.log(`${theme}: stills written to out/`);
    continue;
  }

  await mkdir(publicDir, { recursive: true });
  const base = path.join(publicDir, `studio-loop-${theme}`);
  // Poster = frame 0, which is also the last frame of the loop.
  await renderStill({ serveUrl, composition, frame: 0, output: `${base}.jpg`, imageFormat: "jpeg", jpegQuality: 82 });
  // VP9 WebM for Chrome/Firefox/Edge, H.264 MP4 as the universal fallback (Safari).
  // BT.709 with PNG frames keeps colours exact: the background must decode to the
  // app's board colour so the video blends into the board with no visible edge.
  const accurate = { colorSpace: "bt709", imageFormat: "png", muted: true };
  await renderMedia({ serveUrl, composition, codec: "vp9", crf: 36, outputLocation: `${base}.webm`, ...accurate });
  await renderMedia({ serveUrl, composition, codec: "h264", crf: 26, outputLocation: `${base}.mp4`, pixelFormat: "yuv420p", ...accurate });
  console.log(`${theme}: ${base}.{webm,mp4,jpg}`);
}
