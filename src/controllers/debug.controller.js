import {
    buildHepsiemlakCandidateUrls,
    buildSerpQuery,
    resolveHepsiemlakUrls,
    searchWithSerpApi,
} from "../services/comparableProviders/hepsiemlakUrlResolver.js";
import {
    fetchHtml,
    parseSearchPage,
} from "../services/comparableProviders/hepsiemlakHtmlProvider.js";
import { fetchComparableBundle } from "../services/comparableProviders/index.js";

function debugEnabledMiddleware(req, res, next) {
    if (process.env.DEBUG_ENDPOINTS_ENABLED !== "true") {
        return res.status(404).json({ error: "Not found" });
    }

    return next();
}

function criteriaFromQuery(query = {}) {
    return {
        city: String(query.city || "").trim(),
        district: String(query.district || "").trim(),
        neighborhood: String(query.neighborhood || "").trim(),
        reportType: String(query.reportType || "").trim(),
        propertyType: String(query.propertyType || "").trim(),
    };
}

function debugEnv() {
    return {
        comparableProviders: process.env.COMPARABLE_PROVIDERS || "HEPSIEMLAK_HTML,REMAX",
        resolverMode: process.env.HEPSIEMLAK_URL_RESOLVER_MODE || "CANDIDATES_ONLY",
        hasSerpApiKey: Boolean(process.env.SERPAPI_KEY),
        hepsiemlakMaxItems: process.env.HEPSIEMLAK_MAX_ITEMS || null,
        hepsiemlakTimeoutMs: process.env.HEPSIEMLAK_TIMEOUT_MS || null,
        nodeEnv: process.env.NODE_ENV || null,
        railwayEnvironment:
            process.env.RAILWAY_ENVIRONMENT ||
            process.env.RAILWAY_ENVIRONMENT_NAME ||
            process.env.RAILWAY_SERVICE_NAME ||
            null,
    };
}

function sortOptions(kind) {
    if (kind === "low") return { sortField: "PRICE", sortDirection: "ASC" };
    if (kind === "high") return { sortField: "PRICE", sortDirection: "DESC" };
    return {};
}

async function trySerp(criteria) {
    if (!process.env.SERPAPI_KEY) return { serpUrls: [], serpError: null };

    try {
        return {
            serpUrls: await searchWithSerpApi(criteria),
            serpError: null,
        };
    } catch (error) {
        return {
            serpUrls: [],
            serpError: String(error.message || error),
        };
    }
}

export const debugEnabled = debugEnabledMiddleware;

export const resolveComparables = async (req, res) => {
    const criteria = criteriaFromQuery(req.query);
    const candidatesDefault = buildHepsiemlakCandidateUrls(criteria);
    const candidatesLow = buildHepsiemlakCandidateUrls(criteria, sortOptions("low"));
    const candidatesHigh = buildHepsiemlakCandidateUrls(criteria, sortOptions("high"));
    const serpQuery = buildSerpQuery(criteria);
    const { serpUrls, serpError } = await trySerp(criteria);
    const mergedUrlsDefault = await resolveHepsiemlakUrls(criteria);

    res.json({
        ok: true,
        criteria,
        env: debugEnv(),
        candidatesDefault,
        candidatesLow,
        candidatesHigh,
        serpQuery,
        serpUrls,
        ...(serpError ? { serpError } : {}),
        mergedUrlsDefault,
    });
};

export const fetchComparables = async (req, res) => {
    const criteria = criteriaFromQuery(req.query);
    const defaultUrls = await resolveHepsiemlakUrls(criteria);
    const lowUrls = buildHepsiemlakCandidateUrls(criteria, sortOptions("low"));
    const highUrls = buildHepsiemlakCandidateUrls(criteria, sortOptions("high"));
    const urls = [
        ...defaultUrls.map((url) => ({ kind: "default", url })),
        ...lowUrls.map((url) => ({ kind: "low", url })),
        ...highUrls.map((url) => ({ kind: "high", url })),
    ];
    const seen = new Set();
    const firstFive = urls.filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
    }).slice(0, 5);

    const results = [];

    for (const item of firstFive) {
        try {
            const fetched = await fetchHtml(item.url, { includeMeta: true });
            const parsed = parseSearchPage(item.url, fetched.html, criteria, { includeDiagnostics: true });

            results.push({
                kind: item.kind,
                url: item.url,
                status: fetched.status,
                ok: fetched.ok,
                contentType: fetched.contentType,
                htmlLength: fetched.htmlLength,
                title: parsed.title,
                cardsCount: parsed.cardsCount,
                comparablesCount: parsed.comparables.length,
                firstComparable: parsed.comparables[0] || null,
                error: null,
                bodyStart: fetched.bodyStart,
            });
        } catch (error) {
            const fetchResult = error.fetchResult || {};
            let parsed = null;
            if (fetchResult.html) {
                parsed = parseSearchPage(item.url, fetchResult.html, criteria, { includeDiagnostics: true });
            }

            results.push({
                kind: item.kind,
                url: item.url,
                status: fetchResult.status || null,
                ok: fetchResult.ok || false,
                contentType: fetchResult.contentType || null,
                htmlLength: fetchResult.htmlLength || 0,
                title: parsed?.title || null,
                cardsCount: parsed?.cardsCount || 0,
                comparablesCount: parsed?.comparables?.length || 0,
                firstComparable: parsed?.comparables?.[0] || null,
                error: String(error.message || error),
                bodyStart: fetchResult.bodyStart || null,
            });
        }
    }

    res.json({
        ok: true,
        criteria,
        env: debugEnv(),
        urls: {
            default: defaultUrls,
            low: lowUrls,
            high: highUrls,
        },
        results,
    });
};

export const runComparables = async (req, res) => {
    const criteria = criteriaFromQuery(req.query);
    const bundle = await fetchComparableBundle(criteria, {});
    const comparables = Array.isArray(bundle?.comparables) ? bundle.comparables : [];

    res.json({
        ok: true,
        criteria,
        comparablesCount: comparables.length,
        firstComparables: comparables.slice(0, 3),
        groups: bundle?.groups || {},
        sourceMeta: bundle?.sourceMeta || null,
        warnings: Array.isArray(bundle?.warnings) ? bundle.warnings : [],
        priceBand: bundle?.priceBand || null,
        marketProjection: bundle?.marketProjection || null,
        regionalStats: bundle?.regionalStats || null,
    });
};
