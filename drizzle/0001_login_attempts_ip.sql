ALTER TABLE "login_attempts" ADD COLUMN "ip" text;--> statement-breakpoint
CREATE INDEX "login_attempts_email_ip_idx" ON "login_attempts" USING btree ("email","ip","attempted_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","attempted_at");--> statement-breakpoint
CREATE INDEX "login_attempts_attempted_at_idx" ON "login_attempts" USING btree ("attempted_at");