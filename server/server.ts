import {createReadStream} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import type {Prisma} from "@prisma/client";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express, {type NextFunction, type Request, type Response} from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import {z} from "zod";
import {
  createSession,
  destroySession,
  requireAdmin,
  requireAuth,
  type AuthenticatedRequest,
} from "./auth.js";
import {config} from "./config.js";
import {prisma} from "./db.js";
import {
  assetFileStat,
  cleanupOrphanAssets,
  discardUpload,
  initializeMediaDirectories,
  persistUpload,
  safeMediaPath,
} from "./media.js";
import {seedUsers} from "./seed.js";
import {normalizeTag, removeScriptTag, replaceScriptTag} from "./text-utils.js";

export const app = express();
app.set("trust proxy", config.trustProxy);
app.disable("x-powered-by");
app.use(
  helmet({
    crossOriginResourcePolicy: {policy: "same-origin"},
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "img-src": ["'self'", "data:", "blob:"],
        "media-src": ["'self'", "blob:"],
        "style-src": ["'self'", "'unsafe-inline'"],
      },
    },
  }),
);
app.use(express.json({limit: "1mb"}));
app.use(cookieParser());

const loginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});
const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
});
const buttonSchema = z.object({
  name: z.string().trim().min(1).max(120),
  tag: z.string().trim().min(1).max(100).transform(normalizeTag).pipe(z.string().min(1).max(80)),
  description: z.string().trim().max(300).default(""),
  categoryId: z.string().uuid(),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  removeImage: z.enum(["true", "false"]).optional(),
});
const scriptSchema = z.object({content: z.string().max(100_000)});
const playlistSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).default(""),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  buttonIds: z.array(z.string().uuid()).min(1).max(100).refine(
    (ids) => new Set(ids).size === ids.length,
    {message: "Une musique ne peut apparaître qu’une fois dans la playlist."},
  ),
});

function routeId(request: Request): string {
  const id = request.params["id"];
  if (typeof id !== "string") throw Object.assign(new Error("Identifiant invalide."), {status: 400});
  return id;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {message: "Trop de tentatives. Réessaie dans quelques minutes."},
});

app.post("/api/auth/login", loginLimiter, async (request, response) => {
  const payload = loginSchema.parse(request.body);
  const user = await prisma.user.findUnique({where: {username: payload.username}});
  if (!user || !(await bcrypt.compare(payload.password, user.passwordHash))) {
    response.status(401).json({message: "Identifiant ou mot de passe incorrect."});
    return;
  }

  await createSession(user.id, response);
  response.json({user: {id: user.id, username: user.username, role: user.role}});
});

app.post("/api/auth/logout", async (request, response) => {
  await destroySession(request, response);
  response.status(204).end();
});

app.get("/healthz", async (_request, response) => {
  await prisma.$queryRawUnsafe("SELECT 1");
  response.json({status: "ok"});
});

app.use("/api", requireAuth);

app.get("/api/auth/me", (request: AuthenticatedRequest, response) => {
  response.json({user: request.authUser});
});

const buttonInclude = {
  category: true,
  audioAsset: true,
  imageAsset: true,
} satisfies Prisma.MusicButtonInclude;
type ButtonWithAssets = {
  id: string;
  name: string;
  tag: string;
  description: string;
  sortOrder: number;
  categoryId: string;
  audioAssetId: string;
  imageAssetId: string | null;
  category: {name: string};
  audioAsset: {originalName: string};
};

function buttonDto(button: ButtonWithAssets) {
  return {
    id: button.id,
    name: button.name,
    tag: button.tag,
    description: button.description,
    sortOrder: button.sortOrder,
    categoryId: button.categoryId,
    categoryName: button.category.name,
    audioAssetId: button.audioAssetId,
    audioName: button.audioAsset.originalName,
    audioUrl: `/api/media/${button.audioAssetId}`,
    imageAssetId: button.imageAssetId,
    imageUrl: button.imageAssetId ? `/api/media/${button.imageAssetId}` : null,
  };
}

const playlistInclude = {
  items: {
    include: {button: {include: buttonInclude}},
    orderBy: [{sortOrder: "asc" as const}, {id: "asc" as const}],
  },
} satisfies Prisma.PlaylistInclude;
type PlaylistWithButtons = Prisma.PlaylistGetPayload<{include: typeof playlistInclude}>;

function playlistDto(playlist: PlaylistWithButtons) {
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    sortOrder: playlist.sortOrder,
    buttons: playlist.items.map((item) => buttonDto(item.button)),
  };
}

async function loadBootstrap() {
  const [categories, buttons, playlists, script] = await Promise.all([
    prisma.category.findMany({orderBy: [{sortOrder: "asc"}, {name: "asc"}]}),
    prisma.musicButton.findMany({
      include: buttonInclude,
      orderBy: [{category: {sortOrder: "asc"}}, {sortOrder: "asc"}, {name: "asc"}],
    }),
    prisma.playlist.findMany({
      include: playlistInclude,
      orderBy: [{sortOrder: "asc"}, {name: "asc"}],
    }),
    prisma.ceremonyScript.findUnique({where: {id: "main"}}),
  ]);
  return {
    categories: categories.map(
      ({id, name, sortOrder}: {id: string; name: string; sortOrder: number}) => ({id, name, sortOrder}),
    ),
    buttons: buttons.map(buttonDto),
    playlists: playlists.map(playlistDto),
    script: {content: script?.content ?? "", updatedAt: script?.updatedAt ?? null},
  };
}

app.get("/api/bootstrap", async (request: AuthenticatedRequest, response) => {
  response.json({user: request.authUser, ...(await loadBootstrap())});
});

app.post("/api/categories", requireAdmin, async (request, response) => {
  const payload = categorySchema.parse(request.body);
  const category = await prisma.category.create({data: payload});
  response.status(201).json(category);
});

app.put("/api/categories/:id", requireAdmin, async (request, response) => {
  const payload = categorySchema.parse(request.body);
  const category = await prisma.category.update({where: {id: routeId(request)}, data: payload});
  response.json(category);
});

app.delete("/api/categories/:id", requireAdmin, async (request, response) => {
  const id = routeId(request);
  const buttonCount = await prisma.musicButton.count({where: {categoryId: id}});
  if (buttonCount > 0) {
    response.status(409).json({message: "Déplace ou supprime d’abord les boutons de cette catégorie."});
    return;
  }
  await prisma.category.delete({where: {id}});
  response.status(204).end();
});

function playlistItems(buttonIds: string[]) {
  return buttonIds.map((buttonId, index) => ({buttonId, sortOrder: (index + 1) * 10}));
}

app.post("/api/playlists", requireAdmin, async (request, response) => {
  const payload = playlistSchema.parse(request.body);
  const playlist = await prisma.playlist.create({
    data: {
      name: payload.name,
      description: payload.description,
      sortOrder: payload.sortOrder,
      items: {create: playlistItems(payload.buttonIds)},
    },
    include: playlistInclude,
  });
  response.status(201).json(playlistDto(playlist));
});

app.put("/api/playlists/:id", requireAdmin, async (request, response) => {
  const payload = playlistSchema.parse(request.body);
  const playlist = await prisma.playlist.update({
    where: {id: routeId(request)},
    data: {
      name: payload.name,
      description: payload.description,
      sortOrder: payload.sortOrder,
      items: {deleteMany: {}, create: playlistItems(payload.buttonIds)},
    },
    include: playlistInclude,
  });
  response.json(playlistDto(playlist));
});

app.delete("/api/playlists/:id", requireAdmin, async (request, response) => {
  await prisma.playlist.delete({where: {id: routeId(request)}});
  response.status(204).end();
});

const upload = multer({
  dest: config.uploadTmpDir,
  limits: {files: 2, fileSize: 150 * 1024 * 1024},
}).fields([
  {name: "audio", maxCount: 1},
  {name: "image", maxCount: 1},
]);

function uploads(request: Request): {audio?: Express.Multer.File; image?: Express.Multer.File} {
  const files = request.files as Record<string, Express.Multer.File[]> | undefined;
  return {audio: files?.["audio"]?.[0], image: files?.["image"]?.[0]};
}

async function discardUploads(files: {audio?: Express.Multer.File; image?: Express.Multer.File}): Promise<void> {
  await Promise.all([discardUpload(files.audio), discardUpload(files.image)]);
}

app.post("/api/buttons", requireAdmin, upload, async (request, response) => {
  const files = uploads(request);
  try {
    const payload = buttonSchema.parse(request.body);
    if (!files.audio) {
      await discardUploads(files);
      response.status(400).json({message: "Un fichier audio est obligatoire."});
      return;
    }

    const audioAsset = await persistUpload(files.audio, "AUDIO");
    const imageAsset = files.image ? await persistUpload(files.image, "IMAGE") : null;
    const button = await prisma.musicButton.create({
      data: {
        name: payload.name,
        tag: payload.tag,
        description: payload.description,
        sortOrder: payload.sortOrder,
        categoryId: payload.categoryId,
        audioAssetId: audioAsset.id,
        imageAssetId: imageAsset?.id,
      },
      include: buttonInclude,
    });
    response.status(201).json(buttonDto(button));
  } catch (error) {
    await discardUploads(files);
    await cleanupOrphanAssets();
    throw error;
  }
});

app.put("/api/buttons/:id", requireAdmin, upload, async (request, response) => {
  const files = uploads(request);
  try {
    const payload = buttonSchema.parse(request.body);
    const current = await prisma.musicButton.findUnique({where: {id: routeId(request)}});
    if (!current) {
      await discardUploads(files);
      response.status(404).json({message: "Bouton introuvable."});
      return;
    }

    const audioAsset = files.audio ? await persistUpload(files.audio, "AUDIO") : null;
    const imageAsset = files.image ? await persistUpload(files.image, "IMAGE") : null;
    const button = await prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      if (current.tag !== payload.tag) {
        const script = await transaction.ceremonyScript.findUnique({where: {id: "main"}});
        await transaction.ceremonyScript.upsert({
          where: {id: "main"},
          create: {id: "main", content: replaceScriptTag("", current.tag, payload.tag)},
          update: {content: replaceScriptTag(script?.content ?? "", current.tag, payload.tag)},
        });
      }
      return transaction.musicButton.update({
        where: {id: current.id},
        data: {
          name: payload.name,
          tag: payload.tag,
          description: payload.description,
          sortOrder: payload.sortOrder,
          categoryId: payload.categoryId,
          audioAssetId: audioAsset?.id ?? current.audioAssetId,
          imageAssetId:
            payload.removeImage === "true" ? null : imageAsset?.id ?? current.imageAssetId,
        },
        include: buttonInclude,
      });
    });
    await cleanupOrphanAssets();
    response.json(buttonDto(button));
  } catch (error) {
    await discardUploads(files);
    await cleanupOrphanAssets();
    throw error;
  }
});

app.delete("/api/buttons/:id", requireAdmin, async (request, response) => {
  const current = await prisma.musicButton.findUnique({where: {id: routeId(request)}});
  if (!current) {
    response.status(404).json({message: "Bouton introuvable."});
    return;
  }

  await prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
    const script = await transaction.ceremonyScript.findUnique({where: {id: "main"}});
    await transaction.musicButton.delete({where: {id: current.id}});
    await transaction.playlist.deleteMany({where: {items: {none: {}}}});
    await transaction.ceremonyScript.upsert({
      where: {id: "main"},
      create: {id: "main", content: ""},
      update: {content: removeScriptTag(script?.content ?? "", current.tag)},
    });
  });
  await cleanupOrphanAssets();
  response.status(204).end();
});

app.put("/api/script", requireAdmin, async (request: AuthenticatedRequest, response) => {
  const payload = scriptSchema.parse(request.body);
  const script = await prisma.ceremonyScript.upsert({
    where: {id: "main"},
    create: {id: "main", content: payload.content, updatedById: request.authUser?.id},
    update: {content: payload.content, updatedById: request.authUser?.id},
  });
  response.json({content: script.content, updatedAt: script.updatedAt});
});

app.get("/api/media/:id", async (request, response) => {
  const asset = await prisma.mediaAsset.findUnique({where: {id: routeId(request)}});
  if (!asset) {
    response.status(404).end();
    return;
  }

  const filePath = safeMediaPath(asset.storagePath);
  const file = await assetFileStat(asset).catch(() => null);
  if (!file) {
    response.status(404).end();
    return;
  }

  response.setHeader("Content-Type", asset.mimeType);
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Cache-Control", "private, max-age=3600");
  const range = request.headers.range;
  if (!range) {
    response.setHeader("Content-Length", file.size);
    createReadStream(filePath).pipe(response);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = match?.[1] ? Number(match[1]) : 0;
  let end = match?.[2] ? Number(match[2]) : file.size - 1;
  if (match && !match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(file.size - suffixLength, 0);
    end = file.size - 1;
  }
  if (!match || Number.isNaN(start) || Number.isNaN(end) || start > end || end >= file.size) {
    response.status(416).setHeader("Content-Range", `bytes */${file.size}`);
    response.end();
    return;
  }
  response.status(206);
  response.setHeader("Content-Range", `bytes ${start}-${end}/${file.size}`);
  response.setHeader("Content-Length", end - start + 1);
  createReadStream(filePath, {start, end}).pipe(response);
});

const clientRoot = resolve("dist/client/browser");
app.use(express.static(clientRoot, {index: false, maxAge: config.nodeEnv === "production" ? "1y" : 0}));
app.use((request, response, next) => {
  if (request.method === "GET" && !request.path.startsWith("/api/") && request.path !== "/healthz") {
    response.sendFile(resolve(clientRoot, "index.html"));
    return;
  }
  next();
});

app.use((_request, response) => response.status(404).json({message: "Ressource introuvable."}));
app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error);
  if (error instanceof z.ZodError) {
    response.status(400).json({message: "Les informations envoyées sont invalides."});
    return;
  }
  if (error instanceof multer.MulterError) {
    response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({message: "Fichier refusé."});
    return;
  }
  const prismaCode = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (prismaCode === "P2002") {
    response.status(409).json({message: "Ce nom ou cette balise existe déjà."});
    return;
  }
  if (prismaCode === "P2025") {
    response.status(404).json({message: "Élément introuvable."});
    return;
  }
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
  const message =
    status < 500 && error instanceof Error
      ? error.message
      : "Une erreur inattendue est survenue.";
  response.status(status).json({message});
});

export async function start(): Promise<void> {
  await initializeMediaDirectories();
  await seedUsers();
  await prisma.userSession.deleteMany({where: {expiresAt: {lte: new Date()}}});
  await cleanupOrphanAssets();

  const server = app.listen(config.port, () => {
    console.log(`Régie mariage disponible sur le port ${config.port}.`);
  });
  const shutdown = () => {
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

const directRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (directRun) {
  start().catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
}
