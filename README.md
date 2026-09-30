# Todo

A small, single-account todo app: SvelteKit (Svelte 5) on Vercel, Postgres on Neon via Drizzle.

- Inbox, lists and a Logbook of completed tasks
- Quick-add from any view (`n` or `/` to focus, Enter to add)
- Drag and drop reordering (tasks and lists), or `Alt`+`↑`/`↓` on a focused row
- Detail panel for title, notes and list; soft delete with Undo
- Works without JavaScript (form actions + progressive enhancement), light and dark themes, usable at 360px

## Local setup

Requires Node 22+ and pnpm (`corepack enable pnpm`).

```sh
pnpm install
cp .env.example .env
```

Pick a database for `DATABASE_URL` in `.env`:

- **Zero setup:** `DATABASE_URL=pglite:./.pglite` uses an embedded Postgres (PGlite) stored in `./.pglite`. Migrations are applied automatically when `pnpm dev` starts. Dev only; it is compiled out of production builds.
- **Neon:** use a connection string from a Neon project or a dev branch, then run `pnpm db:migrate`.

Create your account, then start the app:

```sh
pnpm seed:user   # reads ADMIN_EMAIL / ADMIN_PASSWORD from .env
pnpm dev
```

With PGlite, run `seed:user` while the dev server is stopped (only one process can open the database directory).

There is no sign-up. `pnpm seed:user` creates the one account, or resets its password (and signs out all its sessions) if it already exists. `ADMIN_EMAIL` and `ADMIN_PASSWORD` are only read by that script, never by the running app.

## Scripts

| Script             | What it does                                                                |
| ------------------ | --------------------------------------------------------------------------- |
| `pnpm dev`         | Dev server                                                                  |
| `pnpm build`       | Production build (Vercel adapter)                                           |
| `pnpm check`       | `svelte-check` / TypeScript                                                 |
| `pnpm test`        | Vitest; each file runs against an in-memory PGlite                          |
| `pnpm db:generate` | Generate a SQL migration from `src/lib/server/db/schema.ts` into `drizzle/` |
| `pnpm db:migrate`  | Apply pending migrations in `drizzle/` to `DATABASE_URL`                    |
| `pnpm seed:user`   | Create or update the single account                                         |

## Migrations

Schema changes are made in `src/lib/server/db/schema.ts`, then:

```sh
pnpm db:generate --name describe_the_change   # writes drizzle/NNNN_describe_the_change.sql
pnpm db:migrate                               # applies it to DATABASE_URL
```

Commit the generated files in `drizzle/`. Don't use `drizzle-kit push`. The tests apply the same migration files to PGlite, so a broken migration fails `pnpm test`.

To run against a specific database without editing `.env`:

```sh
DATABASE_URL='postgresql://…' pnpm db:migrate
```

## Deploy (Vercel + Neon, free tiers)

Functions are pinned to Vercel's London region (`lhr1`, set in `vite.config.ts`), next to a Neon project in AWS `eu-west-2`.

1. **Neon:** create a project in `aws-eu-west-2`. Put both connection strings in `.env.production.local` (git-ignored). Quote them, because the `&` in the query string breaks `source` in bash:
   ```sh
   DATABASE_URL='postgresql://…@ep-…-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
   DIRECT_DATABASE_URL='postgresql://…@ep-….c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
   ```
   The pooled URL is for the app. The direct URL is for migrations: drizzle-kit connects over TCP with node-postgres, and `drizzle.config.ts` prefers `DIRECT_DATABASE_URL` when it's set.
2. **Migrate and seed** from your machine (real env vars take precedence over `.env`):
   ```sh
   set -a; . ./.env.production.local; set +a
   pnpm db:migrate
   ADMIN_EMAIL='you@example.com' ADMIN_PASSWORD='…' pnpm seed:user
   ```
3. **Vercel:** link the project (`vercel link`) and set these for Production. Nothing else, and never the admin credentials:
   - `DATABASE_URL`: the pooled Neon URL
   - `ENABLE_EXPERIMENTAL_COREPACK=1`: makes Vercel use the pnpm version pinned in `package.json`
4. Deploy: `vercel --prod`, or push to the connected branch.

Only `DATABASE_URL` is needed at runtime. For future schema changes, run `pnpm db:migrate` against Neon before (or right after) deploying code that depends on them.

## How it fits together

- `src/lib/server/db/schema.ts`: tables. Every row has `user_id`; deletes are soft (`deleted_at`).
- `src/lib/server/{tasks,lists,auth}.ts`: the only code that touches tables. Each store is created from a `Db` (neon-http in the app, PGlite in tests), and every function takes `userId` first and scopes every query by it. `src/lib/server/authorization.test.ts` checks that user A can't read or change user B's rows through any of them.
- `src/lib/server/data.ts`: binds the stores to Neon for the app. Routes and form actions use this.
- `src/lib/server/actions.ts`: form actions shared by every view.
- **Ordering** uses fractional indexing: a move rewrites only the moved row's `order` key, since neon-http has no interactive transactions. The `order` columns are `text COLLATE "C"`, so Postgres sorts keys byte-wise, the same way the key generator compares them.
- **Auth:** argon2id password hash, random session token in an httpOnly cookie. Only its SHA-256 is stored. Sessions last 30 days and renew once less than 15 days remain. After 5 failed logins for an email within 15 minutes, that email is locked for 15 minutes. Unknown emails get the same response, timing and lockout as real ones.
