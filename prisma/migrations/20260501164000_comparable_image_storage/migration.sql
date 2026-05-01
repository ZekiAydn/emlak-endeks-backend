ALTER TABLE "ComparableListing" ADD COLUMN "imageOriginalUrl" TEXT;
ALTER TABLE "ComparableListing" ADD COLUMN "imageStorageProvider" TEXT;
ALTER TABLE "ComparableListing" ADD COLUMN "imageStorageBucket" TEXT;
ALTER TABLE "ComparableListing" ADD COLUMN "imageStorageKey" TEXT;
ALTER TABLE "ComparableListing" ADD COLUMN "imageMime" TEXT;
ALTER TABLE "ComparableListing" ADD COLUMN "imageSize" INTEGER;
ALTER TABLE "ComparableListing" ADD COLUMN "imageEtag" TEXT;
ALTER TABLE "ComparableListing" ADD COLUMN "imageCachedAt" TIMESTAMP(3);

CREATE INDEX "ComparableListing_imageStorageProvider_imageStorageKey_idx" ON "ComparableListing"("imageStorageProvider", "imageStorageKey");
