# Unified Media Storage CI/CD Runbook

> Contract version: `unified-media-storage.deploy.v1`
> Status: implementation-ready deployment runbook
> Audience: CI/CD, DevOps, platform, and release engineers
> Applies to: Golden CRM migration `423_media_files_registry.sql`

## 1. Purpose

Golden CRM now has two file-delivery contracts:

| Contract | Filesystem root | Public URL | Status |
|---|---|---|---|
| Legacy uploads | `UPLOADS_DIR` | `/uploads/<filename>` | Supported for existing records; do not remove |
| Unified media store | `MEDIA_DIR` | `/m/<publicId>.<extension>` | Required for all new device, branch, and app-banner media |

The new store is not a rename of the old directory. It adds a database registry,
sharded filesystem storage, immutable public identifiers, image normalization,
thumbnails, and ownership tracking. CI/CD must preserve both directories during
the transition.

This runbook defines the required storage topology, deployment order, migration
procedure, reverse-proxy behavior, verification, backup, and rollback rules.

## 2. Runtime Contract

### 2.1 Upload path

Staff-authenticated clients upload one multipart file to:

```http
POST /api/media
Content-Type: multipart/form-data
Authorization: Bearer <staff-token>
```

The API validates the file from its bytes rather than its filename. Images are
re-encoded to WebP, limited to 2048 pixels on the long edge, stripped of
metadata, and given a 400-pixel thumbnail. Videos and PDFs retain their
supported original formats.

The response contains server-relative URLs such as:

```json
{
  "id": "aB3xK9pQmN2v",
  "kind": "image",
  "url": "/m/aB3xK9pQmN2v.webp",
  "thumbUrl": "/m/aB3xK9pQmN2v_t.webp",
  "width": 1600,
  "height": 900,
  "byteSize": 182431,
  "mimeType": "image/webp"
}
```

### 2.2 Public read path

Media is read without authentication:

```http
GET /m/<publicId>.<extension>
GET /m/<publicId>_t.<extension>
```

The Express route validates the filename, derives its shard directories, and
serves the file with:

```http
Cache-Control: public, max-age=31536000, immutable
X-Content-Type-Options: nosniff
```

Do not rewrite `/m` to `/uploads`. Do not serve `/m` with a simple Nginx
`alias`: the public URL is flat while the physical store is sharded.

### 2.3 Physical layout

For public ID `aB3xK9pQmN2v`, the application writes:

```text
MEDIA_DIR/
  aB/
    3x/
      aB3xK9pQmN2v.webp
      aB3xK9pQmN2v_t.webp
```

The corresponding database row is stored in `public.media_files`. The files and
database registry form one logical asset and must be backed up together.

## 3. Critical Readiness Findings

The application code supports the new store, but the current container
deployment definition requires changes before production use:

1. `Dockerfile` creates `/app/uploads` but does not create `/app/media`.
2. `docker-compose.yml` mounts only the `uploads` volume.
3. The application is configured for three replicas. Without one shared media
   volume, an upload handled by replica A may return `404` when a later GET is
   handled by replica B.
4. Container-local media is deleted when a container is replaced.
5. `scripts/migrate-inline-media.ts` is not copied into the production image.
6. The production deployment script intentionally skips migrations.
7. Ownership and detachment are recorded, but no production garbage-collection
   command is currently implemented. CI/CD must not invent a deletion sweep.

Do not enable the new upload UI in an environment until items 1 through 5 are
resolved for that environment.

## 4. Required Environment Configuration

Use an environment-specific persistent path outside the code checkout.

Recommended host deployment values:

```env
# Production
MEDIA_DIR=/var/lib/golden-crm/production/media
UPLOADS_DIR=/var/lib/golden-crm/production/uploads
```

```env
# Staging
MEDIA_DIR=/var/lib/golden-crm/staging/media
UPLOADS_DIR=/var/lib/golden-crm/staging/uploads
```

For a container whose persistent volumes are mounted at `/app/media` and
`/app/uploads`:

```env
MEDIA_DIR=/app/media
UPLOADS_DIR=/app/uploads
```

Never use the repository directory as `MEDIA_DIR` in staging or production.
The code fallback `<repo>/media` is for local development only.

## 5. Filesystem Ownership and Permissions

The API process must be able to create shard directories and write files. It
must also be able to read and delete files when a future audited GC command is
introduced.

For a host/PM2 deployment, create the directories using the actual service user:

```bash
sudo install -d -o <service-user> -g <service-group> -m 0750 \
  /var/lib/golden-crm/staging/media \
  /var/lib/golden-crm/staging/uploads
```

Use separate production paths and ownership when preparing production. Do not
use mode `0777` and do not run the application as root to avoid fixing ownership.

For the current non-root Docker user, the image must prepare both mount points:

```dockerfile
RUN mkdir -p /app/uploads /app/media \
    && chown -R golden:golden /app/uploads /app/media
```

An empty named volume will then start with a writable mount-point structure.
Verify ownership from a running container rather than assuming it:

```bash
docker compose exec app sh -lc 'id && test -w "$MEDIA_DIR" && echo writable'
```

## 6. Required Docker Compose Topology

Every application replica on the same Docker host must mount the same persistent
media volume:

```yaml
services:
  app:
    environment:
      MEDIA_DIR: /app/media
      UPLOADS_DIR: /app/uploads
    volumes:
      - uploads:/app/uploads
      - media:/app/media

volumes:
  pgdata:
  uploads:
  media:
```

A local Docker named volume is suitable only when all replicas run on the same
host. For multi-host Swarm/Kubernetes deployments, use a ReadWriteMany volume
or redesign the media service for object storage before scaling across hosts.
Container-local filesystems are never an acceptable shared-media strategy.

To execute the inline-data migration inside the application image, copy the
script into the production stage:

```dockerfile
COPY scripts/migrate-inline-media.ts ./scripts/migrate-inline-media.ts
```

Alternatively, run the script from a controlled release checkout that has the
same application revision, dependencies, environment, database, and mounted
`MEDIA_DIR`. Do not copy generated files between containers after migration.

## 7. Reverse Proxy Requirements

The recommended topology keeps `/m` behind Express because Express derives the
physical shard path from the public ID. An explicit Nginx location prevents SPA
fallbacks and makes the intent visible:

```nginx
location ^~ /m/ {
    proxy_pass http://app;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    access_log off;
}
```

Do not add `try_files` against a flat `/app/media` directory; the files are two
levels below it. Preserve the cache and content-type headers returned by the
application. Keep `/uploads/` routing active for legacy records.

The proxy body limit must be at least the largest API upload limit. The current
application accepts up to 50 MiB for supported videos, while the existing Nginx
limit is 150 MiB. A lower proxy limit would return an Nginx `413` before the API
can return its normal JSON error contract.

## 8. Database Migration Order

The relevant schema migrations are:

```text
422_app_home_banners.sql
423_media_files_registry.sql
424_app_contact_links.sql
```

Migration 423 creates `media_files` and permits `/m/...` banner image paths.
The application does not automatically run migrations at startup. Apply pending
migrations explicitly using the same release image and environment that will be
deployed.

For Docker:

```bash
docker compose run --rm --no-deps \
  -e NODE_ENV=production \
  app \
  node ./node_modules/tsx/dist/cli.mjs packages/api/migrate.ts
```

For PM2/host deployments, load the environment through the established secure
deployment mechanism and run:

```bash
pnpm run migrate
```

Do not apply migration 423 manually without recording it in
`schema_migrations`. The migration runner is transactional and records the
filename after success.

## 9. Safe CI/CD Deployment Sequence

Use this order for the first release that introduces `/m`:

1. Disable concurrent deployments.
2. Freeze media-editing operations for the maintenance window.
3. Back up PostgreSQL, legacy `UPLOADS_DIR`, and any existing `MEDIA_DIR`.
4. Provision and verify the persistent media directory/volume.
5. Build the immutable application image with the migration files and inline
   migration script included.
6. Run unit tests and TypeScript/build checks.
7. Start the database if necessary, but do not replace the active application yet.
8. Run the schema migration from a one-off container using the shared media
   volume and production database configuration.
9. Deploy/recreate all application replicas with the shared media mount.
10. Run the API health check.
11. Verify `/m` routing with a negative request that returns `404`, not the SPA:

    ```bash
    curl -i https://<host>/m/not-a-valid-media-file.webp
    ```

12. Perform one authenticated upload smoke test using a CI secret or controlled
    staff account; never print the Bearer token.
13. Fetch the returned `url` and `thumbUrl` from outside the container.
14. Confirm both URLs remain readable through repeated requests while traffic
    is distributed across replicas.
15. Confirm the `media_files` row exists and the physical files exist in the
    shared volume.
16. Run the inline-media migration dry run and archive its report.
17. Run the actual inline migration only after the dry-run report is approved.
18. Re-enable media editing and monitor errors/disk usage.

The current documented Jenkins order deploys the application before running
migrations. For this release, use `Build -> Migrate -> Deploy -> Health Check`
so new code is not exposed before its required tables exist.

## 10. Migrating Existing Inline Media

Migration 423 creates the registry but does not rewrite old `data:` URLs stored
inside `device_models` or `branches`. Use the dedicated script.

Dry run:

```bash
node ./node_modules/tsx/dist/cli.mjs \
  scripts/migrate-inline-media.ts --dry-run
```

Actual migration:

```bash
node ./node_modules/tsx/dist/cli.mjs \
  scripts/migrate-inline-media.ts
```

The script:

- scans `device_models.images`, `device_models.videos`,
  `device_models.documents`, and `branches.images`;
- skips existing `/m/...` and `/uploads/...` values;
- converts supported inline images through the normal media pipeline;
- rewrites successful values to `/m/...` URLs;
- records ownership in `media_files`;
- leaves failed items unchanged and exits non-zero when failures remain;
- uses one database transaction per target table.

Important limitations:

- The script does not migrate legacy `/uploads/...` files. They remain supported.
- Filesystem writes are not PostgreSQL-transactional. If a table transaction is
  rolled back after files were written, unregistered bytes may remain and must
  be audited manually; do not delete them blindly.
- The current runtime stores one file per upload. Do not assume checksum-based
  deduplication when estimating disk capacity.
- Run one migration instance only. Do not execute it concurrently from several
  CI workers or application replicas.

## 11. Verification Commands

Read-only database checks:

```sql
SELECT to_regclass('public.media_files') AS media_table;

SELECT filename, applied_at
FROM schema_migrations
WHERE filename = '423_media_files_registry.sql';

SELECT kind, COUNT(*) AS files, SUM(byte_size) AS bytes
FROM media_files
GROUP BY kind
ORDER BY kind;

SELECT COUNT(*) AS unattached
FROM media_files
WHERE owner_type IS NULL AND detached_at IS NULL;

SELECT COUNT(*) AS detached
FROM media_files
WHERE detached_at IS NOT NULL;
```

Container checks:

```bash
docker compose exec app sh -lc \
  'printf "MEDIA_DIR=%s\n" "$MEDIA_DIR"; test -d "$MEDIA_DIR"; test -w "$MEDIA_DIR"'

docker compose exec app sh -lc \
  'find "$MEDIA_DIR" -type f | wc -l'
```

HTTP checks for a real uploaded URL:

```bash
curl -fsSI "https://<host>/m/<publicId>.webp"
curl -fsSI "https://<host>/m/<publicId>_t.webp"
```

Expected headers include `Content-Type: image/webp`, the immutable cache policy,
and `X-Content-Type-Options: nosniff`.

## 12. Backup and Restore

Back up these three resources in the same maintenance window:

1. PostgreSQL, including `media_files` and entity URL columns;
2. `MEDIA_DIR`;
3. legacy `UPLOADS_DIR`.

Example filesystem backup pattern:

```bash
rsync -a --numeric-ids /var/lib/golden-crm/production/media/ \
  /var/backups/golden-crm/media/

rsync -a --numeric-ids /var/lib/golden-crm/production/uploads/ \
  /var/backups/golden-crm/uploads/
```

The exact backup target and retention policy belong to infrastructure policy.
Test restoration into staging. A database-only restore is incomplete because
rows can point to files that are absent; a filesystem-only restore is also
incomplete because ownership and metadata live in PostgreSQL.

## 13. Rollback Strategy

Migration 423 is additive and should normally remain applied. Do not drop
`media_files` during rollback.

Application rollback becomes unsafe after any entity is saved with an `/m/...`
URL if the previous application revision cannot serve or validate that URL.
Therefore:

1. validate storage and routing before re-enabling media writes;
2. prefer roll-forward fixes after media writes begin;
3. keep the shared media volume mounted during every rollback;
4. preserve the database and both file stores;
5. if a code rollback is unavoidable, verify that the rollback revision supports
   `/m` before switching traffic.

Never remove the media volume merely because an application deployment failed.

## 14. Monitoring and Alerts

Monitor at minimum:

- filesystem capacity and inode usage for `MEDIA_DIR` and `UPLOADS_DIR`;
- HTTP `404` rate under `/m/`;
- upload responses `413`, `415`, and `500`;
- PM2/container permission errors such as `EACCES` and `EROFS`;
- differences between `media_files` rows and physical file counts;
- counts of long-lived unattached and detached registry rows;
- backup age and restore-test status.

Ownership tracking alone does not delete files. No audited GC executable exists
in the current release. Until one is implemented and tested, report cleanup
candidates but do not automate deletion from CI/CD.

## 15. Release Acceptance Checklist

- [ ] `MEDIA_DIR` is explicit and environment-specific.
- [ ] The media directory is outside the release checkout.
- [ ] Every replica mounts the same persistent media store.
- [ ] The non-root application user can read and write the mounted directory.
- [ ] Migration 423 is recorded in `schema_migrations`.
- [ ] `/uploads` remains available for legacy records.
- [ ] `/m` is proxied to Express and does not fall through to the SPA.
- [ ] The inline migration script is available to the approved one-off job.
- [ ] A real upload survives container recreation.
- [ ] A real upload is readable through every replica.
- [ ] Original and thumbnail responses have the expected content type and headers.
- [ ] Database, media, and legacy-upload backups are successful.
- [ ] The inline migration dry-run report has no unexplained failures.
- [ ] No unreviewed file-deletion or GC step exists in the pipeline.
- [ ] Rollback preserves the media volume and an `/m`-compatible application path.

