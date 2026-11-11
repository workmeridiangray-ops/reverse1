# Deployment, operations, backup and recovery

## Requirements
PostgreSQL 14+, Node 22 (or the supplied `Dockerfile`), a persistent volume for uploaded files, HTTPS in front of the app.

## Environment variables (see `.env.example`; never commit real values)
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | owner connection, used only by `scripts/migrate.mjs` |
| `ERP_APP_PASSWORD` | password set on the `erp_app` login role by the migration step |
| `APP_DATABASE_URL` | runtime connection **as `erp_app`** (RLS applies). Set `DB_SSL=true` for managed databases |
| `APP_URL` | public https URL, used in emails |
| `STORAGE_DIR`, `MAX_UPLOAD_MB` | private file storage path (persistent volume) and size limit |
| `EMAIL_MODE`, `BREVO_API_KEY`, `MAIL_FROM`, `SALES_EMAIL` | transactional email (`log` prints instead of sending) |

## First deployment
1. Provision Postgres and a volume. 2. Set variables. 3. `npm run db:migrate` (idempotent; tracked in `schema_migrations`).
4. Create the operator: `PLATFORM_ADMIN_EMAIL=… PLATFORM_ADMIN_PASSWORD=… npm run platform:admin`.
5. Run the web process (`node server.js` from the Docker image, or `npm run build && npm start`) and the worker (`npm run worker`).
6. Check `GET /api/health` → `{"status":"ok","db":"up"}`.
`render.yaml` is a ready blueprint (web + worker + Postgres + disk). Rollback = redeploy the previous image; migrations are additive, so the previous version keeps working against a newer schema.

## Backup and restore
- Database: nightly `pg_dump -Fc "$DATABASE_URL" > siteledger-$(date +%F).dump` plus provider point-in-time recovery if available. Keep ≥ 30 days.
- Files: snapshot/rsync `STORAGE_DIR`; file rows are in the database (`files.storage_key`), so back both up together.
- Restore drill: create an empty DB, `pg_restore -d <new> --no-owner siteledger.dump`, run `npm run db:migrate` (applies any newer migrations and re-grants the `erp_app` role), restore the files volume, start the app, verify `/api/health` and sign in. **Run this drill before go-live and record the time it takes (your recovery-time evidence).**

## Logging and monitoring
The app logs failures to stdout (`action failed …`) — collect with your platform's log drain. Monitor `/api/health`, failed email jobs (Platform → Background jobs), and disk usage of the files volume.

## Security checklist before launch
Use a strong `ERP_APP_PASSWORD`; terminate TLS at the proxy; restrict DB network access to the app; rotate the operator password; replace the draft legal pages; add malware scanning for uploads (not included — see SCOPE_STATUS); put the app behind a WAF/rate-limit for public forms if exposed to abuse.
