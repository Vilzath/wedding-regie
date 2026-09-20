import {createHash, randomBytes} from "node:crypto";
import type {Role} from "@prisma/client";
import type {NextFunction, Request, Response} from "express";
import {config} from "./config.js";
import {prisma} from "./db.js";

export type AuthUser = {id: string; username: string; role: Role};
export type AuthenticatedRequest = Request & {authUser?: AuthUser};

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, response: Response): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000);
  await prisma.userSession.create({data: {userId, tokenHash: hashSessionToken(token), expiresAt}});
  response.cookie(config.sessionCookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroySession(request: Request, response: Response): Promise<void> {
  const token = request.cookies?.[config.sessionCookieName] as string | undefined;
  if (token) {
    await prisma.userSession.deleteMany({where: {tokenHash: hashSessionToken(token)}});
  }
  response.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    path: "/",
  });
}

export async function requireAuth(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const token = request.cookies?.[config.sessionCookieName] as string | undefined;
  if (!token) {
    response.status(401).json({message: "Authentification requise."});
    return;
  }

  const session = await prisma.userSession.findUnique({
    where: {tokenHash: hashSessionToken(token)},
    include: {user: true},
  });
  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.userSession.delete({where: {id: session.id}});
    response.clearCookie(config.sessionCookieName, {path: "/"});
    response.status(401).json({message: "Session expirée."});
    return;
  }

  request.authUser = {id: session.user.id, username: session.user.username, role: session.user.role};
  next();
}

export function requireAdmin(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): void {
  if (request.authUser?.role !== "ADMIN") {
    response.status(403).json({message: "Action réservée à l’administrateur."});
    return;
  }
  next();
}
