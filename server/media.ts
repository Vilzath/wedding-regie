import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {mkdir, rename, rm, stat, unlink} from "node:fs/promises";
import {extname, join, resolve, sep} from "node:path";
import type {MediaAsset} from "@prisma/client";
import {config} from "./config.js";
import {prisma} from "./db.js";

export type AssetKindValue = "AUDIO" | "IMAGE";

const audioTypes = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/aac",
  "audio/flac",
]);
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function acceptsUpload(kind: AssetKindValue, mimeType: string): boolean {
  return kind === "AUDIO" ? audioTypes.has(mimeType) : imageTypes.has(mimeType);
}

function extensionFor(file: Express.Multer.File): string {
  const original = extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "");
  if (original && original.length <= 10) return original;
  const byMime: Record<string, string> = {
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/webm": ".webm",
    "audio/aac": ".aac",
    "audio/flac": ".flac",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  return byMime[file.mimetype] ?? ".bin";
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function initializeMediaDirectories(): Promise<void> {
  await Promise.all([
    mkdir(config.mediaRoot, {recursive: true}),
    mkdir(config.uploadTmpDir, {recursive: true}),
  ]);
}

export async function discardUpload(file?: Express.Multer.File): Promise<void> {
  if (file?.path) await rm(file.path, {force: true});
}

export async function persistUpload(
  file: Express.Multer.File,
  kind: AssetKindValue,
): Promise<MediaAsset> {
  if (!acceptsUpload(kind, file.mimetype)) {
    await discardUpload(file);
    throw Object.assign(new Error(`Format ${kind === "AUDIO" ? "audio" : "d’image"} non accepté.`), {
      status: 400,
    });
  }
  if ((kind === "AUDIO" && file.size > 150 * 1024 * 1024) || (kind === "IMAGE" && file.size > 8 * 1024 * 1024)) {
    await discardUpload(file);
    throw Object.assign(new Error("Fichier trop volumineux."), {status: 413});
  }

  const digest = await sha256(file.path);
  const existing = await prisma.mediaAsset.findUnique({where: {kind_sha256: {kind, sha256: digest}}});
  if (existing) {
    await discardUpload(file);
    return existing;
  }

  const relativePath = join(kind.toLowerCase(), `${digest}${extensionFor(file)}`);
  const target = safeMediaPath(relativePath);
  await mkdir(resolve(target, ".."), {recursive: true});
  try {
    await rename(file.path, target);
  } catch {
    await discardUpload(file);
    throw Object.assign(new Error("Impossible de stocker le fichier."), {status: 500});
  }

  try {
    return await prisma.mediaAsset.create({
      data: {
        kind,
        sha256: digest,
        originalName: file.originalname.slice(0, 255),
        mimeType: file.mimetype,
        sizeBytes: BigInt(file.size),
        storagePath: relativePath,
      },
    });
  } catch (error) {
    const raced = await prisma.mediaAsset.findUnique({where: {kind_sha256: {kind, sha256: digest}}});
    if (raced) return raced;
    await rm(target, {force: true});
    throw error;
  }
}

export function safeMediaPath(relativePath: string): string {
  const root = resolve(config.mediaRoot);
  const result = resolve(root, relativePath);
  if (result !== root && !result.startsWith(`${root}${sep}`)) throw new Error("Chemin média invalide.");
  return result;
}

export async function assetFileStat(asset: MediaAsset) {
  return stat(safeMediaPath(asset.storagePath));
}

export async function cleanupOrphanAssets(): Promise<void> {
  const orphans = await prisma.mediaAsset.findMany({
    where: {audioButtons: {none: {}}, imageButtons: {none: {}}},
  });
  if (!orphans.length) return;

  await prisma.mediaAsset.deleteMany({where: {id: {in: orphans.map((asset: MediaAsset) => asset.id)}}});
  await Promise.all(
    orphans.map((asset: MediaAsset) => unlink(safeMediaPath(asset.storagePath)).catch(() => undefined)),
  );
}
