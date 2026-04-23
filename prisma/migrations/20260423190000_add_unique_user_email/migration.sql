UPDATE "User"
SET "email" = NULL
WHERE "email" IS NOT NULL AND BTRIM("email") = '';

UPDATE "User"
SET "email" = LOWER(BTRIM("email"))
WHERE "email" IS NOT NULL;

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
