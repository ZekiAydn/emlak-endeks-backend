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

function flattenResult(item = {}, query = "") {
    const link = sanitizeListingUrl(item.link || item.redirect_link || item.url);
    if (!link) return null;

    return {
        title: cleanString(item.title),
        snippet: cleanString([
            item.snippet,
            item.rich_snippet?.top?.extensions?.join(" "),
            item.rich_snippet?.bottom?.extensions?.join(" "),
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
        this.apiKey = options.apiKey || process.env.SERPAPI_KEY;
        this.timeoutMs = Number(options.timeoutMs || process.env.SERPAPI_TIMEOUT_MS || 12000);
        this.maxResults = Math.min(Number(options.maxResults || process.env.SERPAPI_MAX_RESULTS || 10), 20);
        this.delayMs = Number(options.delayMs || process.env.SERPAPI_DELAY_MS || 300);
    }

    async searchOne(query) {
        if (!this.apiKey) {
            throw new Error("SERPAPI_KEY tanımlı değil.");
        }

        const url = new URL("https://serpapi.com/search.json");
        url.searchParams.set("engine", "google");
        url.searchParams.set("q", query);
        url.searchParams.set("hl", "tr");
        url.searchParams.set("gl", "tr");
        url.searchParams.set("num", String(this.maxResults));
        url.searchParams.set("api_key", this.apiKey);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(url.toString(), {
                headers: { accept: "application/json" },
                signal: controller.signal,
                cache: "no-store",
            });
            const json = await response.json().catch(() => null);

            if (!response.ok) {
                const message = json?.error || json?.message || `SerpAPI ${response.status} döndü.`;
                throw new Error(message);
            }

            return Array.isArray(json?.organic_results) ? json.organic_results : [];
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
                errors.push({ query, message: error.message || String(error) });
            }

            if (this.delayMs > 0) await sleep(this.delayMs);
        }

        return { results, errors };
    }
}

