-- Einmalige Cluster-Einrichtung für lokale Entwicklung und CI.
-- Muss als Postgres-Superuser laufen (z.B. `psql -U postgres`) — sowohl
-- CREATE ROLE als auch ALTER ROLE ... BYPASSRLS verlangen das.
--
-- Warum zwei Rollen und warum BYPASSRLS für tiff_migrator: siehe
-- ../migrations/1700000000004_runtime-role-hardening.js und README.md
-- "Datenbank-Rollen".

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiff_migrator') THEN
    CREATE ROLE tiff_migrator LOGIN PASSWORD 'devpass';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiff_app') THEN
    CREATE ROLE tiff_app LOGIN PASSWORD 'devpass';
  END IF;
END
$$;

ALTER ROLE tiff_migrator BYPASSRLS;

SELECT 'CREATE DATABASE tiff_autohaendler_dms OWNER tiff_migrator'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tiff_autohaendler_dms')
\gexec

\c tiff_autohaendler_dms
GRANT ALL ON SCHEMA public TO tiff_migrator;
