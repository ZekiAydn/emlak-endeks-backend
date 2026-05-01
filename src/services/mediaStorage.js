import { randomUUID } from "node:crypto";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let s3Client = null;
const SIGNED_URL_TTL_SECONDS = 60 * 30;
const MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

function cleanEnv(value) {
    const text = String(value || "").trim();
    return text || null;
}

export function objectStorageEnabled() {
    const config = s3Config();
    return Boolean(config.bucket && config.credentials);
}

function s3Config() {
    const accessKeyId = cleanEnv(process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID);
    const secretAccessKey = cleanEnv(process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY);

    return {
        bucket: cleanEnv(process.env.AWS_S3_BUCKET_NAME || process.env.S3_BUCKET),
        region: cleanEnv(process.env.AWS_REGION || process.env.S3_REGION || "eu-north-1"),
        credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    };
}

function client() {
    if (s3Client) return s3Client;

    const config = s3Config();
    s3Client = new S3Client({
        region: config.region,
        credentials: config.credentials,
    });

    return s3Client;
}

function safeSegment(value, fallback = "file") {
    return String(value || fallback)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || fallback;
}

function extensionFrom(filename, mime) {
    const ext = path.extname(String(filename || "")).toLowerCase();
    if (ext && ext.length <= 8) return ext;
    if (mime === "image/png") return ".png";
    if (mime === "image/webp") return ".webp";
    if (mime === "image/gif") return ".gif";
    if (mime === "application/pdf") return ".pdf";
    return ".jpg";
}

export function mediaObjectKey({ type, filename, mime, userId, reportId }) {
    const owner = userId ? `users/${safeSegment(userId)}` : reportId ? `reports/${safeSegment(reportId)}` : "unscoped";
    const kind = safeSegment(type, "media");
    const ext = extensionFrom(filename, mime);
    return `media/${owner}/${kind}/${Date.now()}-${randomUUID()}${ext}`;
}

export async function putStoredObject({ key, buffer, mime, cacheControl = MEDIA_CACHE_CONTROL }) {
    if (!objectStorageEnabled() || !key || !buffer || !mime) return null;

    const config = s3Config();
    const response = await client().send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: buffer,
        ContentType: mime,
        CacheControl: cacheControl,
    }));

    return {
        storageProvider: "s3",
        storageBucket: config.bucket,
        storageKey: key,
        mime,
        size: buffer?.length || null,
        etag: response.ETag ? String(response.ETag).replace(/^"|"$/g, "") : null,
    };
}

export async function storedObjectReadUrl(object, { expiresIn = SIGNED_URL_TTL_SECONDS } = {}) {
    if (!object?.storageKey) return null;
    if (!objectStorageEnabled()) return null;

    const config = s3Config();
    return getSignedUrl(
        client(),
        new GetObjectCommand({
            Bucket: object.storageBucket || config.bucket,
            Key: object.storageKey,
        }),
        { expiresIn }
    );
}

export async function deleteStoredObject(object) {
    if (!object?.storageKey || object.storageProvider !== "s3") return;

    const config = s3Config();
    await client().send(new DeleteObjectCommand({
        Bucket: object.storageBucket || config.bucket,
        Key: object.storageKey,
    })).catch(() => {});
}

export async function buildStoredMediaData({ type, mime, filename, buffer, userId = null, reportId = null, order = 0 }) {
    const base = {
        type,
        mime,
        filename: filename || null,
        userId: userId || null,
        reportId: reportId || null,
        order: order ? Number(order) : 0,
        size: buffer?.length || null,
    };

    if (!objectStorageEnabled()) {
        return {
            ...base,
            data: buffer,
        };
    }

    const storageKey = mediaObjectKey({ type, filename, mime, userId, reportId });
    const stored = await putStoredObject({ key: storageKey, buffer, mime });

    return {
        ...base,
        data: null,
        storageProvider: stored.storageProvider,
        storageBucket: stored.storageBucket,
        storageKey: stored.storageKey,
        url: null,
        etag: stored.etag,
    };
}

export async function mediaReadUrl(media, { expiresIn = SIGNED_URL_TTL_SECONDS } = {}) {
    return storedObjectReadUrl(media, { expiresIn });
}

export async function deleteStoredMediaObject(media) {
    await deleteStoredObject(media);
}
