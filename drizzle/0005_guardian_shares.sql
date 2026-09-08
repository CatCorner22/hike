-- Opt-in, time-limited Guardian status links.
--
-- Only a SHA-256 digest of the bearer token is stored. The status JSON is API-bounded
-- to progress, ETA, battery and route deviation: never exact GPS, ICE or medical data.

CREATE TABLE IF NOT EXISTS "guardian_shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "route_name" text NOT NULL,
  "overdue_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "latest_status" jsonb,
  "last_update_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "guardian_shares_token_hash_unique"
  ON "guardian_shares" ("token_hash");
CREATE INDEX IF NOT EXISTS "guardian_shares_owner_id_idx"
  ON "guardian_shares" ("owner_id");
CREATE INDEX IF NOT EXISTS "guardian_shares_expires_at_idx"
  ON "guardian_shares" ("expires_at");
