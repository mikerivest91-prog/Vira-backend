import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, stat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { wavDuration } from "./audio-service.mjs";

const runFile = promisify(execFile);
let assembling = false;

// Server-owned local paths only. One decoder and encoder at a time.
export async function assembleVideoClips(clipPaths, audioPath = null, transition = null, onProgress = () => {}) {
  if (!Array.isArray(clipPaths) || clipPaths.length !== 4) throw new Error("L’assemblage exige exactement 4 clips.");
  if (assembling) throw new Error("Une vidéo est en cours de préparation. Réessayez après sa fin.");
  if (!ffmpegPath) throw new Error("FFmpeg est indisponible sur ce serveur.");
  if (transition && (!Number.isFinite(transition.fade) || !Number.isFinite(transition.clipDuration) || transition.fade <= 0 || transition.fade >= transition.clipDuration)) throw new Error("Durée de transition invalide.");
  assembling = true;
  let directory;
  const cleanup = async () => { if (directory) await rm(directory, { recursive: true, force: true }); };
  const run = args => runFile(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], {
    timeout: 180000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, windowsHide: true
  });
  try {
    for (const filePath of [...clipPaths, ...(audioPath ? [audioPath] : [])]) {
      if (typeof filePath !== "string" || !path.isAbsolute(filePath)) throw new Error("Fichier local invalide.");
      const file = await stat(filePath);
      if (!file.isFile() || !file.size) throw new Error("Un fichier source est vide ou invalide.");
    }
    const narrationDuration = audioPath ? await wavDuration(audioPath) : null;
    directory = await mkdtemp(path.join(tmpdir(), "vira-assembly-"));
    for (let i = 0; i < 4; i++) {
      // Preserve total duration when replacing overlapping transitions with cuts.
      const duration = narrationDuration ? Math.ceil(narrationDuration / 4 * 30) / 30 : transition ? transition.clipDuration - (i < 3 ? transition.fade : 0) : null;
      await run([
        "-threads", "1", "-protocol_whitelist", "file,pipe", ...(narrationDuration ? ["-stream_loop", "-1"] : []), "-i", clipPaths[i],
        "-map", "0:v:0", "-an", "-sn", "-dn",
        ...(duration ? ["-t", String(duration)] : []),
        "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p",
        "-filter_threads", "1", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
        "-threads", "1", "-video_track_timescale", "15360", path.join(directory, `scene-${i}.mp4`)
      ]);
      onProgress((i + 1) * 20);
    }
    await writeFile(path.join(directory, "clips.txt"), clipPaths.map((_, i) => `file 'scene-${i}.mp4'`).join("\n"));
    const outputPath = path.join(directory, "vira-final.mp4");
    await run([
      "-f", "concat", "-safe", "1", "-i", path.join(directory, "clips.txt"),
      ...(audioPath ? ["-threads", "1", "-i", audioPath] : []),
      "-map", "0:v:0", ...(audioPath ? ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-t", String(narrationDuration)] : ["-c:v", "copy"]),
      ...(audioPath ? ["-map", "1:a:0", "-c:a", "aac", "-b:a", "64k", "-shortest"] : ["-an"]),
      "-threads", "1", "-movflags", "+faststart", outputPath
    ]);
    if (!(await stat(outputPath)).size) throw new Error("Le fichier MP4 produit est vide.");
    onProgress(100);
    return { outputPath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  } finally {
    assembling = false;
  }
}
