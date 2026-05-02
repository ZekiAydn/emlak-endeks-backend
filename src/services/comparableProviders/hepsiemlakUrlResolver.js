import { propertyCategory, valuationType } from "../propertyCategory.js";

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

async function resolveHepsiemlakUrls(criteria = {}, sortOptions = {}) {
    return buildHepsiemlakCandidateUrls(criteria, sortOptions);
}

export {
    resolveHepsiemlakUrls,
    buildHepsiemlakCandidateUrls,
    isUsefulHepsiemlakUrl,
    withSort,
};
