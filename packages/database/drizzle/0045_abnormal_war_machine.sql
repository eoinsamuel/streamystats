CREATE TABLE "ledger_records" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_records_identity" UNIQUE("server_id","user_id","kind","source_key")
);
--> statement-breakpoint
ALTER TABLE "ledger_records" ADD CONSTRAINT "ledger_records_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_records" ADD CONSTRAINT "ledger_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_records_user_idx" ON "ledger_records" USING btree ("server_id","user_id");
