# Deploy rules

- Pushing to `main` deploys production via Vercel's GitHub integration. Don't use the Vercel CLI (`vercel link`, `vercel env`, `vercel deploy`).
- Migrations never run on push. If a change includes a migration, run `pnpm db:migrate:prod` **before** pushing, and only for additive changes (new tables, nullable or defaulted columns, indexes). Anything destructive (dropping or renaming columns or tables, narrowing types) must be flagged to the owner first. Don't run it.
- Production targets are explicit: `pnpm db:migrate:prod` and `pnpm seed:user:prod` read `.env.production.local`. Plain `db:migrate` / `seed:user` read `.env` (local PGlite). Both print the database host they used; check it.
- Never commit `.env*` files (except `.env.example`). Only `DATABASE_URL` goes into Vercel; never add `ADMIN_*` variables there.
- Before calling work done: `pnpm check` and `pnpm test` pass.
