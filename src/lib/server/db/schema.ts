import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	customType,
	date,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { parseRule, type RepeatRule } from '../../repeat';

/**
 * Fractional-index keys must sort byte-wise, which the database's default
 * (locale-aware) collation does not guarantee. "C" makes ORDER BY and < / >
 * agree with JavaScript string comparison.
 */
const orderKey = customType<{ data: string }>({ dataType: () => 'text collate "C"' });

/**
 * A recurring task's rule as jsonb. Every value read or written goes through
 * parseRule (src/lib/repeat.ts): an invalid stored rule reads as "not recurring",
 * and writing an invalid one throws.
 */
const repeatRuleColumn = customType<{ data: RepeatRule; driverData: unknown }>({
	dataType: () => 'jsonb',
	toDriver(value) {
		const rule = parseRule(value);
		if (!rule) throw new Error('Invalid repeat rule');
		return JSON.stringify(rule);
	},
	fromDriver(value) {
		return parseRule(value) as RepeatRule;
	}
});

const timestamps = {
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
};

export const users = pgTable(
	'users',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		email: text('email').notNull().unique(),
		/** argon2id hash. Guests get an unusable placeholder (see guests.ts) and can't log in. */
		passwordHash: text('password_hash').notNull(),
		/** IANA zone used to work out "today" for this user; kept in sync from the browser. */
		timeZone: text('time_zone').notNull().default('UTC'),
		/** Temporary guest account (GUEST_MODE): deleted 7 days after creation, or when guest mode is off. */
		isGuest: boolean('is_guest').notNull().default(false),
		/** Client IP that created the guest, for per-IP rate limiting. Null for real users. */
		guestIp: text('guest_ip'),
		createdAt: timestamps.createdAt
	},
	(t) => [
		// Guest expiry cleanup and the global cap.
		index('users_guest_created_idx')
			.on(t.createdAt)
			.where(sql`${t.isGuest}`),
		// Guest creation rate limit per IP.
		index('users_guest_ip_idx')
			.on(t.guestIp, t.createdAt)
			.where(sql`${t.isGuest}`)
	]
);

export const sessions = pgTable(
	'sessions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamps.createdAt
	},
	(t) => [
		uniqueIndex('sessions_token_hash_idx').on(t.tokenHash),
		index('sessions_user_idx').on(t.userId)
	]
);

export const loginAttempts = pgTable(
	'login_attempts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		email: text('email').notNull(),
		// Client IP of the failed attempt. Null only on rows recorded before per-IP lockout.
		ip: text('ip'),
		attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('login_attempts_email_ip_idx').on(t.email, t.ip, t.attemptedAt),
		index('login_attempts_ip_idx').on(t.ip, t.attemptedAt),
		index('login_attempts_attempted_at_idx').on(t.attemptedAt)
	]
);

export const lists = pgTable(
	'lists',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		order: orderKey('order').notNull(),
		archived: boolean('archived').notNull().default(false),
		...timestamps,
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [
		index('lists_user_idx')
			.on(t.userId)
			.where(sql`${t.deletedAt} is null`)
	]
);

export const tasks = pgTable(
	'tasks',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// null = Inbox
		listId: uuid('list_id').references(() => lists.id),
		title: text('title').notNull(),
		notes: text('notes'),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		// A calendar day ('YYYY-MM-DD'), not an instant: string mode so no JS Date shifts it.
		dueDate: date('due_date', { mode: 'string' }),
		pinnedToday: boolean('pinned_today').notNull().default(false),
		/** Recurring tasks: the rule (always with a due date), shared series id, and the occurrence this one was generated from. */
		repeatRule: repeatRuleColumn('repeat_rule'),
		seriesId: uuid('series_id'),
		previousId: uuid('previous_id'),
		order: orderKey('order').notNull(),
		...timestamps,
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [
		index('tasks_user_list_idx')
			.on(t.userId, t.listId)
			.where(sql`${t.deletedAt} is null`),
		index('tasks_user_completed_idx')
			.on(t.userId, t.completedAt)
			.where(sql`${t.deletedAt} is null and ${t.completedAt} is not null`),
		// Today and Upcoming: active tasks by due date.
		index('tasks_user_due_idx')
			.on(t.userId, t.dueDate)
			.where(sql`${t.deletedAt} is null and ${t.completedAt} is null`),
		// Undo of a completion finds the occurrence generated from it.
		index('tasks_previous_idx')
			.on(t.previousId)
			.where(sql`${t.previousId} is not null`),
		// A recurring task always has a due date (the store keeps it; this is the backstop).
		check('tasks_repeat_has_due', sql`${t.repeatRule} is null or ${t.dueDate} is not null`)
	]
);

export type User = typeof users.$inferSelect;
export type List = typeof lists.$inferSelect;
export type Task = typeof tasks.$inferSelect;
