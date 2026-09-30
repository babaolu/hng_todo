# Todo

A small, single-account todo app: SvelteKit (Svelte 5) on Vercel, Postgres on Neon via Drizzle.

- Today (`/`: due or overdue, plus anything pinned), Upcoming (next 14 days by day, then Later), Inbox (`/inbox`), lists and a Logbook
- Quick-add from any view (`n` or `/` to focus, Enter to add) that understands dates and lists: `pay rent friday #home`, `dentist 12 sep`, `review next mon`, `water plants in 3 days`. Also `next tue` / `next week tue` (that weekday in the following Mon–Sun week) and slash dates like `pay rent 3/10` (day-first; month-first for en-US browsers). Chips preview what was understood: click the date chip to pick a different date, and ✕ or Esc keeps the text as typed. Adding in Today defaults the date to today.
- Due dates are calendar days, and "today" is the user's own day: the browser reports its time zone, and the server stores it
- Recurring tasks: end a quick-add with a repeat (`standup daily`, `gym every mon and thu`, `water plants every 3 days`, `pay rent monthly on the 1st`) or set one in the detail panel. Completing a recurring task logs it and creates the next occurrence from the schedule, skipping missed ones. Removing the repeat or deleting the task ends the series.
- Drag and drop reordering in Inbox and lists (tasks and lists), or `Alt`+`↑`/`↓` on a focused row; `t` pins the focused task to Today
- Detail panel for title, notes, due date, pin and list; soft delete with Undo
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

There is no sign-up. `pnpm seed:user` creates the first account, or resets its password (and signs out all its sessions) if it already exists. Add more accounts with `pnpm user:add` (see [Adding accounts](#adding-accounts)). `ADMIN_*` and `NEW_USER_*` are only read by these scripts, never by the running app.

## Scripts

| Script                 | What it does                                                                   |
| ---------------------- | ------------------------------------------------------------------------------ |
| `pnpm dev`             | Dev server                                                                     |
| `pnpm build`           | Production build (Vercel adapter)                                              |
| `pnpm check`           | `svelte-check` / TypeScript                                                    |
| `pnpm test`            | Vitest; each file runs against an in-memory PGlite                             |
| `pnpm db:generate`     | Generate a SQL migration from `src/lib/server/db/schema.ts` into `drizzle/`    |
| `pnpm db:migrate`      | Apply pending migrations in `drizzle/` to `DATABASE_URL`                       |
| `pnpm db:migrate:prod` | Same, against `.env.production.local` (Neon)                                   |
| `pnpm seed:user`       | Create or update the single account                                            |
| `pnpm seed:user:prod`  | Same, against `.env.production.local` (Neon)                                   |
| `pnpm user:add`        | Add an account (create-only); `--reset` changes an existing account's password |
| `pnpm user:add:prod`   | Same, against `.env.production.local` (Neon)                                   |

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

Production is a Vercel project imported from GitHub (`main` branch), with functions pinned to London (`lhr1`, set in `vite.config.ts`) next to a Neon project in AWS `eu-west-2`. The rules (also in `CLAUDE.md`):

- **Pushing to `main` deploys production** through Vercel's GitHub integration.
- **Migrations never run on push.** If a change includes a migration, run `pnpm db:migrate:prod` _before_ pushing, and only for additive changes. Flag anything destructive (dropping or renaming columns) to the owner first.
- **Never commit `.env*` files** (except `.env.example`). **Never add `ADMIN_*` variables to Vercel.** The app only needs `DATABASE_URL`.

### Production env file

`.env.production.local` (git-ignored) holds the Neon connection strings. Quote the values, because the `&` in the query string breaks shell sourcing:

```sh
DATABASE_URL='postgresql://…@ep-…-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
DIRECT_DATABASE_URL='postgresql://…@ep-….c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
```

The pooled `DATABASE_URL` is for the app and the seed. The direct URL is for migrations: drizzle-kit connects over TCP with node-postgres, so it uses `DIRECT_DATABASE_URL` when set.

### Targeting production

| Local (`.env`)    | Production (`.env.production.local`) |
| ----------------- | ------------------------------------ |
| `pnpm db:migrate` | `pnpm db:migrate:prod`               |
| `pnpm seed:user`  | `pnpm seed:user:prod`                |
| `pnpm user:add`   | `pnpm user:add:prod`                 |

The `:prod` scripts set `ENV_FILE=.env.production.local`. That file must exist, it overrides anything already exported in your shell, and `.env` is never read. Both commands print the database host they used.

To (re)create the account in production, add quoted `ADMIN_EMAIL` and `ADMIN_PASSWORD` to `.env.production.local`, run `pnpm seed:user:prod`, then delete the `ADMIN_PASSWORD` line.

### Adding accounts

Use `user:add`, not `seed:user`. It never overwrites an existing account.

1. Add quoted `NEW_USER_EMAIL` and `NEW_USER_PASSWORD` (at least 12 characters) to `.env.production.local`.
2. Run one of:
   - `pnpm user:add:prod`: creates the account. It fails without changing anything if the email already exists.
   - `pnpm user:add:prod --reset`: sets a new password for an **existing** account and signs out its sessions. It fails if the email doesn't exist.
3. Check the printed host, then delete both `NEW_USER_*` lines.

Both print only the email and the database host.

### Vercel project settings

- Import `babaolu/hng_todo` from GitHub. The defaults are right: framework preset **SvelteKit**, root directory `./`, install and build commands left at their defaults (pnpm is detected from `pnpm-lock.yaml`).
- Production environment variables:
  - `DATABASE_URL`: the pooled Neon URL
  - `ENABLE_EXPERIMENTAL_COREPACK` = `1`: makes Vercel use the pnpm version pinned in `package.json`

## Guest mode (temporary)

`GUEST_MODE=on` lets anyone use the app as a private guest, without an account: `/login` shows **Continue as guest**. Any other value, or unset, means off. It's read on every request.

- A guest is a normal user row with `is_guest = true`, a random `@guest.invalid` email and no usable password. Guests can't log in with the password form.
- Each guest starts with 2 lists and 8 sample tasks, dated relative to their own today.
- Guest accounts are deleted **7 days after creation**, however active. Expired guests are cleaned up whenever someone creates a guest or tries to log in. "Leave and delete guest data" (instead of Log out) deletes the guest immediately.
- Limits: 10 new guests per IP per hour, 500 guests at once, and 200 tasks and 20 lists per guest (deleted ones count). Real accounts have no caps.
- **Turning it off deletes every guest and all their data.** On start-up each server instance deletes all guests while the mode is off. As a backup, any remaining guest session is deleted on its next request, and login housekeeping deletes guests too. Every cleanup is filtered on `is_guest = true` and never touches real accounts.

On Vercel: set `GUEST_MODE` to `on` for Production, then redeploy. To turn it off, remove the variable (or set it to anything else) and redeploy.

## How it fits together

- `src/lib/server/db/schema.ts`: tables. Every row has `user_id`; deletes are soft (`deleted_at`).
- `src/lib/server/{tasks,lists,auth}.ts`: the only code that touches tables. Each store is created from a `Db` (neon-http in the app, PGlite in tests), and every function takes `userId` first and scopes every query by it. `src/lib/server/authorization.test.ts` checks that user A can't read or change user B's rows through any of them.
- `src/lib/server/data.ts`: binds the stores to Neon for the app. Routes and form actions use this.
- `src/lib/server/actions.ts`: form actions shared by every view.
- `src/lib/dates.ts`: calendar-day arithmetic on `'YYYY-MM-DD'` strings, and `todayIn(timeZone)`. Shared by server and client, so labels and the quick-add preview use the same rules as the server.
- `src/lib/repeat.ts`: repeat rules (daily, weekly on weekdays, monthly on a day or the last day, yearly), with `firstOccurrence`, `nextOccurrence` and `describe`. `parseRule` is the one validator: the `repeat_rule` column runs every read and write through it. Completing a recurring task (`tasks.complete`) is one SQL statement, so a double submit can't create two next occurrences. Undo (`tasks.uncomplete`) removes the generated occurrence if it's untouched.
- `src/lib/quick-add.ts`: the quick-add parser (chrono-node plus guards). The client uses it for the preview; the server re-parses the raw text itself.
- **Ordering** uses fractional indexing: a move rewrites only the moved row's `order` key, since neon-http has no interactive transactions. The `order` columns are `text COLLATE "C"`, so Postgres sorts keys byte-wise, the same way the key generator compares them.
- **Auth:** argon2id password hash, random session token in an httpOnly cookie. Only its SHA-256 is stored. Sessions last 30 days and renew once less than 15 days remain. Failed logins are recorded with the client IP. 5 failures for one email from one IP within 15 minutes lock that email _for that IP_ for 15 minutes, so someone else can't lock you out from your own connection. 20 failures from one IP across any emails block that IP for 15 minutes. Attempts older than 24 hours are deleted. Unknown emails get the same response, timing and lockout as real ones.
