import { fetchRemaxComparableBundle } from "../remaxComparables.js";

async function fetchRemaxProviderBundle(criteria = {}, options = {}) {
    const bundle = await fetchRemaxComparableBundle(criteria, options);

    if (!bundle) return null;

    return {
        ...bundle,
        sourceMeta: {
            ...(bundle.sourceMeta || {}),
            provider: "REMAX",
        },
    };
}

export {
    fetchRemaxProviderBundle,
};
