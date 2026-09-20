CREATE SCHEMA IF NOT EXISTS "regie";

CREATE TYPE "regie"."Role" AS ENUM ('ADMIN', 'USER');
CREATE TYPE "regie"."AssetKind" AS ENUM ('AUDIO', 'IMAGE');

CREATE TABLE "regie"."users" (
  "id" UUID NOT NULL,
  "username" VARCHAR(80) NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "role" "regie"."Role" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "regie"."user_sessions" (
  "id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "user_id" UUID NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "regie"."categories" (
  "id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "regie"."media_assets" (
  "id" UUID NOT NULL,
  "kind" "regie"."AssetKind" NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "original_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "storage_path" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "regie"."music_buttons" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "tag" VARCHAR(80) NOT NULL,
  "description" VARCHAR(300) NOT NULL DEFAULT '',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "category_id" UUID NOT NULL,
  "audio_asset_id" UUID NOT NULL,
  "image_asset_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "music_buttons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "regie"."ceremony_scripts" (
  "id" VARCHAR(30) NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "updated_by_id" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ceremony_scripts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_username_key" ON "regie"."users"("username");
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "regie"."user_sessions"("token_hash");
CREATE INDEX "user_sessions_user_id_idx" ON "regie"."user_sessions"("user_id");
CREATE INDEX "user_sessions_expires_at_idx" ON "regie"."user_sessions"("expires_at");
CREATE UNIQUE INDEX "categories_name_key" ON "regie"."categories"("name");
CREATE INDEX "categories_sort_order_idx" ON "regie"."categories"("sort_order");
CREATE UNIQUE INDEX "media_assets_kind_sha256_key" ON "regie"."media_assets"("kind", "sha256");
CREATE UNIQUE INDEX "music_buttons_tag_key" ON "regie"."music_buttons"("tag");
CREATE INDEX "music_buttons_category_id_sort_order_idx" ON "regie"."music_buttons"("category_id", "sort_order");

ALTER TABLE "regie"."user_sessions"
  ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "regie"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "regie"."music_buttons"
  ADD CONSTRAINT "music_buttons_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "regie"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "regie"."music_buttons"
  ADD CONSTRAINT "music_buttons_audio_asset_id_fkey" FOREIGN KEY ("audio_asset_id") REFERENCES "regie"."media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "regie"."music_buttons"
  ADD CONSTRAINT "music_buttons_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "regie"."media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "regie"."ceremony_scripts"
  ADD CONSTRAINT "ceremony_scripts_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "regie"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "regie"."categories" ("id", "name", "sort_order", "updated_at")
VALUES
  ('00000000-0000-4000-8000-000000000001', 'Cérémonie', 10, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000002', 'Vin d’honneur', 20, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000003', 'Jeux', 30, CURRENT_TIMESTAMP);

INSERT INTO "regie"."ceremony_scripts" ("id", "content", "updated_at")
VALUES ('main', '', CURRENT_TIMESTAMP);
