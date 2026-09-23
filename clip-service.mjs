import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);
const options = { timeout: 90000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 };
export function clipPath(directory, userId, id) {
  if (!/^\d+$/.test(String(userId)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(id))) throw new Error("Clip invalide.");
  return path.join(directory, `clip-${userId}-${id}.mp4`);
}
export async function readClip(directory, userId, id) {
  const filename = clipPath(directory, userId, id);
  const metadata = JSON.parse(await fs.readFile(filename + ".json", "utf8"));
  const file = await fs.stat(filename);
  if (!file.isFile() || !file.size || !Number.isFinite(metadata.duration) || metadata.duration < 1 || metadata.duration > 30.1) throw new Error("Clip invalide.");
  return { filename, duration: metadata.duration };
}
export async function prepareClip(input, directory, userId) {
  const id = crypto.randomUUID();
  const output = clipPath(directory, userId, id);
  const poster = output + ".jpg";
  try {
    await run(ffmpegPath, ["-hide_banner","-loglevel","error","-nostdin","-y",
      "-protocol_whitelist","file,pipe","-format_whitelist","mov,matroska,webm",
      "-i",input,"-map","0:v:0","-t","31","-an",
      "-vf","scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30",
      "-c:v","libx264","-preset","veryfast","-crf","23","-threads","2","-pix_fmt","yuv420p","-movflags","+faststart",output], options);
    // Inspect our normalized MP4 using the bundled FFmpeg (no ffprobe dependency).
    let detail = "";
    try { await run(ffmpegPath, ["-hide_banner","-i",output], options); }
    catch (error) { detail = String(error.stderr || ""); }
    const match = detail.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    const duration = match ? Number(match[1])*3600 + Number(match[2])*60 + Number(match[3]) : NaN;
    if (!Number.isFinite(duration) || duration < 1 || duration > 30.1) throw new Error("Chaque clip doit durer entre 1 et 30 secondes.");
    await run(ffmpegPath, ["-hide_banner","-loglevel","error","-nostdin","-y","-i",output,
      "-frames:v","1","-vf","scale=180:320","-q:v","5",poster], options);
    const thumbnail = "data:image/jpeg;base64," + (await fs.readFile(poster)).toString("base64");
    await fs.writeFile(output + ".json", JSON.stringify({ duration }));
    return { id, duration, thumbnail, url: `/api/video/clips/${id}` };
  } catch (error) {
    await Promise.allSettled([output, output + ".json"].map(file=>fs.unlink(file)));
    throw error;
  } finally { await fs.unlink(poster).catch(()=>{}); }
}
export async function fitClips(clips, duration, directory) {
  if (!Array.isArray(clips) || clips.length !== 4 || !Number.isFinite(duration) || duration <= 0 || duration > 60) throw new Error("Montage invalide.");
  const folder = await fs.mkdtemp(path.join(directory, "fit-"));
  const cleanup = ()=>fs.rm(folder, { recursive:true, force:true });
  const transition = { fade:0.3, clipDuration:Math.ceil(((Math.max(2,duration)+0.9)/4)*30)/30 };
  try {
    const paths = [];
    for (let i=0;i<4;i++) {
      const output = path.join(folder, `scene-${i}.mp4`);
      await run(ffmpegPath, ["-hide_banner","-loglevel","error","-nostdin","-y",
        "-protocol_whitelist","file,pipe","-stream_loop","-1","-i",clips[i].filename,
        "-t",String(transition.clipDuration),"-map","0:v:0","-an",
        "-c:v","libx264","-preset","veryfast","-crf","23","-threads","2","-pix_fmt","yuv420p","-movflags","+faststart",output], options);
      paths.push(output);
    }
    return { paths, transition, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
