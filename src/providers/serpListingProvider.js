import BaseListingProvider, { providerSourceFromUrl } from "./baseListingProvider.js";
import { sanitizeListingUrl } from "../helpers/dedupeComparableListings.js";

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanString(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function imageFromResult(item = {}) {
    return cleanString(
        item.thumbnail ||
        item.image ||
        item.rich_snippet?.top?.detected_extensions?.thumbnail ||
        item.inline_images?.[0]?.thumbnail ||
        item.inline_images?.[0]?.source
    );
}

function detectedExtensionsText(value, prefix = "") {
    if (!value || typeof value !== "object") return "";
    const parts = [];
    for (const [key, nested] of Object.entries(value)) {
        const label = prefix ? `${prefix}.${key}` : key;
        if (nested === null || nested === undefined) continue;
        if (["string", "number", "boolean"].includes(typeof nested)) {
            parts.push(`${label}: ${nested}`);
            continue;
        }
        if (Array.isArray(nested)) {
            const primitives = nested.filter((item) => ["string", "number", "boolean"].includes(typeof item));
            if (primitives.length) parts.push(`${label}: ${primitives.join(" ")}`);
            continue;
        }
        parts.push(detectedExtensionsText(nested, label));
    }
    return cleanString(parts.filter(Boolean).join(" "));
}

function flattenResult(item = {}, query = "") {
    const link = sanitizeListingUrl(item.link || item.redirect_link || item.url);
    if (!link) return null;

    const topDetected = detectedExtensionsText(item.rich_snippet?.top?.detected_extensions);
    const bottomDetected = detectedExtensionsText(item.rich_snippet?.bottom?.detected_extensions);

    return {
        title: cleanString(item.title),
        snippet: cleanString([
            item.snippet,
            item.rich_snippet?.top?.extensions?.join(" "),
            item.rich_snippet?.bottom?.extensions?.join(" "),
            topDetected,
            bottomDetected,
        ].filter(Boolean).join(" ")),
        link,
        displayed_link: cleanString(item.displayed_link),
        source: providerSourceFromUrl(link),
        imageUrl: imageFromResult(item) || null,
        raw: {
            query,
            serpapiPosition: item.position ?? null,
            displayed_link: item.displayed_link ?? null,
            link: item.link ?? null,
            title: item.title ?? null,
            snippet: item.snippet ?? null,
            thumbnail: item.thumbnail ?? null,
        },
    };
}

export default class SerpListingProvider extends BaseListingProvider {
    constructor(options = {}) {
        super(options);
        this.apiKey = options.apiKey || process.env.SERPER_API_KEY;
        this.timeoutMs = Number(options.timeoutMs || process.env.SERPER_TIMEOUT_MS || 12000);
        this.maxResults = Math.min(Number(options.maxResults || process.env.SERPER_MAX_RESULTS || 10), 20);
        this.delayMs = Number(options.delayMs || process.env.SERPER_DELAY_MS || 300);
    }

    async searchOne(query) {
        if (!this.apiKey) {
            throw new Error("SERPER_API_KEY tanımlı değil.");
        }

        const requestOptions = {
            method: "POST",
            headers: {
                "X-API-KEY": this.apiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                q: query,
                gl: "tr",
                hl: "tr",
                num: this.maxResults
            }),
            redirect: "follow",
            cache: "no-store",
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch("https://google.serper.dev/search", {
                ...requestOptions,
                signal: controller.signal,
            });
            const json = await response.json().catch(() => null);

            if (!response.ok) {
                const message = json?.error || json?.message || `Serper.dev ${response.status} döndü.`;
                throw new Error(message);
            }

            return Array.isArray(json?.organic) ? json.organic : [];
        } finally {
            clearTimeout(timeout);
        }
    }

    async search(queries = []) {
        const uniqueQueries = [...new Set((Array.isArray(queries) ? queries : [queries]).map(cleanString).filter(Boolean))];
        const seenUrls = new Set();
        const results = [];
        const errors = [];

        for (const query of uniqueQueries) {
            try {
                const organic = await this.searchOne(query);
                for (const item of organic) {
                    const flattened = flattenResult(item, query);
                    if (!flattened?.link || seenUrls.has(flattened.link)) continue;
                    seenUrls.add(flattened.link);
                    results.push(flattened);
                }
            } catch (error) {
                const message = error.message || String(error);
                errors.push({ query, message });
                if (/invalid api key|api key|unauthorized|forbidden/i.test(message)) break;
            }

            if (this.delayMs > 0) await sleep(this.delayMs);
        }

        return { results, errors };
    }
}
