import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const runFile = promisify(execFile);

// Réservé aux fichiers locaux fournis par le serveur.
// Ne pas transmettre directement des chemins reçus du navigateur.
export async function assembleVideoClips(clipPaths, audioPath = null) {
  if (!Array.isArray(clipPaths) || clipPaths.length !== 3) {
    throw new Error("L’assemblage exige exactement 3 clips.");
  }

  if (!ffmpegPath) {
    throw new Error("FFmpeg est indisponible sur ce serveur.");
  }

  for (const clipPath of clipPaths) {
    if (typeof clipPath !== "string" || !path.isAbsolute(clipPath)) {
      throw new Error("Chaque clip doit être un fichier local.");
    }

    const file = await stat(clipPath);

    if (!file.isFile() || file.size === 0) {
      throw new Error("Un clip est vide ou invalide.");
    }
  }

  if (audioPath) {
    if (!path.isAbsolute(audioPath)) throw new Error("Audio local invalide.");
    const audio = await stat(audioPath);
    if (!audio.isFile() || !audio.size) throw new Error("Audio vide.");
  }
  const directory = await mkdtemp(
    path.join(tmpdir(), "vira-assembly-")
  );

  const outputPath = path.join(directory, "vira-final.mp4");
  const cleanup = () => rm(directory, {
    recursive: true,
    force: true
  });

  try {
    const filters = clipPaths.map((_, index) =>
      `[${index}:v:0]` +
      "scale=720:1280:force_original_aspect_ratio=decrease," +
      "pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black," +
      "setsar=1,fps=30,format=yuv420p," +
      `settb=AVTB,setpts=PTS-STARTPTS[v${index}]`
    );

    filters.push(
      "[v0][v1][v2]concat=n=3:v=1:a=0[outv]"
    );

    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-nostdin",
      "-y"
    ];

    for (const clipPath of clipPaths) {
      args.push(
        "-protocol_whitelist", "file,pipe",
        "-i", clipPath
      );
    }

    if (audioPath) {
      args.push("-protocol_whitelist", "file,pipe", "-i", audioPath);

    }
    args.push(
      "-filter_complex_threads", "1",
      "-filter_complex", filters.join(";"),
      "-map", "[outv]",
      ...(audioPath ? ["-map","3:a:0","-c:a","aac","-b:a","128k","-shortest"] : ["-an"]),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-threads", "2",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath
    );

    await runFile(ffmpegPath, args, {
      timeout: 120000,
      killSignal: "SIGKILL",
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    });

    const output = await stat(outputPath);

    if (output.size === 0) {
      throw new Error("Le fichier MP4 produit est vide.");
    }

    // Le serveur devra appeler cleanup après l’envoi du MP4.
    return { outputPath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
