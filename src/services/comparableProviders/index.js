const { fetchRemaxProviderBundle } = require("./remaxProvider");
const { fetchHepsiemlakHtmlComparableBundle } = require("./hepsiemlakHtmlProvider");

const PROVIDERS = {
    HEPSIEMLAK_HTML: {
        name: "HEPSIEMLAK_HTML",
        fetch: fetchHepsiemlakHtmlComparableBundle,
    },
    REMAX: {
        name: "REMAX",
        fetch: fetchRemaxProviderBundle,
    },
};

function selectedProviders() {
    const raw = process.env.COMPARABLE_PROVIDERS || "HEPSIEMLAK_HTML,REMAX";

    return raw
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
        .map((key) => PROVIDERS[key])
        .filter(Boolean);
}

async function fetchComparableBundle(criteria = {}, options = {}) {
    const warnings = [];
    const providers = selectedProviders();

    for (const provider of providers) {
        try {
            console.log("[COMPARABLES] provider start", {
                provider: provider.name,
                city: criteria.city,
                district: criteria.district,
                neighborhood: criteria.neighborhood,
                reportType: criteria.reportType,
                propertyType: criteria.propertyType,
            });

            const bundle = await provider.fetch(criteria, options);
            const count = Array.isArray(bundle?.comparables) ? bundle.comparables.length : 0;

            if (count > 0) {
                console.log("[COMPARABLES] provider success", {
                    provider: provider.name,
                    count,
                });

                return {
                    ...bundle,
                    warnings,
                    sourceMeta: {
                        ...(bundle.sourceMeta || {}),
                        provider: bundle.sourceMeta?.provider || provider.name,
                    },
                };
            }

            const message = `${provider.name}: emsal bulunamadı`;
            warnings.push(message);

            console.warn("[COMPARABLES] provider empty", {
                provider: provider.name,
            });
        } catch (error) {
            const message = `${provider.name}: ${String(error.message || error)}`;
            warnings.push(message);

            console.error("[COMPARABLES] provider failed", {
                provider: provider.name,
                message: String(error.message || error),
            });
        }
    }

    return {
        comparables: [],
        groups: {},
        marketProjection: null,
        regionalStats: null,
        priceBand: null,
        sourceMeta: {
            provider: "NONE",
            fetchedAt: new Date().toISOString(),
            sampleCount: 0,
            recordCount: 0,
        },
        warnings,
    };
}

module.exports = {
    fetchComparableBundle,
};