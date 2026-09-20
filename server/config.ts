import {resolve} from "node:path";
import {z} from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .default("postgresql://wedding_music:wedding_music@localhost:5434/apps?schema=regie"),
  SESSION_COOKIE_NAME: z.string().min(1).default("wedding_session"),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  MEDIA_ROOT: z.string().default("storage/media"),
  UPLOAD_TMP_DIR: z.string().default("storage/tmp"),
});

const env = schema.parse(process.env);

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  sessionCookieName: env.SESSION_COOKIE_NAME,
  sessionTtlHours: env.SESSION_TTL_HOURS,
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : env.NODE_ENV === "production",
  trustProxy: env.TRUST_PROXY,
  mediaRoot: resolve(env.MEDIA_ROOT),
  uploadTmpDir: resolve(env.UPLOAD_TMP_DIR),
} as const;
