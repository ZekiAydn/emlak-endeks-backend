function cleanString(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
    return [...new Set(values.map(cleanString).filter(Boolean))];
}

function propertyTypeText(value) {
    const text = cleanString(value);
    return text || "daire";
}

export function buildComparableSearchQueries(criteria = {}) {
    const city = cleanString(criteria.city);
    const district = cleanString(criteria.district);
    const neighborhood = cleanString(criteria.neighborhood);
    const location = [city, district, neighborhood].filter(Boolean).join(" ");
    const propertyType = propertyTypeText(criteria.propertyType).toLocaleLowerCase("tr-TR");
    const searchText = cleanString(criteria.searchText || criteria.listingTitle || criteria.title);
    const addressText = cleanString(criteria.addressText);
    const roomText =
        Number.isInteger(Number(criteria.roomCount)) && Number.isInteger(Number(criteria.salonCount))
            ? `${Number(criteria.roomCount)}+${Number(criteria.salonCount)}`
            : "";
    const grossM2 = Number(criteria.grossM2);
    const areaText = Number.isFinite(grossM2) && grossM2 > 0 ? `${Math.round(grossM2)} m2` : "";
    const transaction = cleanString(criteria.listingType || criteria.transactionType || "satılık").toLocaleLowerCase("tr-TR");
    const base = [location, roomText, transaction, propertyType].filter(Boolean).join(" ");

    const areaVariants = Number.isFinite(grossM2) && grossM2 > 0
        ? unique([
            `${Math.max(1, Math.round(grossM2 - 10))} m2`,
            `${Math.round(grossM2)} m2`,
            `${Math.round(grossM2 + 10)} m2`,
        ])
        : [];

    const providerSites = [
        "site:hepsiemlak.com",
        "site:emlakjet.com",
        "site:remax.com.tr",
        "site:sahibinden.com",
    ];

    return unique([
        [location, transaction, propertyType, searchText, roomText].filter(Boolean).join(" "),
        [location, transaction, propertyType, addressText, roomText].filter(Boolean).join(" "),
        [base, areaText].filter(Boolean).join(" "),
        ...areaVariants.map((area) => [location, roomText, transaction, propertyType, area].filter(Boolean).join(" ")),
        ...providerSites.map((site) => [site, location, roomText, transaction, propertyType, searchText].filter(Boolean).join(" ")),
        [location, roomText, transaction, propertyType, "ilan fiyat"].filter(Boolean).join(" "),
    ]);
}

export default buildComparableSearchQueries;
