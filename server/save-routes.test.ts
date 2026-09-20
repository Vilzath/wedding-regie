import {mkdir, rm} from "node:fs/promises";
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";

const adminUser = {
  id: "00000000-0000-4000-8000-000000000010",
  username: "admin",
  role: "ADMIN" as const,
};
const category = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Cérémonie",
  sortOrder: 10,
};
const audioAsset = {
  id: "00000000-0000-4000-8000-000000000020",
  originalName: "entree.mp3",
};

const {prismaMock, transactionMock, mediaMock} = vi.hoisted(() => {
  const transaction = {
    ceremonyScript: {findUnique: vi.fn(), upsert: vi.fn()},
    musicButton: {update: vi.fn(), delete: vi.fn()},
  };
  return {
    transactionMock: transaction,
    prismaMock: {
      category: {create: vi.fn(), update: vi.fn()},
      musicButton: {create: vi.fn(), findUnique: vi.fn()},
      ceremonyScript: {upsert: vi.fn()},
      $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) => callback(transaction)),
    },
    mediaMock: {
      persistUpload: vi.fn(),
      cleanupOrphanAssets: vi.fn(),
      discardUpload: vi.fn(),
    },
  };
});

vi.mock("./db.js", () => ({prisma: prismaMock}));
vi.mock("./auth.js", () => ({
  createSession: vi.fn(),
  destroySession: vi.fn(),
  requireAuth: (request: {authUser?: typeof adminUser}, _response: unknown, next: () => void) => {
    request.authUser = adminUser;
    next();
  },
  requireAdmin: (_request: unknown, _response: unknown, next: () => void) => next(),
}));
vi.mock("./media.js", () => ({
  assetFileStat: vi.fn(),
  cleanupOrphanAssets: mediaMock.cleanupOrphanAssets,
  discardUpload: mediaMock.discardUpload,
  initializeMediaDirectories: vi.fn(),
  persistUpload: mediaMock.persistUpload,
  safeMediaPath: vi.fn(),
}));
vi.mock("./seed.js", () => ({seedUsers: vi.fn()}));

import {app} from "./server.js";

function buttonRecord(data: Record<string, unknown>) {
  return {
    id: "00000000-0000-4000-8000-000000000030",
    name: data["name"],
    tag: data["tag"],
    description: data["description"],
    sortOrder: data["sortOrder"],
    categoryId: data["categoryId"],
    audioAssetId: data["audioAssetId"] ?? audioAsset.id,
    imageAssetId: null,
    category: {name: category.name},
    audioAsset,
    imageAsset: null,
  };
}

describe("routes d’enregistrement", () => {
  let server: ReturnType<typeof app.listen>;
  let origin: string;

  beforeAll(async () => {
    await mkdir("storage/tmp", {recursive: true});
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Serveur de test indisponible.");
    origin = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.category.create.mockImplementation(async ({data}: {data: Record<string, unknown>}) => ({
      id: category.id,
      ...data,
    }));
    prismaMock.category.update.mockImplementation(async ({data}: {data: Record<string, unknown>}) => ({
      id: category.id,
      ...data,
    }));
    prismaMock.ceremonyScript.upsert.mockImplementation(async ({create, update}: {create: Record<string, unknown>; update: Record<string, unknown>}) => ({
      content: update["content"] ?? create["content"],
      updatedAt: new Date("2026-09-13T10:00:00Z"),
    }));
    prismaMock.musicButton.create.mockImplementation(async ({data}: {data: Record<string, unknown>}) => buttonRecord(data));
    prismaMock.musicButton.findUnique.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000030",
      tag: "ancienne-balise",
      audioAssetId: audioAsset.id,
      imageAssetId: null,
    });
    transactionMock.ceremonyScript.findUnique.mockResolvedValue({content: "Lancer @ancienne-balise."});
    transactionMock.ceremonyScript.upsert.mockResolvedValue({});
    transactionMock.musicButton.update.mockImplementation(async ({data}: {data: Record<string, unknown>}) => buttonRecord(data));
    mediaMock.persistUpload.mockResolvedValue(audioAsset);
    mediaMock.cleanupOrphanAssets.mockResolvedValue(undefined);
    mediaMock.discardUpload.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm("storage", {recursive: true, force: true});
  });

  it("enregistre le conducteur", async () => {
    const response = await fetch(`${origin}/api/script`, {
      method: "PUT",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({content: "Bienvenue, puis @entree."}),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({content: "Bienvenue, puis @entree."});
  });

  it("crée et modifie une catégorie", async () => {
    const created = await fetch(`${origin}/api/categories`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({name: "Jeux", sortOrder: 30}),
    });
    const updated = await fetch(`${origin}/api/categories/${category.id}`, {
      method: "PUT",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({name: "Jeux du soir", sortOrder: 40}),
    });

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({name: "Jeux du soir", sortOrder: 40});
  });

  it("crée un bouton et normalise sa balise", async () => {
    const form = new FormData();
    form.set("name", "Entrée des mariés");
    form.set("tag", "Entrée des Mariés");
    form.set("description", "Ouverture des portes");
    form.set("categoryId", category.id);
    form.set("sortOrder", "10");
    form.set("removeImage", "false");
    form.set("audio", new Blob(["audio-test"], {type: "audio/mpeg"}), "entree.mp3");

    const response = await fetch(`${origin}/api/buttons`, {method: "POST", body: form});
    const result = await response.json() as {tag: string};

    expect(response.status).toBe(201);
    expect(result.tag).toBe("entree-des-maries");
  });

  it("modifie un bouton sans imposer un nouvel audio", async () => {
    const form = new FormData();
    form.set("name", "Première danse");
    form.set("tag", "premiere-danse");
    form.set("description", "");
    form.set("categoryId", category.id);
    form.set("sortOrder", "20");
    form.set("removeImage", "false");

    const response = await fetch(`${origin}/api/buttons/00000000-0000-4000-8000-000000000030`, {
      method: "PUT",
      body: form,
    });
    const result = await response.json() as {name: string; audioAssetId: string};

    expect(response.status).toBe(200);
    expect(result).toMatchObject({name: "Première danse", audioAssetId: audioAsset.id});
    expect(mediaMock.persistUpload).not.toHaveBeenCalled();
  });
});
