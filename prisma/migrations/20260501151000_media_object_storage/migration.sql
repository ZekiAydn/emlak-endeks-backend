ALTER TABLE "Media" ALTER COLUMN "data" DROP NOT NULL;
ALTER TABLE "Media" ADD COLUMN "storageProvider" TEXT;
ALTER TABLE "Media" ADD COLUMN "storageBucket" TEXT;
ALTER TABLE "Media" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "Media" ADD COLUMN "url" TEXT;
ALTER TABLE "Media" ADD COLUMN "size" INTEGER;
ALTER TABLE "Media" ADD COLUMN "etag" TEXT;
CREATE INDEX "Media_storageProvider_storageKey_idx" ON "Media"("storageProvider", "storageKey");
