function cleanString(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function quote(value) {
    const text = cleanString(value);
    return text ? `"${text}"` : "";
}

function unique(values) {
    const seen = new Set();
    const out = [];
    for (const value of values.map(cleanString).filter(Boolean)) {
        const key = value.toLocaleLowerCase("tr-TR");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(value);
    }
    return out;
}

function listingPhrase(input = {}) {
    const reportType = cleanString(input.reportType).toUpperCase();
    const listingType = cleanString(input.listingType || input.valuationType).toLocaleLowerCase("tr-TR");
    const transaction = /rent|rental|kira|kiralık|kiralik/.test(`${reportType} ${listingType}`)
        ? "kiralık"
        : "satılık";
    const propertyType = cleanString(input.propertyType).toLocaleLowerCase("tr-TR");
    if (propertyType.includes("villa")) return `${transaction} villa`;
    if (propertyType.includes("arsa") || propertyType.includes("land")) return `${transaction} arsa`;
    if (propertyType.includes("ofis") || propertyType.includes("commercial")) return `${transaction} iş yeri`;
    return `${transaction} daire`;
}

function areaText(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? `${Math.round(number)} m2` : "";
}

function nearbyNeighborhoodQueries(input, phrase) {
    const nearby = Array.isArray(input.nearbyNeighborhoods) ? input.nearbyNeighborhoods : [];
    return nearby
        .map(cleanString)
        .filter(Boolean)
        .flatMap((name) => [
            [quote(input.city), quote(input.district), quote(name), quote(input.roomText), quote(phrase)].filter(Boolean).join(" "),
            [quote(name), quote(input.roomText), quote(phrase)].filter(Boolean).join(" "),
        ]);
}

export function generateComparableDiscoveryQueries(input = {}) {
    const city = cleanString(input.city);
    const district = cleanString(input.district);
    const neighborhood = cleanString(input.neighborhood);
    const compoundName = cleanString(input.compoundName);
    const roomText = cleanString(input.roomText);
    const phrase = listingPhrase(input);
    const subjectAreaText = areaText(input.subjectArea);
    const maxQueries = Math.max(1, Number(input.maxQueries || process.env.COMPARABLE_DISCOVERY_MAX_QUERIES || 60));

    const levelQueries = [
        compoundName && [quote(compoundName), quote(district), quote(roomText), quote(phrase)].filter(Boolean).join(" "),
        compoundName && [quote(compoundName), quote(neighborhood), quote(phrase)].filter(Boolean).join(" "),
        compoundName && [quote(compoundName), quote(city), quote(district)].filter(Boolean).join(" "),
        compoundName && [quote(compoundName), quote(roomText), quote(phrase)].filter(Boolean).join(" "),

        [quote(city), quote(district), quote(neighborhood), quote(roomText), quote(phrase)].filter(Boolean).join(" "),
        [quote(district), quote(neighborhood), quote(roomText), quote(phrase)].filter(Boolean).join(" "),
        [quote(`${neighborhood} Mahallesi`), quote(roomText), quote(phrase)].filter(Boolean).join(" "),

        [quote(city), quote(district), quote(neighborhood), quote(phrase)].filter(Boolean).join(" "),
        [quote(district), quote(neighborhood), quote(phrase)].filter(Boolean).join(" "),
        [quote(neighborhood), quote(phrase)].filter(Boolean).join(" "),

        [quote(city), quote(district), quote(roomText), quote(phrase)].filter(Boolean).join(" "),
        [quote(district), quote(roomText), quote(subjectAreaText), quote(phrase)].filter(Boolean).join(" "),
        [quote(district), quote(roomText), quote(phrase)].filter(Boolean).join(" "),

        ...nearbyNeighborhoodQueries(input, phrase),

        [quote(city), quote(district), quote(phrase)].filter(Boolean).join(" "),
        [quote(district), quote(phrase)].filter(Boolean).join(" "),
    ];

    const sites = [
        "sahibinden.com",
        "hepsiemlak.com",
        "emlakjet.com",
        "remax.com.tr",
    ];

    const baseQueries = unique(levelQueries);
    const siteQueries = sites.flatMap((site) => baseQueries.map((query) => `site:${site} ${query}`));
    return unique(siteQueries).slice(0, maxQueries);
}

export default generateComparableDiscoveryQueries;
