# ForgeOps

ForgeOps is a private, single-user client, project, document, labor, and money-management application designed for Docker and mobile-first use.

## Included in this first version

- Secure first-run admin setup with remembered username support
- Clients with multiple service addresses and an automatic Support Calls project
- Project statuses, notes, files, activity history, site visits, and labor defaults
- Named quote groups, alternative quotes, replacements, 30-day expiration, approvals, payments, credits, and fixed vendor surcharges
- Invoices with labor imports, a two-hour project minimum, additional items, credits, project-credit application, Due on Receipt/Net terms, and overdue status
- Exact tax allocation plus conservative reserve planning
- Project and business expenses, reusable vendors, normalized accounting categories, and tax remittance records
- Branded US Letter quote and invoice PDFs with signing lines and status watermarks
- Internal and client-safe project packet PDFs with uploaded receipt pages
- Month, New York sales-tax quarter, and calendar-year reports with charts and PDF export
- On-demand ZIP backups containing a consistent SQLite snapshot and all uploaded files

## Local Windows testing

1. Copy `.env.example` to `.env`.
2. Replace `FORGEOPS_SECRET_KEY` with a long random value.
3. Run `docker compose up -d --build`.
4. Open `http://localhost:8080` and complete the first-run setup.

Persistent development data is written to `data`, `media`, and `backups` beside the Compose file.

## Debian LXC deployment

Use the same Compose file in a dedicated directory. Set production values in `.env`:

```env
FORGEOPS_DEBUG=0
FORGEOPS_ALLOWED_HOSTS=forgeops.example.com
FORGEOPS_CSRF_TRUSTED_ORIGINS=https://forgeops.example.com
FORGEOPS_TIME_ZONE=America/New_York
```

Point the existing Cloudflare Tunnel at `http://forgeops:8000` when the tunnel runs in the same Docker network, or at the published host port when it runs elsewhere.

Back up the `data`, `media`, and `backups` directories with Proxmox. ForgeOps also provides an on-demand downloadable backup in Settings.

## Password recovery

Run the built-in password change command from the server console:

```sh
docker compose exec forgeops python manage.py changepassword USERNAME
```
