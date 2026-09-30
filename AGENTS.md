# AGENTS.md

Read this before doing anything in this repository. It is written for any coding agent (Claude Code, Codex, Antigravity or others) and covers what the project is, the rules that must never break, how work is run, and where things stand.

`CLAUDE.md` holds the deploy rules in short form for Claude Code. The two files are kept separate on purpose, but they must never disagree: if you change a deploy or safety rule in one, change it in the other in the same commit.

---

## 1. The project

A pragmatic, hosted todo web app. Guiding idea: capturing a task must be faster than forgetting it, and the app should stay out of the way afterwards. Few concepts, fast capture, no guilt pile.

- **Live:** https://hng-todo-coral.vercel.app
- **Repo:** github.com/babaolu/hng_todo (branch `main`)
- **Owner:** Babatunde (`babaolu`). He directs coding agents rather than writing code himself, reviews at STOP points, and makes the product decisions.
- **Accounts:** one real account per person, created from the command line. There is no sign-up page. A temporary **guest mode** lets anyone with the link try the app in a private, self-deleting account (see §6).

## 2. Stack and hosting

- SvelteKit 2 with Svelte 5 runes, TypeScript strict, Tailwind CSS 4, pnpm (version pinned in `package.json`), Node ≥ 22.
- Postgres on **Neon**, region `aws-eu-west-2` (London), through Drizzle ORM. The app uses the `neon-http` driver, which has **no interactive transactions**: multi-row changes must be single statements (CTEs), not client-side transactions.
- Hosted on **Vercel** (Hobby), functions pinned to `lhr1` (London) in the adapter config, next to the database. The owner is in Lagos; Europe is the lowest-latency choice.
- Deploys come from GitHub: every push to `main` deploys production.
- Local development uses an embedded Postgres (**PGlite**) when `DATABASE_URL=pglite:./.pglite`. This path exists only in dev and is excluded from production builds.
- Tests: Vitest with PGlite (no external database), plus jsdom for component tests. One test worker, because the owner's laptop has 8 GB of RAM and `pnpm dev` often runs alongside.

## 3. Where things live

```
src/
  hooks.server.ts            session resolution, guest-mode handling, start-up (init) cleanup
  service-worker.ts          PWA worker (policy in lib/sw-policy.ts)
  lib/
    dates.ts                 ALL date logic: todayIn(tz), 'YYYY-MM-DD' arithmetic, the app's one date formatter
    quick-add.ts             shared quick-add parser (browser preview + server source of truth)
    repeat.ts                recurrence rule engine: validate, firstOccurrence, nextOccurrence, describe
    highlight.ts             search highlighting / excerpts as plain-text segments
    keyboard.ts, shortcuts.ts   single keyboard dispatcher; shortcuts list shared by the ? dialog and /help
    components/              QuickAdd, TaskView, TaskPanel, Sidebar, SearchBox, dialogs, toasts
    server/                  server-only code; routes never query tables directly
      data.ts                builds the stores on the injected database
      db/                    schema.ts, neon.ts (production driver), pglite.ts (dev/test driver)
      tasks.ts, lists.ts     data access; every function takes userId first
      auth.ts, session.ts, password.ts   login, lockout, sessions, argon2
      users.ts, guests.ts, guest-mode.ts  accounts and guest mode
      export.ts              JSON export (field whitelist)
      test/db.ts             PGlite test database helper
  routes/
    (app)/                   signed-in pages: / (Today), upcoming, inbox, lists/[id], logbook, search, settings, help
    login/, logout/          public login; logout (guests: leave and delete)
drizzle/                     committed SQL migrations, 0000_init … 0005_repeat_requires_due
scripts/                     env.ts (explicit env loader), db.ts, seed-user.ts, user-add.ts
```

## 4. Rules that must never break

These have tests. If a change needs to bend one, stop and ask the owner.

**Data isolation**

- Every query is scoped by `user_id` from the signed-in session, never from request input. Data access lives in `src/lib/server/` in functions that take `userId` first.
- Every new store function is added to `authorization.test.ts`, covering all real/guest pairings. The suite has been mutation-tested: removing a user filter makes it fail. Keep it that way.
- Statements that copy rows (e.g. the recurring-task completion CTE) take `user_id` from the matched row, never from input.

**Auth**

- No sign-up route. Accounts come only from the scripts in §5.
- Passwords: argon2 (`@node-rs/argon2`), minimum 12 characters. Sessions store only a SHA-256 hash of the token; 30-day cookie with sliding renewal; httpOnly, secure in production, sameSite=lax.
- Login errors are generic ("Invalid email or password."), and unknown emails take the same time as wrong passwords. Guest accounts can never sign in with a password.
- Lockout: 5 failures per (email, IP) within 15 minutes locks that pair; 20 failures per IP across all emails blocks that IP. Keyed on IP deliberately, because the owner's email is public in the commit history.

**Guest safety**

- Every guest cleanup path filters on `is_guest = true`. Real accounts must never be touched (`guests.test.ts`, `guest-mode.test.ts`, `guest-flow.test.ts`).
- Only an explicit `GUEST_MODE=off` deletes guests. Unset or any other value disables guests and deletes nothing. No guest cleanup ever runs during a build (`building` is true).

**Production credentials**

- Production credentials live only in `.env.prod`, a name Vite never loads on its own. Never copy or rename them to `.env.production*` or `.env.local`.
- Never run `pnpm preview`, `vite build` or any production-mode command with production credentials. They run the server's start-up code against whatever database they are given (see §10).
- Production is reached only through the explicit `:prod` scripts, which print the database host they used. Check it.

**Rendering and input**

- User text is never rendered with `{@html}`. Highlights and excerpts are built from escaped plain-text segments.
- The server re-parses quick-add text itself and never trusts parsed fields from the client. The only client-sent values it accepts are user choices (`parse=false`, a picked `dueDate`, `dateOrder`), each strictly validated.
- A recurring task always has a due date: enforced by one shared store helper and by a database CHECK constraint.
- Due dates are calendar days stored as `date` with Drizzle `mode: 'string'`. Never convert them through a JS `Date`.

**Service worker**

- It caches only hashed build assets and the offline page. It must never cache HTML pages, `__data.json`, form responses, `/settings/export` or any signed-in response.

## 5. Commands

| Command                                  | What it does                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                               | Local dev server on the local PGlite database from `.env`                                                                                     |
| `pnpm check` / `pnpm lint` / `pnpm test` | Type check, Prettier check, Vitest                                                                                                            |
| `pnpm db:generate`                       | Generate a migration from `schema.ts`                                                                                                         |
| `pnpm db:migrate`                        | Apply migrations locally                                                                                                                      |
| `pnpm db:migrate:prod`                   | Apply migrations to Neon (reads `.env.prod`, uses the direct host)                                                                            |
| `pnpm seed:user` / `seed:user:prod`      | Upsert the `ADMIN_EMAIL` account. It **overwrites** the password, so never use it to add people                                               |
| `pnpm user:add` / `user:add:prod`        | Create an account from `NEW_USER_EMAIL` / `NEW_USER_PASSWORD`; create-only. `--reset` changes an existing account's password and signs it out |

After any `:prod` script that needs a password, remove the `ADMIN_PASSWORD` / `NEW_USER_*` lines from `.env.prod`.

## 6. Environments and configuration

- **`.env`** (git-ignored): local only. PGlite database and the local test account.
- **`.env.prod`** (git-ignored): `DATABASE_URL` (pooled Neon host, used by the app and scripts) and `DIRECT_DATABASE_URL` (direct host, used by migrations). Passwords only while a script needs them.
- **Vercel, Production environment only:** `DATABASE_URL`, `ENABLE_EXPERIMENTAL_COREPACK=1` (so Vercel uses the pinned pnpm) and `GUEST_MODE`. Never add `ADMIN_*`, `NEW_USER_*` or `DIRECT_DATABASE_URL` to Vercel.
- Changing a Vercel variable needs a redeploy to take effect.
- Never commit `.env*` files other than `.env.example`, and never write Neon host names, project IDs or real emails into committed files.

**Guest mode** (`GUEST_MODE`)

- `on`: `/login` shows "Continue as guest" (a POST button; guests are never created on GET, because link previews and crawlers would create empty accounts).
- `off`: guests disabled, guest sessions rejected, **all guest accounts deleted** at start-up and on contact.
- anything else or unset: guests disabled, nothing deleted, one warning logged per instance.
- Guests expire a fixed 7 days after creation (activity never extends it). "Leave and delete guest data" deletes a guest immediately.
- Limits: 10 new guests per IP per hour, 500 guests at once, 200 tasks (deleted ones included) and 20 lists per guest. Real users have no caps.
- New guests get sample lists and tasks relative to their own today, including a recurring task and a "Read me" task explaining quick-add.

## 7. How work is run

The owner writes briefs (often drafted with Claude in chat) and pastes them into the agent. The pattern:

1. **Brief.** Read all of it before starting. If something is ambiguous or contradicts the code, ask rather than guess.
2. **Build.** In the order the brief gives. Keep changes within scope; list anything extra you added and why.
3. **Verify locally.** `pnpm check`, `pnpm lint` and `pnpm test` pass. Browser-check at desktop and 360px, light and dark, with and without JS, with no console errors. For risky logic, mutation-test: break the guard on purpose and confirm the tests fail.
4. **Commit, then STOP** where the brief says so, usually before the production migration and push. Leave `pnpm dev` running with sample data so the owner can try it, and give the local URL.
5. **Report** (see below). The owner reviews and decides.
6. **Ship** when told:
   - migrations: run `pnpm db:migrate:prod` **before** pushing, only for additive changes, and confirm it printed the Neon direct host;
   - push `main`, wait for the Vercel deploy;
   - live check.
7. **Live checks.** Agents don't have the owner's password. With guest mode on, test signed-in behaviour through a guest: create one, check, then "Leave and delete" and confirm with read-only counts that the guest's rows are gone and real users are unchanged. Otherwise check only anonymous behaviour (redirects to `/login`, one wrong-password attempt with a made-up `@example.invalid` email). Create nothing else in production, and never make repeated failed logins (they count toward the lockout).

**Destructive changes.** Dropping or renaming columns or tables, narrowing types, deleting data, or anything else that can't be undone: explain it and wait for the owner's approval first.

**Reports** should include: commit hashes; migrations applied and the host they printed; what was built; anything that differs from the brief; decisions you were unsure about; anything deferred; live-check results. Say plainly when something failed or was not verified. Don't print secrets, full connection strings or passwords.

## 8. Product decisions (settled; don't change without the owner)

**Views**

- `/` is **Today**: tasks due today or earlier, plus pinned tasks, in an "Overdue" group (muted, "3 days ago", never red) and a "Today" group. **Upcoming** shows tomorrow to 14 days by day, then "Later". **Inbox** holds tasks with no list. **Logbook** shows completed tasks (most recent 300).
- Today and Upcoming are ordered by date; drag reordering applies only to Inbox and lists. Ordering uses fractional-index text keys, so a move updates one row.
- **Pins never expire.** A pinned task stays in Today until unpinned or completed. A pinned task with a future date appears in both Today and Upcoming.
- "Today" is computed in the user's IANA time zone (`users.time_zone`, updated from the browser's `tz` cookie), never the server's.

**Quick-add parsing** (`quick-add.ts`)

- Dates are day-only; times of day are ignored.
- A bare weekday means its next occurrence, including today. "next tue", "next week tue" and "tue next week" all mean that weekday in the following week (weeks start Monday). "next week" alone means +7 days.
- Slash dates: d/m, d/m/yy, d/m/yyyy, day-first unless the browser is US English (`dateOrder` field, falling back to `Accept-Language`). Year-less forms count only after a cue word (on, by, due) or at the end of the text, and not after score words. "24/7" is never a date. Dash and dot forms are never dates.
- Dates without a year resolve to the next occurrence, never the past. If several dates match, the last one wins.
- `#name` assigns an existing, non-archived list (case-insensitive, hyphens for spaces). It never creates lists.
- Recurrence phrases count only at the end of the text (before trailing #tags).
- Chips preview what was parsed. ✕ keeps the text literal (`parse=false`); the date chip opens a picker, and a picked date overrides the parsed one.

**Recurring tasks** (`repeat.ts`, `tasks.ts`)

- Completing one marks it done and creates a **new** task for the next occurrence (history is kept in the Logbook). The copy is not pinned.
- The next date follows the schedule, not the completion date, and missed occurrences are skipped: next due = first occurrence strictly after max(current due date, today).
- Month-day rules keep their anchor (31st → last day of shorter months, back to the 31st when it exists); 29 Feb → 28 Feb in non-leap years. Intervals stay on their original grid.
- Completion is one statement and idempotent (double submits create one next occurrence). Undo removes the generated occurrence if untouched; if it was touched, it stays and the original stops repeating. A series never has two open occurrences.
- Removing the repeat or deleting the current task ends the series.

**Other**

- Search: titles and notes, case-insensitive, every word must match, wildcards escaped, at most 100 results, Active and Completed groups, notes matches shown as a one-line excerpt.
- Export: `/settings/export`, JSON `{ format: "todo-export", version: 1, … }` with a strict field whitelist. It never includes password hashes, sessions, user ids, emails, guest IPs or login attempts.
- PWA: installable, full-screen, needs a connection; an offline page only.
- Help lives at `/help`; the shortcuts list has one source (`shortcuts.ts`).

## 9. Status

| Phase          | Contents                                                                                                            | Key commits               |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 0.1 Core       | Auth, quick-add, lists, Inbox, Logbook, reorder, soft delete + Undo, deploy                                         | 2ecff27, a49ad7a          |
| Hardening      | Lockout per (email, IP), `user:add`                                                                                 | 579b1d8                   |
| 0.2 Time       | Due dates, natural-language quick-add, Today/Upcoming, time zones, password toggle, editable date chip, slash dates | a2c00d9, 3a12803, 90b8472 |
| Guest mode     | Temporary private guests behind `GUEST_MODE`                                                                        | 862aea6                   |
| 0.3a Recurring | Repeating tasks; recurring tasks always dated                                                                       | ad0ce0c, b5e9eba          |
| 0.3b           | Search, export, shortcuts, PWA, date format, help, Esc behaviour                                                    | 59e9635, 51d0c69, bbf8281 |
| Safety fixes   | `.env.prod`, explicit guest-mode semantics, notes excerpt                                                           | 0c6322f, b84b4d4          |

Production currently runs with `GUEST_MODE=on`.

**Backlog** (not decided; the owner picks what's next)

- Change password from Settings (today only `user:add:prod --reset`).
- Undo for pinning and for deleting a list.
- A tab left open past midnight keeps the old "today" until it navigates.
- Logbook paging beyond 300; search beyond 100 results or across list names.
- Import from an export file.
- Phase 1.0: offline use with sync, and reminders (email or push).
- IPv6: group addresses by block for the per-IP spray cap.

**Known caveats**

- One real account uses a public disposable inbox. Don't add email-based password reset while it exists.
- Nigerian mobile networks often share one public IP across many users, so per-IP limits can occasionally affect innocent users.

## 10. Lessons from incidents

- **30 Sep 2026: a local preview deleted a real visitor's guest.** `pnpm preview` loaded `.env.production.local` (then the production credentials file), connected to Neon, read `GUEST_MODE` as unset, and the start-up cleanup deleted all guests. Fixes: credentials moved to `.env.prod`, only an explicit `off` deletes, no cleanup during builds, and the rule in §4. Lesson: any command that runs server start-up code must be assumed to act on whatever database it can reach.
- **A test that couldn't fail.** A guest flow test took its "before" snapshot after the cleanup had already run, so it would have passed with the `is_guest` filter removed. Lesson: for safety rules, break the guard on purpose and confirm the test fails.

## 11. Keeping this file current

Update this file in the same commit as any change to: the rules in §4, commands, environments, the work process, a settled product decision, or phase status. Keep it factual and short. It is a reference, not a changelog.
