DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole') THEN
        CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'AGENT');
    END IF;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" "UserRole" DEFAULT 'AGENT';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMPTZ(6);

WITH numbered_users AS (
    SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS rn
    FROM "User"
    WHERE "username" IS NULL OR BTRIM("username") = ''
)
UPDATE "User" u
SET "username" = 'user-' || numbered_users.rn || '-' || LEFT(u."id", 8)
FROM numbered_users
WHERE u."id" = numbered_users."id";

UPDATE "User"
SET "passwordHash" = '$2b$10$ViQwUcze/gBRqNivekPJneY09nU.XwBIpKASUM758gy9avDq5Grim'
WHERE "passwordHash" IS NULL OR BTRIM("passwordHash") = '';

UPDATE "User"
SET "role" = 'AGENT'
WHERE "role" IS NULL;

UPDATE "User"
SET "isActive" = true
WHERE "isActive" IS NULL;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
