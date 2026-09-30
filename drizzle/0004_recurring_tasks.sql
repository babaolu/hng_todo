ALTER TABLE "tasks" ADD COLUMN "repeat_rule" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "previous_id" uuid;--> statement-breakpoint
CREATE INDEX "tasks_previous_idx" ON "tasks" USING btree ("previous_id") WHERE "tasks"."previous_id" is not null;