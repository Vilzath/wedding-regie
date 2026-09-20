-- À exécuter une seule fois avec un rôle PostgreSQL administrateur.
-- Remplacer CHANGE_ME par le même mot de passe que dans DATABASE_URL.
CREATE ROLE "Wedding" LOGIN PASSWORD 'CHANGE_ME';
GRANT CONNECT ON DATABASE apps TO "Wedding";
CREATE SCHEMA IF NOT EXISTS regie AUTHORIZATION "Wedding";
GRANT USAGE, CREATE ON SCHEMA regie TO "Wedding";
ALTER ROLE "Wedding" IN DATABASE apps SET search_path = regie, public;
