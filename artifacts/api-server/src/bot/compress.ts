import sharp from "sharp";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { logger } from "../lib/logger";

const execFileAsync = promisify(execFile);

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff"];
const PDF_EXT = "pdf";
const VIDEO_EXTS = ["mp4", "mov", "avi", "mkv", "webm", "3gp"];

function getExt(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function tmpPath(name: string): string {
  return join(tmpdir(), `bot_${Date.now()}_${name}`);
}

async function compressImage(buffer: Buffer, ext: string): Promise<{ buffer: Buffer; mime: string }> {
  const instance = sharp(buffer);
  const meta = await instance.metadata();
  const width = meta.width ?? 2048;

  const maxWidth = 2048;
  const resized = width > maxWidth ? instance.resize(maxWidth) : instance;

  if (ext === "png") {
    const out = await resized.png({ compressionLevel: 8, quality: 80 }).toBuffer();
    return { buffer: out, mime: "image/png" };
  }

  const out = await resized.jpeg({ quality: 78, mozjpeg: true }).toBuffer();
  return { buffer: out, mime: "image/jpeg" };
}

async function compressPdf(buffer: Buffer): Promise<Buffer> {
  const inputPath = tmpPath("input.pdf");
  const outputPath = tmpPath("output.pdf");

  await writeFile(inputPath, buffer);

  try {
    await execFileAsync("gs", [
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      "-dPDFSETTINGS=/ebook",
      "-dNOPAUSE",
      "-dQUIET",
      "-dBATCH",
      `-sOutputFile=${outputPath}`,
      inputPath,
    ]);

    const compressed = await readFile(outputPath);

    if (compressed.length >= buffer.length) {
      logger.info("PDF compression did not reduce size, using original");
      return buffer;
    }

    const reduction = Math.round((1 - compressed.length / buffer.length) * 100);
    logger.info({ reduction: `${reduction}%` }, "PDF compressed");
    return compressed;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

async function compressVideo(buffer: Buffer, ext: string): Promise<Buffer> {
  const inputPath = tmpPath(`input.${ext}`);
  const outputPath = tmpPath("output.mp4");

  await writeFile(inputPath, buffer);

  try {
    await execFileAsync("ffmpeg", [
      "-i", inputPath,
      "-vcodec", "libx264",
      "-crf", "28",
      "-preset", "fast",
      "-acodec", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "-y",
      outputPath,
    ]);

    const compressed = await readFile(outputPath);

    if (compressed.length >= buffer.length) {
      logger.info("Video compression did not reduce size, using original");
      return buffer;
    }

    const reduction = Math.round((1 - compressed.length / buffer.length) * 100);
    logger.info({ reduction: `${reduction}%` }, "Video compressed");
    return compressed;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

export interface CompressResult {
  buffer: Buffer;
  mime: string;
  fileName: string;
  compressed: boolean;
  originalSize: number;
  finalSize: number;
}

export async function compressFile(
  buffer: Buffer,
  fileName: string,
  mime: string
): Promise<CompressResult> {
  const ext = getExt(fileName);
  const originalSize = buffer.length;

  try {
    if (IMAGE_EXTS.includes(ext)) {
      const { buffer: out, mime: outMime } = await compressImage(buffer, ext);
      const outName = ext === "png" ? fileName : fileName.replace(/\.[^.]+$/, ".jpg");
      return {
        buffer: out,
        mime: outMime,
        fileName: outName,
        compressed: out.length < originalSize,
        originalSize,
        finalSize: out.length,
      };
    }

    if (ext === PDF_EXT) {
      const out = await compressPdf(buffer);
      return {
        buffer: out,
        mime: "application/pdf",
        fileName,
        compressed: out.length < originalSize,
        originalSize,
        finalSize: out.length,
      };
    }

    if (VIDEO_EXTS.includes(ext)) {
      const out = await compressVideo(buffer, ext);
      const outName = fileName.replace(/\.[^.]+$/, ".mp4");
      return {
        buffer: out,
        mime: "video/mp4",
        fileName: outName,
        compressed: out.length < originalSize,
        originalSize,
        finalSize: out.length,
      };
    }
  } catch (err) {
    logger.error({ err, fileName }, "Compression failed, using original");
  }

  return { buffer, mime, fileName, compressed: false, originalSize, finalSize: originalSize };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
