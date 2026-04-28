function cleanString(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function canonicalText(value) {
    return cleanString(value)
        .toLocaleLowerCase("tr-TR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function sanitizeListingUrl(value) {
    const text = cleanString(value);
    if (!text) return "";

    try {
        const parsed = new URL(text);
        parsed.hash = "";
        parsed.search = "";
        parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
        return parsed.toString().replace(/\/$/, "");
    } catch {
        return text.split("#")[0].split("?")[0].replace(/\/$/, "");
    }
}

function sourceExternalKey(item) {
    if (!item?.source || !item?.externalId) return null;
    return `external:${String(item.source).toUpperCase()}:${String(item.externalId).trim()}`;
}

function fuzzyKey(item) {
    const title = canonicalText(item?.title);
    const price = Number.isFinite(Number(item?.price)) ? Math.round(Number(item.price) / 1000) * 1000 : "";
    const district = canonicalText(item?.district);
    const grossM2 = Number.isFinite(Number(item?.grossM2)) ? Math.round(Number(item.grossM2)) : "";
    if (!title || !price || !district || !grossM2) return null;
    return `fuzzy:${title.slice(0, 80)}:${price}:${district}:${grossM2}`;
}

function qualityScore(item) {
    const missingCount = Array.isArray(item?.missingFields) ? item.missingFields.length : 20;
    return (
        Number(item?.confidenceScore || 0) +
        (item?.imageStatus === "REAL" ? 50 : 0) +
        (item?.isManualVerified ? 20 : 0) -
        missingCount * 2
    );
}

export function dedupeComparableListings(items = []) {
    const result = [];
    const keyToIndex = new Map();

    for (const input of Array.isArray(items) ? items : []) {
        const item = {
            ...input,
            listingUrl: sanitizeListingUrl(input?.listingUrl || input?.link || input?.url),
        };

        const keys = [
            item.listingUrl ? `url:${item.listingUrl}` : null,
            sourceExternalKey(item),
            fuzzyKey(item),
        ].filter(Boolean);

        const existingIndex = keys.map((key) => keyToIndex.get(key)).find((index) => index !== undefined);

        if (existingIndex === undefined) {
            const nextIndex = result.length;
            result.push(item);
            keys.forEach((key) => keyToIndex.set(key, nextIndex));
            continue;
        }

        if (qualityScore(item) > qualityScore(result[existingIndex])) {
            result[existingIndex] = item;
        }

        keys.forEach((key) => keyToIndex.set(key, existingIndex));
    }

    return result;
}

export default dedupeComparableListings;

