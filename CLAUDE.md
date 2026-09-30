# Deploy rules

- Pushing to `main` deploys production via Vercel's GitHub integration. Don't use the Vercel CLI (`vercel link`, `vercel env`, `vercel deploy`).
- Migrations never run on push. If a change includes a migration, run `pnpm db:migrate:prod` **before** pushing, and only for additive changes (new tables, nullable or defaulted columns, indexes). Anything destructive (dropping or renaming columns or tables, narrowing types) must be flagged to the owner first. Don't run it.
- Production targets are explicit: `pnpm db:migrate:prod`, `pnpm seed:user:prod` and `pnpm user:add:prod` read `.env.production.local`. The plain versions read `.env` (local PGlite). All of them print the database host they used; check it.
- Extra accounts: `pnpm user:add:prod` (create-only) or `pnpm user:add:prod --reset` (existing account only), using `NEW_USER_EMAIL` / `NEW_USER_PASSWORD`. Never use `seed:user` to add people, because it overwrites. Remove the `NEW_USER_*` lines (and any `ADMIN_PASSWORD`) from `.env.production.local` afterwards.
- Never commit `.env*` files (except `.env.example`). Only `DATABASE_URL` goes into Vercel; never add `ADMIN_*` or `NEW_USER_*` variables there.
- Before calling work done: `pnpm check` and `pnpm test` pass.
