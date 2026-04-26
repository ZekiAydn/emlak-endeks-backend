const NEIGHBORHOOD_SUPPLEMENTS = [
    {
        city: "İstanbul",
        district: "Pendik",
        name: "Dolayoba",
        source: "ADDRESS_SUPPLEMENT",
    },
];

function normalizeName(value) {
    return String(value || "")
        .trim()
        .toLocaleLowerCase("tr-TR")
        .replace(/\s+/g, " ");
}

function supplementId({ city, district, name }) {
    return `supplement:${normalizeName(city)}:${normalizeName(district)}:${normalizeName(name)}`;
}

function applyNeighborhoodSupplements(items, { cityName, districtName } = {}) {
    const city = normalizeName(cityName);
    const district = normalizeName(districtName);
    if (!city || !district) return items;

    const existing = new Set(items.map((item) => normalizeName(item.name)));
    const additions = NEIGHBORHOOD_SUPPLEMENTS
        .filter((item) => normalizeName(item.city) === city && normalizeName(item.district) === district)
        .filter((item) => !existing.has(normalizeName(item.name)))
        .map((item) => ({
            id: supplementId(item),
            name: item.name,
            source: item.source,
        }));

    return [...items, ...additions];
}

export {
    applyNeighborhoodSupplements,
};
