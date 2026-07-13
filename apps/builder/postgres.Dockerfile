# Postgres image with the Webstudio schema baked in, for self-hosting on Coolify.
# Coolify doesn't check the repo out at the compose runtime dir, so a relative
# bind-mount of the schema snapshot resolves to a missing path (Docker then
# creates an empty dir) and never bootstraps. Baking it into the image runs it
# reliably via /docker-entrypoint-initdb.d on first boot (empty data volume).
FROM postgres:16
COPY apps/builder/e2e/schema/current.sql /docker-entrypoint-initdb.d/00-schema.sql
