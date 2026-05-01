import crypto from "node:crypto";
import sharp from "sharp";
import prisma from "../prisma.js";
import { objectStorageEnabled, putStoredObject, storedObjectReadUrl } from "./mediaStorage.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12000;
const CACHE_CONCURRENCY = 4;

function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function isHttpUrl(value) {
    try {
        const parsed = new URL(String(value || ""));
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

function safeSegment(value, fallback = "listing") {
    return String(value || fallback)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64) || fallback;
}

function imageHash(value) {
    return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 24);
}

function extFromMime(mime) {
    const lower = cleanText(mime).toLowerCase().split(";")[0];
    if (lower === "image/png") return ".png";
    return ".jpg";
}

function cacheableImageUrl(url) {
    const text = cleanText(url);
    if (!isHttpUrl(text)) return false;

    const lower = text.toLowerCase();
    if (lower.includes("/comparables/mock-image")) return false;
    if (lower.includes("/comparables/street-view")) return false;
    if (lower.includes("maps.googleapis.com/maps/api/streetview")) return false;
    if (lower.startsWith("data:")) return false;

    return true;
}

function imageUrlForCache(item = {}) {
    return cleanText(item.imageOriginalUrl || item.imageUrl);
}

function sourceUrlForLookup(item = {}) {
    return cleanText(item.sourceUrl || item.listingUrl);
}

function imageObjectKey(item = {}, imageUrl, mime) {
    const source = safeSegment(item.source || item.provider || "listing");
    return `media/comparables/${source}/${imageHash(imageUrl)}${extFromMime(mime)}`;
}

function parseContentType(value) {
    const mime = cleanText(value).split(";")[0].toLowerCase();
    if (!mime || !mime.startsWith("image/")) return null;
    if (mime === "image/svg+xml") return null;
    return mime;
}

async function fetchImageBuffer(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            redirect: "follow",
            headers: {
                "user-agent": "EmlakSkor Image Cache/1.0",
                accept: "image/avif,image/webp,image/apng,image/png,image/jpeg,image/*,*/*;q=0.8",
            },
        });

        if (!response.ok) {
            return { ok: false, reason: `http_${response.status}` };
        }

        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
            return { ok: false, reason: "too_large" };
        }

        const mime = parseContentType(response.headers.get("content-type")) || "image/jpeg";
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) return { ok: false, reason: "empty" };
        if (buffer.length > MAX_IMAGE_BYTES) return { ok: false, reason: "too_large" };

        return { ok: true, buffer, mime };
    } catch (error) {
        return { ok: false, reason: error?.name === "AbortError" ? "timeout" : "fetch_failed" };
    } finally {
        clearTimeout(timer);
    }
}

async function normalizeImageForPdf(buffer) {
    const normalized = await sharp(buffer, { animated: false })
        .rotate()
        .jpeg({ quality: 84, mozjpeg: true })
        .toBuffer();

    return {
        buffer: normalized,
        mime: "image/jpeg",
    };
}

export function comparableImageCacheFromListing(row = {}) {
    if (!row?.imageStorageKey) return null;

    return {
        storageProvider: row.imageStorageProvider || "s3",
        storageBucket: row.imageStorageBucket || null,
        storageKey: row.imageStorageKey,
        mime: row.imageMime || null,
        size: row.imageSize ?? null,
        etag: row.imageEtag || null,
        cachedAt: row.imageCachedAt?.toISOString?.() || row.imageCachedAt || null,
        originalUrl: row.imageOriginalUrl || row.imageUrl || null,
    };
}

export function comparableImageCacheDbFields(item = {}) {
    const cache = item.imageCache || null;
    if (!cache?.storageKey) {
        return {
            imageOriginalUrl: cleanText(item.imageOriginalUrl || item.imageUrl) || null,
            imageStorageProvider: null,
            imageStorageBucket: null,
            imageStorageKey: null,
            imageMime: null,
            imageSize: null,
            imageEtag: null,
            imageCachedAt: null,
        };
    }

    const cachedAt = cache.cachedAt ? new Date(cache.cachedAt) : new Date();

    return {
        imageOriginalUrl: cleanText(cache.originalUrl || item.imageOriginalUrl || item.imageUrl) || null,
        imageStorageProvider: cache.storageProvider || "s3",
        imageStorageBucket: cache.storageBucket || null,
        imageStorageKey: cache.storageKey,
        imageMime: cache.mime || null,
        imageSize: Number.isFinite(Number(cache.size)) ? Number(cache.size) : null,
        imageEtag: cache.etag || null,
        imageCachedAt: Number.isNaN(cachedAt.getTime()) ? new Date() : cachedAt,
    };
}

function comparableImageCacheFromStored(stored, originalUrl) {
    if (!stored?.storageKey) return null;

    return {
        storageProvider: stored.storageProvider || "s3",
        storageBucket: stored.storageBucket || null,
        storageKey: stored.storageKey,
        mime: stored.mime || null,
        size: stored.size ?? null,
        etag: stored.etag || null,
        cachedAt: new Date().toISOString(),
        originalUrl,
    };
}

async function findReusableImageCache(item = {}) {
    const sourceUrl = sourceUrlForLookup(item);
    if (!sourceUrl) return null;

    const row = await prisma.comparableListing.findFirst({
        where: {
            OR: [
                { sourceUrl },
                { listingUrl: sourceUrl },
            ],
            imageStorageKey: { not: null },
        },
        orderBy: { updatedAt: "desc" },
        select: {
            imageUrl: true,
            imageOriginalUrl: true,
            imageStorageProvider: true,
            imageStorageBucket: true,
            imageStorageKey: true,
            imageMime: true,
            imageSize: true,
            imageEtag: true,
            imageCachedAt: true,
        },
    });

    return comparableImageCacheFromListing(row);
}

function increment(stats, key) {
    stats.skipReasons[key] = (stats.skipReasons[key] || 0) + 1;
}

async function cacheOneComparableImage(item = {}, stats) {
    if (item.imageCache?.storageKey) {
        stats.reused += 1;
        return item;
    }

    const reusable = await findReusableImageCache(item);
    if (reusable?.storageKey) {
        stats.reused += 1;
        return {
            ...item,
            imageOriginalUrl: item.imageOriginalUrl || reusable.originalUrl || item.imageUrl || null,
            imageCache: reusable,
        };
    }

    if (!objectStorageEnabled()) {
        stats.skipped += 1;
        increment(stats, "s3_disabled");
        return item;
    }

    const imageUrl = imageUrlForCache(item);
    if (!cacheableImageUrl(imageUrl)) {
        stats.skipped += 1;
        increment(stats, "not_cacheable");
        return item;
    }

    const fetched = await fetchImageBuffer(imageUrl);
    if (!fetched.ok) {
        stats.failed += 1;
        increment(stats, fetched.reason || "fetch_failed");
        return item;
    }

    try {
        const normalized = await normalizeImageForPdf(fetched.buffer);
        const stored = await putStoredObject({
            key: imageObjectKey(item, imageUrl, normalized.mime),
            buffer: normalized.buffer,
            mime: normalized.mime,
        });

        if (!stored?.storageKey) {
            stats.failed += 1;
            increment(stats, "store_failed");
            return item;
        }

        stats.cached += 1;
        return {
            ...item,
            imageOriginalUrl: item.imageOriginalUrl || item.imageUrl || imageUrl,
            imageCache: comparableImageCacheFromStored(stored, imageUrl),
        };
    } catch {
        stats.failed += 1;
        increment(stats, "store_failed");
        return item;
    }
}

export async function cacheComparableImages(comparables = []) {
    const items = Array.isArray(comparables) ? comparables : [];
    const stats = {
        attempted: items.length,
        cached: 0,
        reused: 0,
        skipped: 0,
        failed: 0,
        skipReasons: {},
    };

    if (!items.length) return { comparables: items, stats };

    const output = new Array(items.length);
    let cursor = 0;

    async function worker() {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            output[index] = await cacheOneComparableImage(items[index], stats);
        }
    }

    const workerCount = Math.min(CACHE_CONCURRENCY, items.length);
    await Promise.all(Array.from({ length: workerCount }, worker));

    return { comparables: output, stats };
}

export async function withSignedComparableImageUrls(comparables = [], options = {}) {
    const items = Array.isArray(comparables) ? comparables : [];

    return Promise.all(items.map(async (item) => {
        const cache = item?.imageCache;
        const cachedImageUrl = cache?.storageKey
            ? await storedObjectReadUrl(cache, options).catch(() => null)
            : null;

        return cachedImageUrl ? { ...item, cachedImageUrl } : item;
    }));
}

export async function withSignedComparableImagesForReport(report, options = {}) {
    const comparables = report?.comparablesJson?.comparables;
    if (!Array.isArray(comparables) || !comparables.length) return report;

    return {
        ...report,
        comparablesJson: {
            ...(report.comparablesJson || {}),
            comparables: await withSignedComparableImageUrls(comparables, options),
        },
    };
}
