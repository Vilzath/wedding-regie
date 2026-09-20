-- À exécuter une seule fois avec un rôle PostgreSQL administrateur.
-- Remplacer CHANGE_ME par le même mot de passe que dans DATABASE_URL.
CREATE ROLE wedding_music_app LOGIN PASSWORD 'CHANGE_ME';
GRANT CONNECT ON DATABASE apps TO wedding_music_app;
CREATE SCHEMA IF NOT EXISTS wedding_music AUTHORIZATION wedding_music_app;
GRANT USAGE, CREATE ON SCHEMA wedding_music TO wedding_music_app;
ALTER ROLE wedding_music_app IN DATABASE apps SET search_path = wedding_music, public;
