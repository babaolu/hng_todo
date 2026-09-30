ALTER TABLE "users" ADD COLUMN "is_guest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guest_ip" text;--> statement-breakpoint
CREATE INDEX "users_guest_created_idx" ON "users" USING btree ("created_at") WHERE "users"."is_guest";--> statement-breakpoint
CREATE INDEX "users_guest_ip_idx" ON "users" USING btree ("guest_ip","created_at") WHERE "users"."is_guest";