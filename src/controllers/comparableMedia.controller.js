import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const WIDTH = 640;
const HEIGHT = 360;
const DEFAULT_SIZE = "640x360";
const DEFAULT_COMPARABLE_IMAGE = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../assets/no-comparable-image.png")
);

let crcTable = null;

function makeCrcTable() {
    const table = [];
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
}

function crc32(buffer) {
    crcTable ||= makeCrcTable();
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const typeBuffer = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
    return Buffer.concat([length, typeBuffer, data, crc]);
}

function hexToRgb(hex) {
    const normalized = hex.replace("#", "");
    return [
        parseInt(normalized.slice(0, 2), 16),
        parseInt(normalized.slice(2, 4), 16),
        parseInt(normalized.slice(4, 6), 16),
    ];
}

function setPixel(buffer, x, y, color) {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const rowStart = y * (WIDTH * 4 + 1) + 1;
    const offset = rowStart + x * 4;
    buffer[offset] = color[0];
    buffer[offset + 1] = color[1];
    buffer[offset + 2] = color[2];
    buffer[offset + 3] = color[3] ?? 255;
}

function fillRect(buffer, x, y, w, h, color) {
    for (let yy = y; yy < y + h; yy += 1) {
        for (let xx = x; xx < x + w; xx += 1) {
            setPixel(buffer, xx, yy, color);
        }
    }
}

function drawMockPng(variant = 1) {
    const accent = hexToRgb(variant === 2 ? "#10B981" : variant === 3 ? "#0F766E" : "#059669");
    const buffer = Buffer.alloc(HEIGHT * (WIDTH * 4 + 1));

    for (let y = 0; y < HEIGHT; y += 1) {
        buffer[y * (WIDTH * 4 + 1)] = 0;
        for (let x = 0; x < WIDTH; x += 1) {
            const t = (x + y) / (WIDTH + HEIGHT);
            const bg = [
                Math.round(248 * (1 - t) + 226 * t),
                Math.round(250 * (1 - t) + 232 * t),
                Math.round(252 * (1 - t) + 240 * t),
                255,
            ];
            setPixel(buffer, x, y, bg);
        }
    }

    fillRect(buffer, 0, 276, 640, 84, [203, 213, 225, 255]);
    fillRect(buffer, 70, 96, 150, 180, [...accent, 238]);
    fillRect(buffer, 250, 56, 150, 220, [15, 23, 42, 224]);
    fillRect(buffer, 430, 118, 130, 158, [...accent, 210]);
    fillRect(buffer, 40, 34, 180, 42, [255, 255, 255, 238]);
    fillRect(buffer, 56, 47, 24, 18, [...accent, 255]);
    fillRect(buffer, 40, 292, 560, 44, [255, 255, 255, 232]);

    for (let i = 0; i < 18; i += 1) {
        const x = 94 + (i % 3) * 38;
        const y = 126 + Math.floor(i / 3) * 24;
        fillRect(buffer, x, y, 18, 12, [236, 253, 245, 220]);
    }

    for (let i = 0; i < 24; i += 1) {
        const x = 276 + (i % 3) * 38;
        const y = 88 + Math.floor(i / 3) * 22;
        fillRect(buffer, x, y, 18, 11, [248, 250, 252, 188]);
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(WIDTH, 0);
    header.writeUInt32BE(HEIGHT, 4);
    header[8] = 8;
    header[9] = 6;
    header[10] = 0;
    header[11] = 0;
    header[12] = 0;

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", deflateSync(buffer)),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

function safeParam(value, fallback = "") {
    return String(value || fallback).trim();
}

function googleMapsKey() {
    return "";
}

export function mockComparableImage(req, res) {
    res.setHeader("content-type", "image/png");
    res.setHeader("cache-control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(DEFAULT_COMPARABLE_IMAGE);
}

export async function streetViewComparableImage(req, res) {
    const key = googleMapsKey();
    if (!key) {
        res.status(503).send("Google Maps API key is not configured.");
        return;
    }

    const location = safeParam(req.query.location);
    if (!location) {
        res.status(400).send("Street View location is required.");
        return;
    }

    const params = new URLSearchParams({
        size: safeParam(req.query.size, DEFAULT_SIZE),
        location,
        fov: safeParam(req.query.fov, "80"),
        pitch: safeParam(req.query.pitch, "0"),
        source: safeParam(req.query.source, "outdoor"),
        key,
    });

    const response = await fetch(`https://maps.googleapis.com/maps/api/streetview?${params.toString()}`, {
        cache: "no-store",
    });

    if (!response.ok) {
        res.status(response.status).send("Street View image could not be fetched.");
        return;
    }

    const arrayBuffer = await response.arrayBuffer();
    res.setHeader("content-type", response.headers.get("content-type") || "image/jpeg");
    res.setHeader("cache-control", "no-store");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(Buffer.from(arrayBuffer));
}
