import dns from "node:dns/promises";
import net from "node:net";
import { comparableSearchText, propertyCategory } from "./propertyCategory.js";

const MAX_COMPARABLES = 24;
const MAX_HTML_BYTES = 700_000;
const FETCH_TIMEOUT_MS = 7000;
const REAL_IMAGE_RESERVE_FOR_MOCKS = 0;

function toText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function decodeHtml(value = "") {
    return String(value)
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ");
}

function stripHtml(html = "") {
    return decodeHtml(
        String(html)
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
    ).trim();
}

function normalizeNumber(value) {
    const text = String(value || "").replace(/\s/g, "");
    const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text.replace(/\./g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function extractArea(...sources) {
    const text = sources.map((source) => toText(source)).filter(Boolean).join(" ");
    const patterns = [
        /(?:net|kullanım|kullanim)\s*(?:alanı|alani)?\s*:?\s*([1-9][\d.,]{1,7})\s*(?:m²|m2|metrekare)(?=\s|$|[.,;:)])/i,
        /(?:brüt|brut)\s*(?:alanı|alani)?\s*:?\s*([1-9][\d.,]{1,7})\s*(?:m²|m2|metrekare)(?=\s|$|[.,;:)])/i,
        /\b([1-9][\d.,]{1,7})\s*(?:m²|m2|metrekare)(?=\s|$|[.,;:)])/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        const area = match ? normalizeNumber(match[1]) : null;
        if (area && area >= 10 && area <= 100000) return Math.round(area);
    }

    return null;
}

function extractRoomText(...sources) {
    const text = sources.map((source) => toText(source)).filter(Boolean).join(" ");
    const match = text.match(/\b(?:[1-9]\d?\s*\+\s*[0-9]|stüdyo|studio)\b/i);
    return match ? match[0].replace(/\s+/g, "") : null;
}

function findMetaContent(html, key) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
        new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>`, "i"),
        new RegExp(`<meta\\b(?=[^>]*content=["']([^"']+)["'])(?=[^>]*(?:property|name)=["']${escaped}["'])[^>]*>`, "i"),
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) return decodeHtml(match[1]).trim();
    }

    return null;
}

function absoluteUrl(value, baseUrl) {
    const text = toText(value);
    if (!text) return null;

    try {
        return new URL(text, baseUrl).toString();
    } catch {
        return null;
    }
}

function normalizeImageCandidate(value, baseUrl) {
    const decoded = decodeHtml(String(value || ""))
        .replace(/\\u002F/g, "/")
        .replace(/\\\//g, "/")
        .trim();
    const firstSrcsetUrl = decoded.split(",").map((part) => part.trim().split(/\s+/)[0]).find(Boolean);
    const url = absoluteUrl(firstSrcsetUrl || decoded, baseUrl);
    if (!url) return null;

    try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) return null;

        const text = parsed.toString();
        const lower = text.toLowerCase();
        if (!/\.(jpe?g|png|webp)(?:[?#].*)?$/i.test(parsed.pathname) && !/(image|photo|listing|resize|cdn)/i.test(text)) {
            return null;
        }
        if (/(logo|favicon|sprite|icon|avatar|agent|profile|placeholder|loading|blank|captcha|challenge)/i.test(lower)) {
            return null;
        }

        return text;
    } catch {
        return null;
    }
}

function imagePriority(url = "") {
    const lower = url.toLowerCase();
    if (lower.includes("imaj.emlakjet.com")) return 100;
    if (lower.includes("i.remax.com.tr/photos")) return 95;
    if (lower.includes("hepsiemlak") && /(image|photo|listing|cdn)/i.test(lower)) return 90;
    if (/(listing|photos|photo|image|resize)/i.test(lower)) return 60;
    return 10;
}

function imageKey(url = "") {
    return String(url || "")
        .replace(/[?#].*$/, "")
        .replace(/\/resize\/\d+\/\d+\//i, "/resize/");
}

function uniqueImageCandidates(candidates = []) {
    const seen = new Set();
    return candidates
        .filter(Boolean)
        .sort((a, b) => imagePriority(b) - imagePriority(a))
        .filter((url) => {
            const key = imageKey(url);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function extractImageCandidates(html, baseUrl) {
    const candidates = [];

    const attrPattern = /\b(?:src|data-src|data-original|data-lazy|content)=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi;
    for (const match of html.matchAll(attrPattern)) {
        candidates.push(normalizeImageCandidate(match[1], baseUrl));
    }

    const srcsetPattern = /\bsrcset=["']([^"']+)["']/gi;
    for (const match of html.matchAll(srcsetPattern)) {
        for (const part of match[1].split(",")) {
            candidates.push(normalizeImageCandidate(part.trim().split(/\s+/)[0], baseUrl));
        }
    }

    const urlPattern = /https?:\\?\/\\?\/[^"'()<>\s]+\.(?:jpe?g|png|webp)(?:\?[^"'()<>\s\\]*)?/gi;
    for (const match of html.matchAll(urlPattern)) {
        candidates.push(normalizeImageCandidate(match[0], baseUrl));
    }

    return uniqueImageCandidates(candidates);
}

function collectJsonLdNodes(value, nodes = []) {
    if (!value || typeof value !== "object") return nodes;
    nodes.push(value);
    if (Array.isArray(value)) {
        value.forEach((item) => collectJsonLdNodes(item, nodes));
    } else {
        Object.values(value).forEach((item) => collectJsonLdNodes(item, nodes));
    }
    return nodes;
}

function firstImageFromValue(value) {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(firstImageFromValue).find(Boolean) || null;
    if (typeof value === "object") return value.url || value.contentUrl || value.thumbnailUrl || null;
    return null;
}

function parseJsonLd(html) {
    const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    const out = { imageUrl: null, area: null, roomText: null };

    for (const script of scripts) {
        try {
            const data = JSON.parse(decodeHtml(script[1]).trim());
            const nodes = collectJsonLdNodes(data);

            for (const node of nodes) {
                if (!out.imageUrl) {
                    out.imageUrl = firstImageFromValue(node.image || node.photo || node.primaryImageOfPage);
                }

                if (!out.area && node.floorSize) {
                    const floorSize = Array.isArray(node.floorSize) ? node.floorSize[0] : node.floorSize;
                    out.area = normalizeNumber(floorSize?.value || floorSize);
                }

                if (!out.roomText && (node.numberOfRooms || node.numberOfBedrooms)) {
                    out.roomText = String(node.numberOfRooms || node.numberOfBedrooms);
                }
            }
        } catch {
            // Some listing pages ship invalid or HTML-escaped JSON-LD. Ignore and continue.
        }
    }

    if (out.area) out.area = Math.round(out.area);
    return out;
}

function isPrivateIp(address) {
    if (!address) return true;

    if (net.isIPv4(address)) {
        const [a, b] = address.split(".").map(Number);
        return (
            a === 10 ||
            a === 127 ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 169 && b === 254) ||
            a === 0
        );
    }

    if (net.isIPv6(address)) {
        const text = address.toLowerCase();
        return text === "::1" || text.startsWith("fc") || text.startsWith("fd") || text.startsWith("fe80:");
    }

    return true;
}

async function assertPublicHttpUrl(sourceUrl) {
    let url;
    try {
        url = new URL(sourceUrl);
    } catch {
        return null;
    }

    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".local")) return null;

    if (net.isIP(url.hostname)) {
        if (isPrivateIp(url.hostname)) return null;
        return url;
    }

    const records = await dns.lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
    if (!records.length || records.some((record) => isPrivateIp(record.address))) return null;

    return url;
}

async function fetchLimitedHtml(sourceUrl) {
    const url = await assertPublicHttpUrl(sourceUrl);
    if (!url) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            cache: "no-store",
            redirect: "follow",
            signal: controller.signal,
            headers: {
                accept: "text/html,application/xhtml+xml",
                "user-agent":
                    "Mozilla/5.0 (compatible; EmlakEndeksComparableEnricher/1.0; +https://emlakendeks.app)",
            },
        });

        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !contentType.includes("text/html")) return null;

        const reader = response.body?.getReader();
        if (!reader) return await response.text();

        const chunks = [];
        let received = 0;
        while (received < MAX_HTML_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.byteLength;
        }

        return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

function googleMapsKey() {
    return  "";
}

function googleImageSearchConfig() {
    return {
        key: "",
        cx: "",
    };
}

function serpApiKey() {
    return process.env.SERPAPI_KEY || "";
}

function locationForStreetView(item, subjectLocation = {}) {
    if (item?.latitude && item?.longitude) return `${item.latitude},${item.longitude}`;

    const address = [
        item?.address,
        subjectLocation?.neighborhood,
        subjectLocation?.district,
        subjectLocation?.city,
        "Türkiye",
    ]
        .map(toText)
        .filter(Boolean)
        .filter((value, index, arr) => arr.indexOf(value) === index)
        .join(", ");

    return address || null;
}

function buildStreetViewUrl(item, subjectLocation, baseUrl) {
    const key = googleMapsKey();
    const location = locationForStreetView(item, subjectLocation);
    if (!key || !location || !baseUrl) return null;

    const params = new URLSearchParams({
        size: "640x360",
        location,
        fov: "80",
        pitch: "0",
        source: "outdoor",
    });

    return `${baseUrl}/comparables/street-view?${params.toString()}`;
}

async function enrichComparable(item, subjectLocation, baseUrl) {
    if (isCompleteForEnrichment(item, subjectLocation)) {
        return {
            item: { ...item },
            imageCandidates: uniqueImageCandidates([item.imageUrl]),
        };
    }

    const patch = {};
    const snippets = [item?.title, item?.snippet, item?.description].filter(Boolean);
    let htmlText = "";
    let imageCandidates = [];

    if (item?.sourceUrl) {
        const html = await fetchLimitedHtml(item.sourceUrl);

        if (html) {
            const jsonLd = parseJsonLd(html);
            imageCandidates = extractImageCandidates(html, item.sourceUrl);
            const metaImage =
                findMetaContent(html, "og:image:secure_url") ||
                findMetaContent(html, "og:image") ||
                findMetaContent(html, "twitter:image");
            const metaDescription = findMetaContent(html, "description") || findMetaContent(html, "og:description");
            htmlText = stripHtml(html).slice(0, 120000);

            if (!item.imageUrl) {
                const imageUrl =
                    absoluteUrl(metaImage || jsonLd.imageUrl, item.sourceUrl) ||
                    imageCandidates[0] ||
                    null;
                if (imageUrl) {
                    patch.imageUrl = imageUrl;
                    patch.imageSource = metaImage ? "og:image" : jsonLd.imageUrl ? "json-ld" : "page-image";
                }
            }

            const area = extractArea(...snippets, metaDescription, htmlText) || jsonLd.area;
            if (area && !item.netArea && !item.grossArea) patch.grossArea = area;

            const roomText = extractRoomText(...snippets, metaDescription, htmlText) || jsonLd.roomText;
            if (roomText && !item.roomText) patch.roomText = roomText;
        }
    }

    if (!(patch.imageUrl || item.imageUrl)) {
        const streetViewUrl = buildStreetViewUrl(item, subjectLocation, baseUrl);
        if (streetViewUrl) {
            patch.imageUrl = streetViewUrl;
            patch.imageSource = "google-street-view";
            patch.imageAttribution = "Google Maps";
        }
    }

    const fallbackArea = extractArea(...snippets, htmlText);
    if (fallbackArea && !patch.grossArea && !item.netArea && !item.grossArea) patch.grossArea = fallbackArea;

    return {
        item: { ...item, ...patch },
        imageCandidates: uniqueImageCandidates([patch.imageUrl, item.imageUrl, ...imageCandidates]),
    };
}

function subjectSearchText(subjectLocation = {}) {
    return [
        subjectLocation?.neighborhood,
        subjectLocation?.district,
        subjectLocation?.city,
    ]
        .map(toText)
        .filter(Boolean)
        .join(" ");
}

function uniqueTexts(values = []) {
    const seen = new Set();
    return values
        .map(toText)
        .filter(Boolean)
        .filter((value) => {
            const key = value.toLocaleLowerCase("tr-TR");
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

async function collectGoogleImagePool(comparables, subjectLocation) {
    const { key, cx } = googleImageSearchConfig();
    if (!key || !cx) return [];

    const locationText = subjectSearchText(subjectLocation);
    const propertyText = comparableSearchText(subjectLocation) || "ilan";
    const firstTitles = comparables
        .slice(0, 6)
        .map((item) => item?.title)
        .filter(Boolean);
    const queries = uniqueTexts([
        `${locationText} satılık ${propertyText} ilan fotoğraf`,
        ...firstTitles.map((title) => `${title} ilan fotoğraf`),
    ]).slice(0, 3);

    const pool = [];
    for (const query of queries) {
        const params = new URLSearchParams({
            key,
            cx,
            q: query,
            searchType: "image",
            safe: "active",
            num: "10",
            imgSize: "large",
        });

        const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`, {
            cache: "no-store",
        }).catch(() => null);
        if (!response?.ok) continue;

        const data = await response.json().catch(() => null);
        for (const item of data?.items || []) {
            pool.push(normalizeImageCandidate(item?.link, "https://www.google.com"));
        }
    }

    return uniqueImageCandidates(pool);
}

async function collectSerpApiImagePool(comparables, subjectLocation) {
    const apiKey = serpApiKey();
    if (!apiKey) return [];

    const locationText = subjectSearchText(subjectLocation);
    const propertyText = comparableSearchText(subjectLocation) || "ilan";
    const firstTitles = comparables
        .slice(0, 5)
        .map((item) => item?.title)
        .filter(Boolean);
    const queries = uniqueTexts([
        `${locationText} satılık ${propertyText} ilan fotoğraf sahibinden hepsiemlak emlakjet`,
        `${locationText} ${propertyText} emlak ilan görselleri`,
        ...firstTitles.map((title) => `${title} ilan fotoğraf`),
    ]).slice(0, 4);

    console.log("[IMAGE_ENRICHMENT] serpapi image search start", {
        queries: queries.length,
        locationText,
        propertyText,
    });

    const settled = await Promise.allSettled(
        queries.map(async (query) => {
            const params = new URLSearchParams({
                engine: "google_images",
                q: query,
                hl: "tr",
                gl: "tr",
                safe: "active",
                api_key: apiKey,
            });

            const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
                headers: { accept: "application/json" },
                cache: "no-store",
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(`SerpAPI görsel araması cevap vermedi (${response.status}): ${JSON.stringify(data).slice(0, 200)}`);
            }

            return {
                query,
                items: Array.isArray(data?.images_results) ? data.images_results : [],
            };
        })
    );

    const pool = [];
    settled.forEach((result, index) => {
        const query = queries[index];
        if (result.status === "rejected") {
            console.warn("[IMAGE_ENRICHMENT] serpapi image search failed", {
                query,
                message: String(result.reason?.message || result.reason),
            });
            return;
        }

        console.log("[IMAGE_ENRICHMENT] serpapi image search success", {
            query: result.value.query,
            count: result.value.items.length,
        });

        for (const item of result.value.items) {
            pool.push(normalizeImageCandidate(item?.original, "https://www.google.com"));
            pool.push(normalizeImageCandidate(item?.thumbnail, "https://www.google.com"));
        }
    });

    const unique = uniqueImageCandidates(pool);
    console.log("[IMAGE_ENRICHMENT] serpapi image pool", {
        count: unique.length,
    });
    return unique;
}

function buildMockImageUrl(item, index, baseUrl) {
    if (!baseUrl) return null;

    const params = new URLSearchParams({
        title: item?.roomText || item?.title || "Emsal",
        location: item?.address || "",
        variant: String((index % 3) + 1),
    });

    return `${baseUrl}/comparables/mock-image?${params.toString()}`;
}

function fillMissingImages(results, extraImagePool = [], baseUrl) {
    const rows = results.map((result) => result.item);
    const used = new Set(rows.map((item) => item.imageUrl).filter(Boolean).map(imageKey));
    const pool = uniqueImageCandidates([
        ...results.flatMap((result) => result.imageCandidates || []),
        ...extraImagePool,
    ]).filter((url) => !used.has(imageKey(url)));

    const targetRealCount = Math.min(rows.length, Math.max(0, rows.length - REAL_IMAGE_RESERVE_FOR_MOCKS));
    let realCount = rows.filter((item) => item.imageUrl && item.imageSource !== "brand-mock").length;
    let assignedPoolImageCount = 0;

    for (const row of rows) {
        if (row.imageUrl || realCount >= targetRealCount) continue;
        const nextImage = pool.shift();
        if (!nextImage) break;

        row.imageUrl = nextImage;
        row.imageSource = "nearby-listing-pool";
        realCount += 1;
        assignedPoolImageCount += 1;
        used.add(imageKey(nextImage));
    }

    let mockCount = 0;
    rows.forEach((row, index) => {
        if (row.imageUrl) return;

        const mockUrl = buildMockImageUrl(row, index, baseUrl);
        if (!mockUrl) return;

        row.imageUrl = mockUrl;
        row.imageSource = "brand-mock";
        row.imageAttribution = "EmlakSkor";
        mockCount += 1;
    });

    return {
        rows,
        realImageCount: realCount,
        mockImageCount: mockCount,
        assignedPoolImageCount,
        pooledImageCount: pool.length,
    };
}

function hasComparableArea(item) {
    return Number.isFinite(Number(item?.netArea)) || Number.isFinite(Number(item?.grossArea));
}

function isCompleteForEnrichment(item = {}, subjectLocation = {}) {
    if (!item.imageUrl || !hasComparableArea(item)) return false;
    if (propertyCategory(subjectLocation) !== "residential") return true;
    return Boolean(toText(item.roomText));
}

function buildAreaCoverage(beforeRows = [], afterRows = []) {
    const beforeByKey = new Map(
        beforeRows.map((item, index) => [item?.externalId || item?.sourceUrl || String(index), hasComparableArea(item)])
    );
    const bySource = {};

    let areaCount = 0;
    let enrichedAreaCount = 0;

    afterRows.forEach((item, index) => {
        const hasArea = hasComparableArea(item);
        const key = item?.externalId || item?.sourceUrl || String(index);
        const source = item?.source || item?.provider || "Bilinmeyen";

        if (!bySource[source]) bySource[source] = { total: 0, areaCount: 0 };
        bySource[source].total += 1;

        if (hasArea) {
            areaCount += 1;
            bySource[source].areaCount += 1;
        }

        if (hasArea && beforeByKey.get(key) === false) {
            enrichedAreaCount += 1;
        }
    });

    return {
        areaCount,
        missingAreaCount: Math.max(0, afterRows.length - areaCount),
        enrichedAreaCount,
        areaCoveragePct: afterRows.length ? Math.round((areaCount / afterRows.length) * 100) : 0,
        bySource,
    };
}

export async function enrichComparableImages(comparables = [], { subjectLocation = {}, baseUrl = "" } = {}) {
    const rows = Array.isArray(comparables) ? comparables.slice(0, MAX_COMPARABLES) : [];
    if (!rows.length) {
        return {
            comparables: rows,
            sourceMeta: {
                provider: "PAGE_ENRICHMENT",
                recordCount: 0,
                hasStreetViewFallback: !!googleMapsKey(),
                hasGoogleImageFallback: !!(googleImageSearchConfig().key && googleImageSearchConfig().cx),
                hasSerpApiImageFallback: !!serpApiKey(),
                realImageCount: 0,
                mockImageCount: 0,
                assignedPoolImageCount: 0,
                pooledImageCount: 0,
                serpApiImagePoolCount: 0,
                areaCount: 0,
                missingAreaCount: 0,
                enrichedAreaCount: 0,
                areaCoveragePct: 0,
                areaCoverageBySource: {},
            },
        };
    }

    const enrichedResults = await Promise.all(rows.map((item) => enrichComparable(item || {}, subjectLocation, baseUrl)));
    const missingImageCount = enrichedResults.filter((result) => !result.item?.imageUrl).length;
    const [googleImagePool, serpApiImagePool] = missingImageCount > 0
        ? await Promise.all([
              collectGoogleImagePool(rows, subjectLocation),
              collectSerpApiImagePool(rows, subjectLocation),
          ])
        : [[], []];
    const filled = fillMissingImages(enrichedResults, [...googleImagePool, ...serpApiImagePool], baseUrl);
    const areaCoverage = buildAreaCoverage(rows, filled.rows);

    return {
        comparables: filled.rows,
        sourceMeta: {
            provider: "PAGE_ENRICHMENT",
            recordCount: filled.rows.length,
            hasStreetViewFallback: !!googleMapsKey(),
            hasGoogleImageFallback: !!(googleImageSearchConfig().key && googleImageSearchConfig().cx),
            hasSerpApiImageFallback: !!serpApiKey(),
            realImageCount: filled.realImageCount,
            mockImageCount: filled.mockImageCount,
            assignedPoolImageCount: filled.assignedPoolImageCount,
            pooledImageCount: filled.pooledImageCount,
            serpApiImagePoolCount: serpApiImagePool.length,
            areaCount: areaCoverage.areaCount,
            missingAreaCount: areaCoverage.missingAreaCount,
            enrichedAreaCount: areaCoverage.enrichedAreaCount,
            areaCoveragePct: areaCoverage.areaCoveragePct,
            areaCoverageBySource: areaCoverage.bySource,
        },
    };
}
