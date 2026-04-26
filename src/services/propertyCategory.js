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

export function normalizePropertyText(value) {
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

export function propertyCategory(criteria = {}) {
    const reportType = normalizePropertyText(criteria.reportType);
    const propertyType = normalizePropertyText(criteria.propertyType);
    const text = `${reportType} ${propertyType}`.trim();

    if (reportType === "land" || reportType.includes("arsa") || text.includes("tarla")) return "land";
    if (reportType === "commercial" || reportType.includes("ticari") || reportType.includes("is yeri")) return "commercial";

    if (/\b(land|field|garden|arsa|arazi|tarla|bahce|bag|zeytinlik|imarli|imarsiz)\b/.test(text)) return "land";
    if (/\b(commercial|shop|office|warehouse|factory|hotel|ofis|buro|dukkan|magaza|depo|fabrika|plaza|otel|isyeri|is yeri|ticari|sanayi|atolye|imalathane|cafe|bar|restoran|lokanta|pizzaci|pastane|firin)\b/.test(text)) {
        return "commercial";
    }

    return "residential";
}

export function commercialSearchText(criteria = {}) {
    const text = normalizePropertyText(criteria.propertyType);
    if (/\b(office|ofis|buro)\b/.test(text)) return "ofis";
    if (/\b(warehouse|depo|antrepo)\b/.test(text)) return "depo";
    if (/\b(factory|fabrika|imalathane|atolye|sanayi)\b/.test(text)) return "fabrika";
    if (/\b(hotel|otel|pansiyon|apart otel)\b/.test(text)) return "otel";
    if (/\b(cafe|bar|restoran|lokanta|pizzaci|pastane|firin)\b/.test(text)) return "dükkan";
    if (/\b(plaza)\b/.test(text)) return "plaza katı";
    if (/\b(shop|dukkan|magaza|isyeri|is yeri|ticari)\b/.test(text)) return "dükkan";
    return "iş yeri";
}

export function landSearchText(criteria = {}) {
    const text = normalizePropertyText(criteria.propertyType);
    if (text.includes("tarla")) return "tarla";
    if (text.includes("ticari")) return "ticari arsa";
    if (text.includes("konut")) return "konut imarlı arsa";
    if (text.includes("bag") || text.includes("bahce")) return "bağ bahçe";
    return "arsa";
}

export function comparableSearchText(criteria = {}) {
    const category = propertyCategory(criteria);
    if (category === "land") return landSearchText(criteria);
    if (category === "commercial") return commercialSearchText(criteria);

    const text = normalizePropertyText(criteria.propertyType);
    if (text.includes("villa")) return "villa";
    if (text.includes("residence")) return "residence";
    if (text.includes("mustakil")) return "müstakil ev";
    if (text.includes("dublex") || text.includes("dubleks")) return "dubleks";
    if (text.includes("triplex") || text.includes("tripleks")) return "tripleks";
    return "daire";
}

export function categoryLabel(category) {
    if (category === "land") return "arsa";
    if (category === "commercial") return "ticari";
    return "konut";
}
