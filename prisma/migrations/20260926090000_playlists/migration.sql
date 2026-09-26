CREATE TABLE "regie"."playlists" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(300) NOT NULL DEFAULT '',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "regie"."playlist_items" (
  "id" UUID NOT NULL,
  "playlist_id" UUID NOT NULL,
  "button_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "playlist_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "playlists_name_key" ON "regie"."playlists"("name");
CREATE INDEX "playlists_sort_order_idx" ON "regie"."playlists"("sort_order");
CREATE INDEX "playlist_items_playlist_id_sort_order_idx" ON "regie"."playlist_items"("playlist_id", "sort_order");
CREATE INDEX "playlist_items_button_id_idx" ON "regie"."playlist_items"("button_id");

ALTER TABLE "regie"."playlist_items"
  ADD CONSTRAINT "playlist_items_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "regie"."playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "regie"."playlist_items"
  ADD CONSTRAINT "playlist_items_button_id_fkey" FOREIGN KEY ("button_id") REFERENCES "regie"."music_buttons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
