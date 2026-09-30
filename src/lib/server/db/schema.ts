import { sql } from 'drizzle-orm';
import {
	boolean,
	customType,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

/**
 * Fractional-index keys must sort byte-wise, which the database's default
 * (locale-aware) collation does not guarantee. "C" makes ORDER BY and < / >
 * agree with JavaScript string comparison.
 */
const orderKey = customType<{ data: string }>({ dataType: () => 'text collate "C"' });

const timestamps = {
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
};

export const users = pgTable('users', {
	id: uuid('id').primaryKey().defaultRandom(),
	email: text('email').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	createdAt: timestamps.createdAt
});

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
		attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('login_attempts_email_idx').on(t.email, t.attemptedAt)]
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
			.where(sql`${t.deletedAt} is null and ${t.completedAt} is not null`)
	]
);

export type User = typeof users.$inferSelect;
export type List = typeof lists.$inferSelect;
export type Task = typeof tasks.$inferSelect;
