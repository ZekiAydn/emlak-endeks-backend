import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

const ACTORS = {
    emlakjet: {
        id: "seralifatih/turkish-real-estate-api-1",
        label: "Emlakjet Property Scraper",
    },
    sahibinden: {
        id: "clearpath/sahibinden-real-estate",
        label: "Sahibinden Real Estate Scraper",
    },
};

function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function slugifyTr(value) {
    return cleanText(value)
        .toLocaleLowerCase("tr-TR")
        .replace(/ı/g, "i")
        .replace(/ğ/g, "g")
        .replace(/ü/g, "u")
        .replace(/ş/g, "s")
        .replace(/ö/g, "o")
        .replace(/ç/g, "c")
        .replace(/İ/g, "i")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function parseArgs(argv) {
    const out = {
        actor: "emlakjet",
        city: "istanbul",
        district: "pendik",
        neighborhood: "yesilbaglar",
        rooms: "2+1",
        area: 90,
        max: 20,
        waitSecs: 180,
        saveRaw: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith("--")) continue;
        const key = arg.slice(2);
        const next = argv[index + 1];
        if (key === "save-raw") {
            out.saveRaw = true;
            continue;
        }
        if (next === undefined || next.startsWith("--")) {
            out[key] = true;
            continue;
        }
        out[key] = next;
        index += 1;
    }

    out.area = Number(out.area || 0);
    out.max = Math.max(1, Math.min(Number(out.max || 20), 50));
    out.waitSecs = Math.max(30, Math.min(Number(out.waitSecs || 180), 300));
    return out;
}

function inputForEmlakjet(options) {
    const city = slugifyTr(options.city);
    const district = slugifyTr(options.district);
    const neighborhood = slugifyTr(options.neighborhood);
    const room = cleanText(options.rooms);
    const area = Number(options.area || 0);
    const areaMin = area > 0 ? Math.round(area * 0.65) : undefined;
    const areaMax = area > 0 ? Math.round(area * 1.5) : undefined;

    const searchUrls = neighborhood
        ? [`https://www.emlakjet.com/satilik-daire/${city}-${district}-${neighborhood}-mahallesi`]
        : [];

    return {
        ...(searchUrls.length ? { searchUrls } : {}),
        filters: {
            listingType: "satilik",
            propertyType: "daire",
            city,
            district,
            ...(room ? { rooms: room } : {}),
            ...(areaMin ? { areaMin } : {}),
            ...(areaMax ? { areaMax } : {}),
        },
        maxListings: options.max,
        scrapeDetails: true,
        proxyConfig: { useApifyProxy: true },
    };
}

function inputForSahibinden(options) {
    const room = cleanText(options.rooms);
    const area = Number(options.area || 0);
    return {
        listingType: "Sale",
        propertyCategory: "Residential",
        propertyType: ["Apartment"],
        city: "Istanbul (Asian)",
        ...(room ? { rooms: [room] } : {}),
        ...(area > 0 ? { minSize: Math.round(area * 0.65), maxSize: Math.round(area * 1.5) } : {}),
        extractPhoneNumbers: false,
        maxResults: options.max,
        sortBy: "Newest",
    };
}

function buildInput(options) {
    if (options.inputFile) {
        return fs.readFile(path.resolve(options.inputFile), "utf8").then((text) => JSON.parse(text));
    }
    if (options.actor === "emlakjet") return inputForEmlakjet(options);
    if (options.actor === "sahibinden") return inputForSahibinden(options);
    throw new Error(`Bilinmeyen actor: ${options.actor}. Kullan: emlakjet veya sahibinden.`);
}

async function apifyJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            accept: "application/json",
            ...(options.body ? { "content-type": "application/json" } : {}),
            ...(options.headers || {}),
        },
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) {
        throw new Error(`Apify ${response.status}: ${JSON.stringify(json).slice(0, 600)}`);
    }
    return json;
}

async function runActor(actorId, input, options) {
    const token = process.env.APIFY_TOKEN;
    if (!token) {
        throw new Error("APIFY_TOKEN eksik. .env içine APIFY_TOKEN=... ekle.");
    }

    const encodedActorId = actorId.replace("/", "~");
    const runUrl = new URL(`https://api.apify.com/v2/acts/${encodedActorId}/runs`);
    runUrl.searchParams.set("token", token);
    runUrl.searchParams.set("waitForFinish", String(options.waitSecs));

    const runResponse = await apifyJson(runUrl, {
        method: "POST",
        body: JSON.stringify(input),
    });
    const run = runResponse.data;
    if (!run?.defaultDatasetId) {
        throw new Error(`Run dataset üretmedi. Status: ${run?.status || "UNKNOWN"}`);
    }
    if (!["SUCCEEDED", "RUNNING", "READY"].includes(run.status)) {
        throw new Error(`Actor başarısız döndü. Status: ${run.status}. Run ID: ${run.id}`);
    }

    const datasetUrl = new URL(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items`);
    datasetUrl.searchParams.set("token", token);
    datasetUrl.searchParams.set("clean", "true");
    datasetUrl.searchParams.set("format", "json");

    const items = await apifyJson(datasetUrl);
    return { run, items: Array.isArray(items) ? items : [] };
}

function firstNumber(...values) {
    for (const value of values) {
        if (value === undefined || value === null || value === "") continue;
        let normalized = String(value).trim().replace(/[^\d.,-]/g, "");
        if (normalized.includes(",")) {
            normalized = normalized.replace(/\./g, "").replace(",", ".");
        } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
            normalized = normalized.replace(/\./g, "");
        } else if ((normalized.match(/\./g) || []).length > 1) {
            normalized = normalized.replace(/\./g, "");
        }
        const parsed = Number(normalized);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function firstText(...values) {
    return values.map(cleanText).find(Boolean) || null;
}

function firstArrayItem(...values) {
    for (const value of values) {
        if (Array.isArray(value) && value.length) return value[0];
        if (typeof value === "string" && value) return value;
    }
    return null;
}

function normalizeItem(item = {}) {
    const priceObject = typeof item.price === "object" && item.price ? item.price : null;
    const roomLayout = typeof item.roomLayout === "object" && item.roomLayout ? item.roomLayout : null;
    const specs = typeof item.specifications === "object" && item.specifications ? item.specifications : {};

    return {
        title: firstText(item.title, item.name),
        sourceUrl: firstText(item.url, item.listingUrl, item.sourceUrl),
        source: firstText(item.source, item.platform),
        price: firstNumber(priceObject?.amount, item.price, item.priceAmount, item.originalPrice, item.formattedPrice),
        grossArea: firstNumber(item.grossArea, item.grossSize, item.sizeGross, specs["Brüt m²"], specs["Brüt Metrekare"]),
        netArea: firstNumber(item.netArea, item.netSize, item.sizeNet, specs["Net m²"], specs["Net Metrekare"]),
        roomText: firstText(item.roomText, item.rooms, roomLayout?.label, specs["Oda Sayısı"]),
        imageUrl: firstArrayItem(item.imageUrls, item.images, item.photos, item.photoUrls, item.imageUrl),
        city: firstText(item.city),
        district: firstText(item.district),
        neighborhood: firstText(item.neighborhood, item.quarter),
        address: firstText(item.fullAddress, item.address),
        latitude: firstNumber(item.latitude, item.lat),
        longitude: firstNumber(item.longitude, item.lon, item.lng),
        raw: item,
    };
}

function hasComparableShape(item = {}) {
    return Boolean(item.title || item.sourceUrl || item.price || item.grossArea || item.netArea || item.roomText || item.imageUrl);
}

function normalizeForCompare(value) {
    return slugifyTr(value).replace(/-/g, "");
}

function scoreComparable(item, options) {
    const area = Number(options.area || 0);
    const actualArea = item.netArea || item.grossArea;
    const areaRatio = area > 0 && actualArea ? actualArea / area : null;
    const districtNeedle = normalizeForCompare(options.district);
    const neighborhoodNeedle = normalizeForCompare(options.neighborhood);
    const haystack = normalizeForCompare([item.city, item.district, item.neighborhood, item.address, item.title, item.sourceUrl].filter(Boolean).join(" "));

    const checks = {
        hasPrice: Number.isFinite(item.price) && item.price > 0,
        hasArea: Number.isFinite(actualArea) && actualArea > 10,
        hasRoom: Boolean(item.roomText),
        hasImage: Boolean(item.imageUrl),
        hasUrl: Boolean(item.sourceUrl),
        roomMatch: !options.rooms || cleanText(item.roomText) === cleanText(options.rooms),
        areaCompatible: !areaRatio || (areaRatio >= 0.65 && areaRatio <= 1.5),
        districtMatch: !districtNeedle || haystack.includes(districtNeedle),
        neighborhoodMatch: !neighborhoodNeedle || haystack.includes(neighborhoodNeedle),
    };

    const ready = checks.hasPrice &&
        checks.hasArea &&
        checks.hasRoom &&
        checks.hasImage &&
        checks.hasUrl &&
        checks.areaCompatible &&
        checks.districtMatch;

    return {
        ...checks,
        readyComparable: ready,
        score: Object.values(checks).filter(Boolean).length,
    };
}

function summarize(normalized, scored) {
    const count = normalized.length;
    const sum = (key) => scored.filter((item) => item[key]).length;
    return {
        count,
        readyComparable: sum("readyComparable"),
        hasPrice: sum("hasPrice"),
        hasArea: sum("hasArea"),
        hasRoom: sum("hasRoom"),
        hasImage: sum("hasImage"),
        roomMatch: sum("roomMatch"),
        areaCompatible: sum("areaCompatible"),
        districtMatch: sum("districtMatch"),
        neighborhoodMatch: sum("neighborhoodMatch"),
    };
}

const options = parseArgs(process.argv.slice(2));
const actor = ACTORS[options.actor] || { id: options.actorId, label: options.actorId };
if (!actor.id) throw new Error("--actor veya --actor-id gerekli.");

const input = await buildInput(options);
console.log("[APIFY_TEST] actor", actor);
console.log("[APIFY_TEST] input", JSON.stringify(input, null, 2));

const { run, items } = await runActor(actor.id, input, options);
const normalized = items.map(normalizeItem).filter(hasComparableShape);
const scored = normalized.map((item) => scoreComparable(item, options));
const summary = summarize(normalized, scored);
const samples = normalized
    .map((item, index) => ({ ...item, raw: undefined, checks: scored[index] }))
    .sort((a, b) => b.checks.score - a.checks.score)
    .slice(0, 10);

const result = {
    actor,
    run: {
        id: run.id,
        status: run.status,
        defaultDatasetId: run.defaultDatasetId,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
    },
    summary,
    samples,
};

console.log("[APIFY_TEST] result");
console.log(JSON.stringify(result, null, 2));

if (options.saveRaw) {
    const filename = path.resolve(`apify-test-${options.actor}-${Date.now()}.json`);
    await fs.writeFile(filename, JSON.stringify({ result, input, items }, null, 2));
    console.log(`[APIFY_TEST] raw saved ${filename}`);
}
