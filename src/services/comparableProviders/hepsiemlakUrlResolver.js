import { comparableSearchText, propertyCategory, valuationType } from "../propertyCategory.js";

const HEPSIEMLAK_BASE_URL = "https://www.hepsiemlak.com";

function asciiTurkish(value) {
    return String(value || "")
        .replace(/İ/g, "i")
        .replace(/I/g, "i")
        .replace(/ı/g, "i")
        .replace(/ğ/g, "g")
        .replace(/Ğ/g, "g")
        .replace(/ü/g, "u")
        .replace(/Ü/g, "u")
        .replace(/ş/g, "s")
        .replace(/Ş/g, "s")
        .replace(/ö/g, "o")
        .replace(/Ö/g, "o")
        .replace(/ç/g, "c")
        .replace(/Ç/g, "c");
}

function normalizeText(value) {
    return asciiTurkish(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[']/g, "")
        .replace(/&/g, " ve ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function slugify(value) {
    return normalizeText(value).replace(/\s+/g, "-");
}

function stripNeighborhoodSuffix(value) {
    return normalizeText(value)
        .replace(/\bmahallesi\b/g, "")
        .replace(/\bmahalle\b/g, "")
        .replace(/\bmah\b/g, "")
        .replace(/\bmh\b/g, "")
        .trim();
}

function slugifyNeighborhood(value) {
    return stripNeighborhoodSuffix(value).replace(/\s+/g, "-");
}

function uniq(values) {
    return [...new Set(values.filter(Boolean))];
}

function detectPathType(criteria = {}) {
    const category = propertyCategory(criteria);
    const text = normalizeText(`${criteria.reportType || ""} ${criteria.propertyType || ""}`);

    if (category === "land") return "arsa";
    if (category === "commercial") return "isyeri";

    if (text.includes("villa")) return "villa";
    if (text.includes("residence")) return "residence";
    if (text.includes("mustakil")) return "mustakil-ev";
    if (text.includes("dublex") || text.includes("dubleks")) return "dublex";
    if (text.includes("triplex") || text.includes("tripleks")) return "tripleks";

    return "daire";
}

function propertySearchText(criteria = {}) {
    const typeSlug = detectPathType(criteria);
    const transaction = valuationType(criteria) === "rental" ? "kiralık" : "satılık";

    if (typeSlug === "isyeri") return `${transaction} ${comparableSearchText(criteria)}`;
    if (typeSlug === "arsa") return `${transaction} ${comparableSearchText(criteria)}`;
    if (typeSlug === "villa") return `${transaction} villa`;
    if (typeSlug === "residence") return `${transaction} residence`;

    return `${transaction} daire`;
}

function withSort(url, sortField, sortDirection) {
    if (!sortField || !sortDirection) return url;

    const parsed = new URL(url);
    parsed.searchParams.set("sortField", sortField);
    parsed.searchParams.set("sortDirection", sortDirection);
    return parsed.toString();
}

function buildHepsiemlakCandidateUrls(criteria = {}, { sortField = null, sortDirection = null } = {}) {
    const citySlug = slugify(criteria.city);
    const districtSlug = slugify(criteria.district);
    const neighborhoodSlug = slugifyNeighborhood(criteria.neighborhood);
    const typeSlug = detectPathType(criteria);
    const transactionSlug = valuationType(criteria) === "rental" ? "kiralik" : "satilik";

    const paths = [];

    if (neighborhoodSlug) {
        paths.push(`/${neighborhoodSlug}-${transactionSlug}/${typeSlug}`);
        paths.push(`/${neighborhoodSlug}-${transactionSlug}`);
        paths.push(`/${neighborhoodSlug}/${typeSlug}`);

        if (districtSlug) {
            paths.push(`/${districtSlug}-${neighborhoodSlug}-${transactionSlug}/${typeSlug}`);
            paths.push(`/${districtSlug}-${neighborhoodSlug}-${transactionSlug}`);
            paths.push(`/${districtSlug}-${neighborhoodSlug}/${typeSlug}`);
        }
    }

    if (districtSlug) {
        paths.push(`/${districtSlug}-${transactionSlug}/${typeSlug}`);
        paths.push(`/${districtSlug}-${transactionSlug}`);
        paths.push(`/${districtSlug}/${typeSlug}`);
    }

    if (citySlug) {
        paths.push(`/${citySlug}-${transactionSlug}/${typeSlug}`);
        paths.push(`/${citySlug}-${transactionSlug}`);
        paths.push(`/${citySlug}/${typeSlug}`);
    }

    return uniq(paths).map((path) => withSort(`${HEPSIEMLAK_BASE_URL}${path}`, sortField, sortDirection));
}

function buildSerpQuery(criteria = {}) {
    return [
        "site:hepsiemlak.com",
        criteria.city,
        criteria.district,
        criteria.neighborhood,
        propertySearchText(criteria),
    ]
        .filter(Boolean)
        .join(" ");
}

function isUsefulHepsiemlakUrl(url) {
    const text = String(url || "").trim();

    if (!text.includes("hepsiemlak.com/")) return false;

    const lower = text.toLowerCase();

    if (lower.includes("/emlak-ofisi")) return false;
    if (lower.includes("/projeler")) return false;
    if (lower.includes("/emlak-yasam")) return false;
    if (lower.includes("/hakkimizda")) return false;
    if (lower.includes("/kullanim-kosullari")) return false;
    if (lower.includes("/gizlilik")) return false;

    return (
        lower.includes("satilik") ||
        lower.includes("kiralik") ||
        lower.includes("/daire") ||
        lower.includes("/arsa") ||
        lower.includes("/isyeri") ||
        lower.includes("/villa") ||
        lower.includes("/residence")
    );
}

function normalizeSerpUrl(url) {
    const text = String(url || "").trim();
    if (!text) return null;

    try {
        const parsed = new URL(text);
        parsed.hash = "";
        const keep = new URLSearchParams();
        for (const [key, value] of parsed.searchParams.entries()) {
            const lower = key.toLowerCase();
            if (lower.startsWith("utm_")) continue;
            if (["gclid", "fbclid", "yclid", "mc_cid", "mc_eid"].includes(lower)) continue;
            if (["sortfield", "sortdirection"].includes(lower)) keep.set(key, value);
        }
        parsed.search = keep.toString();
        return parsed.toString();
    } catch {
        return text;
    }
}

async function searchWithSerpApi(criteria = {}) {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) return [];

    const query = buildSerpQuery(criteria);
    const maxResults = Math.min(Number(process.env.SERPAPI_MAX_RESULTS || 10), 20);

    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", query);
    url.searchParams.set("hl", "tr");
    url.searchParams.set("gl", "tr");
    url.searchParams.set("num", String(maxResults));
    url.searchParams.set("api_key", apiKey);

    console.log("[HEPSIEMLAK_URL_RESOLVER] serpapi search", { query });

    const response = await fetch(url.toString(), {
        headers: { accept: "application/json" },
        cache: "no-store",
    });

    const json = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(`SerpAPI cevap vermedi (${response.status}): ${JSON.stringify(json).slice(0, 300)}`);
    }

    const organic = Array.isArray(json?.organic_results) ? json.organic_results : [];

    const links = organic
        .map((item) => normalizeSerpUrl(item?.link))
        .filter(isUsefulHepsiemlakUrl);

    console.log("[HEPSIEMLAK_URL_RESOLVER] serpapi result", {
        query,
        count: links.length,
        links: links.slice(0, 5),
    });

    return links;
}

async function searchSerpApiOrganic(query, options = {}) {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) return [];

    const maxResults = Math.min(Number(options.maxResults || process.env.SERPAPI_MAX_RESULTS || 10), 20);

    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", query);
    url.searchParams.set("hl", "tr");
    url.searchParams.set("gl", "tr");
    url.searchParams.set("num", String(maxResults));
    url.searchParams.set("api_key", apiKey);

    console.log("[SERPAPI] organic search", { query, maxResults });

    const response = await fetch(url.toString(), {
        headers: { accept: "application/json" },
        cache: "no-store",
    });

    const json = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(`SerpAPI cevap vermedi (${response.status}): ${JSON.stringify(json).slice(0, 300)}`);
    }

    return Array.isArray(json?.organic_results) ? json.organic_results : [];
}

async function resolveHepsiemlakUrls(criteria = {}, sortOptions = {}) {
    const mode = process.env.HEPSIEMLAK_URL_RESOLVER_MODE || "CANDIDATES_ONLY";
    const candidates = buildHepsiemlakCandidateUrls(criteria, sortOptions);

    if (mode !== "CANDIDATES_THEN_SERP") {
        return candidates;
    }

    try {
        const serpUrls = await searchWithSerpApi(criteria);

        const sortedSerpUrls = serpUrls.map((url) =>
            withSort(url, sortOptions.sortField, sortOptions.sortDirection)
        );

        return uniq([...sortedSerpUrls, ...candidates]);
    } catch (error) {
        console.warn("[HEPSIEMLAK_URL_RESOLVER] serp failed", {
            message: String(error.message || error),
        });

        return candidates;
    }
}

export {
    resolveHepsiemlakUrls,
    buildHepsiemlakCandidateUrls,
    buildSerpQuery,
    searchWithSerpApi,
    searchSerpApiOrganic,
    normalizeSerpUrl,
    isUsefulHepsiemlakUrl,
    withSort,
};
