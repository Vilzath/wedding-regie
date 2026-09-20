import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import type {Role} from "@prisma/client";
import bcrypt from "bcryptjs";
import {prisma} from "./db.js";

type SeedAccount = {username: string; password: string; role: Role};

function accountFromEnv(prefix: "ADMIN" | "USER", role: Role): SeedAccount {
  const production = process.env["NODE_ENV"] === "production";
  const username = process.env[`${prefix}_USERNAME`] ?? prefix.toLowerCase();
  const password = process.env[`${prefix}_PASSWORD`] ?? (production ? "" : prefix.toLowerCase());

  if (!password || (production && ["admin", "user"].includes(password))) {
    throw new Error(`${prefix}_PASSWORD doit être défini avec une valeur non triviale en production.`);
  }

  return {username, password, role};
}

export async function seedUsers(): Promise<void> {
  const accounts: SeedAccount[] = [
    accountFromEnv("ADMIN", "ADMIN"),
    accountFromEnv("USER", "USER"),
  ];

  for (const account of accounts) {
    const passwordHash = await bcrypt.hash(account.password, 12);
    await prisma.user.upsert({
      where: {username: account.username},
      create: {username: account.username, passwordHash, role: account.role},
      update: {passwordHash, role: account.role},
    });
  }

  await prisma.ceremonyScript.upsert({
    where: {id: "main"},
    create: {id: "main", content: ""},
    update: {},
  });
}

const directRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (directRun) {
  seedUsers()
    .then(() => console.log("Comptes initiaux vérifiés."))
    .finally(() => prisma.$disconnect());
}
