function toNum(value) {
    if (value === undefined || value === null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function fold(value) {
    return String(value || "")
        .toLocaleLowerCase("tr-TR")
        .replace(/ı/g, "i")
        .replace(/ğ/g, "g")
        .replace(/ü/g, "u")
        .replace(/ş/g, "s")
        .replace(/ö/g, "o")
        .replace(/ç/g, "c");
}

const LOCATION_HINTS = [
    { terms: ["bebek", "etiler", "levent", "nisantasi", "tesvikiye", "ulus", "istinye"], sqm: 175000, label: "İstanbul üst segment merkez lokasyon" },
    { terms: ["sariyer", "besiktas", "kadikoy", "suadiye", "caddebostan", "fenerbahce", "moda", "bagdat"], sqm: 125000, label: "İstanbul yüksek talep bölgesi" },
    { terms: ["atasehir", "uskudar", "bakirkoy", "sisli", "maslak", "florya", "yesilkoy", "goztepe", "acibadem"], sqm: 95000, label: "İstanbul güçlü merkez/çeper bölgesi" },
    { terms: ["maltepe", "kartal", "kucukyali", "bahcelievler", "basaksehir", "zeytinburnu", "beykoz"], sqm: 73000, label: "İstanbul orta-üst segment bölgesi" },
    { terms: ["pendik", "beylikduzu", "kucukcekmece", "avcilar", "umraniye", "sancaktepe", "cekmekoy", "tuzla"], sqm: 56000, label: "İstanbul gelişen konut bölgesi" },
    { terms: ["esenyurt", "sultangazi", "sultanbeyli", "arnavutkoy"], sqm: 38000, label: "İstanbul erişilebilir konut bölgesi" },
    { terms: ["istanbul"], sqm: 65000, label: "İstanbul geneli" },
    { terms: ["bodrum", "cesme", "çeşme", "fethiye", "datca", "datça"], sqm: 90000, label: "Turizm/ikinci konut bölgesi" },
    { terms: ["mugla", "muğla"], sqm: 70000, label: "Muğla geneli" },
    { terms: ["izmir"], sqm: 52000, label: "İzmir geneli" },
    { terms: ["antalya", "alanya"], sqm: 50000, label: "Antalya geneli" },
    { terms: ["ankara"], sqm: 38000, label: "Ankara geneli" },
    { terms: ["bursa", "kocaeli", "sakarya"], sqm: 38000, label: "Marmara büyükşehir çeperi" },
];

function locationBase(addressText, property = {}) {
    const haystack = fold([
        addressText,
        property.city,
        property.district,
        property.neighborhood,
        property.title,
    ].filter(Boolean).join(" "));

    const hit = LOCATION_HINTS.find((rule) => rule.terms.some((term) => haystack.includes(fold(term))));
    return hit || { sqm: 32000, label: "Türkiye geneli varsayılan konut lokasyonu" };
}

function adjustedSqm(baseSqm, propertyDetails = {}, buildingDetails = {}) {
    let factor = 1;
    const age = toNum(buildingDetails.buildingAge);
    const floor = toNum(propertyDetails.floor);
    const totalFloors = toNum(buildingDetails.buildingFloors);
    const area = toNum(propertyDetails.netArea) || toNum(propertyDetails.grossArea);
    const propertyType = fold(buildingDetails.propertyType);
    const condition = fold(buildingDetails.buildingCondition);
    const views = Array.isArray(propertyDetails.viewTags) ? propertyDetails.viewTags.map(fold).join(" ") : fold(propertyDetails.viewTags);

    if (propertyType.includes("villa")) factor *= 1.25;
    if (propertyType.includes("rezidans")) factor *= 1.12;
    if (propertyType.includes("mustakil") || propertyType.includes("müstakil")) factor *= 1.1;

    if (age !== null) {
        if (age <= 1) factor *= 1.12;
        else if (age <= 5) factor *= 1.08;
        else if (age <= 10) factor *= 1.03;
        else if (age >= 31) factor *= 0.84;
        else if (age >= 21) factor *= 0.9;
        else if (age >= 11) factor *= 0.95;
    }

    if (floor !== null) {
        if (floor <= 0) factor *= 0.93;
        else if (totalFloors && floor === totalFloors) factor *= 0.97;
        else if (floor >= 3) factor *= 1.02;
    }

    if (area !== null) {
        if (area < 75) factor *= 1.04;
        else if (area > 220) factor *= 0.94;
    }

    if (buildingDetails.isSite) factor *= 1.06;
    if (buildingDetails.hasElevator) factor *= 1.04;
    if (buildingDetails.closedParking) factor *= 1.05;
    else if (buildingDetails.openParking) factor *= 1.02;
    if (buildingDetails.security) factor *= 1.04;
    if (buildingDetails.openPool || buildingDetails.closedPool) factor *= 1.05;
    if (buildingDetails.hasGenerator) factor *= 1.02;
    if (buildingDetails.hasSportsArea) factor *= 1.02;
    if (buildingDetails.hasThermalInsulation) factor *= 1.02;
    if (buildingDetails.hasAC) factor *= 1.02;

    if (views.includes("deniz") || views.includes("bogaz")) factor *= 1.14;
    else if (views.includes("gol") || views.includes("göl")) factor *= 1.08;
    else if (views.includes("doga") || views.includes("bahce")) factor *= 1.04;

    if (condition.includes("yeni") || condition.includes("sifir") || condition.includes("sıfır")) factor *= 1.06;
    if (condition.includes("eski") || condition.includes("tadilat")) factor *= 0.94;

    return Math.max(18000, Math.min(250000, baseSqm * factor));
}

function roundPrice(value) {
    return Math.round(value / 1000) * 1000;
}

function roundSqm(value) {
    return Math.round(value);
}

function buildFallbackEstimate({ addressText, property, propertyDetails, buildingDetails, areaForSqm }) {
    const area = toNum(areaForSqm);
    if (!area || area <= 0) return null;

    const base = locationBase(addressText, property);
    const avgSqm = roundSqm(adjustedSqm(base.sqm, propertyDetails, buildingDetails));
    const minSqm = roundSqm(avgSqm * 0.84);
    const maxSqm = roundSqm(avgSqm * 1.16);

    return {
        sourceLabel: base.label,
        minPricePerSqm: minSqm,
        avgPricePerSqm: avgSqm,
        maxPricePerSqm: maxSqm,
        minPrice: roundPrice(minSqm * area),
        avgPrice: roundPrice(avgSqm * area),
        maxPrice: roundPrice(maxSqm * area),
    };
}

function ensureItem(list, text) {
    const arr = Array.isArray(list) ? list : [];
    if (!arr.some((item) => fold(item).includes(fold(text)))) arr.unshift(text);
    return arr;
}

function applyFallbackPriceEstimate(normalized, context) {
    if (!normalized) return null;
    const hasPrices = normalized.minPrice !== null && normalized.avgPrice !== null && normalized.maxPrice !== null;
    const hasSqm = normalized.minPricePerSqm !== null && normalized.avgPricePerSqm !== null && normalized.maxPricePerSqm !== null;
    if (hasPrices && hasSqm) return null;

    const estimate = buildFallbackEstimate(context);
    if (!estimate) return null;

    normalized.minPrice = normalized.minPrice ?? estimate.minPrice;
    normalized.avgPrice = normalized.avgPrice ?? estimate.avgPrice;
    normalized.maxPrice = normalized.maxPrice ?? estimate.maxPrice;
    normalized.minPricePerSqm = normalized.minPricePerSqm ?? estimate.minPricePerSqm;
    normalized.avgPricePerSqm = normalized.avgPricePerSqm ?? estimate.avgPricePerSqm;
    normalized.maxPricePerSqm = normalized.maxPricePerSqm ?? estimate.maxPricePerSqm;

    if (!normalized.rationale) {
        normalized.rationale = "Bu çalışma kullanıcı emsali olmadan, konum ve taşınmaz özelliklerine göre düşük güvenli ön tahmindir.";
    }

    normalized.assumptions = ensureItem(
        normalized.assumptions,
        `Manuel emsal girilmediği için fiyat aralığı ${estimate.sourceLabel} için düşük güvenli ön tahmin olarak hesaplanmıştır.`
    );
    normalized.missingData = ensureItem(normalized.missingData, "Manuel emsal verisi");
    normalized.confidence = Math.min(Number(normalized.confidence || 0.35), 0.35);
    normalized.fallbackEstimate = estimate;

    return estimate;
}

function ensureProjectionSections(normalized, context = {}) {
    if (!normalized) return normalized;

    const base = locationBase(context.addressText, context.property);
    const compsCount = Array.isArray(context.userComparables) ? context.userComparables.length : 0;
    const propertyType = context.buildingDetails?.propertyType || "konut";
    const area = toNum(context.areaForSqm);

    if (!normalized.marketProjection) {
        normalized.marketProjection = {
            averageMarketingDays: normalized.expectedSaleDays ?? (compsCount >= 3 ? 75 : 95),
            competitionStatus: compsCount >= 4 ? "Yoğun rekabet" : compsCount >= 2 ? "Orta rekabet" : "Emsal verisi sınırlı",
            activeComparableCount: compsCount || null,
            waitingComparableCount: null,
            annualChangePct: null,
            totalReturnPct: null,
            amortizationYears: null,
            summary: `${base.label} ve taşınmaz özelliklerine göre pazar projeksiyonu niteliksel olarak hazırlanmıştır. ${area ? `${area} m²` : "Alan"} büyüklüğü, ${propertyType} tipi ve kullanıcı tarafından girilen emsal sayısı dikkate alınmıştır; kesin piyasa istatistiği olarak yorumlanmamalıdır.`,
        };
    } else if (!normalized.marketProjection.summary) {
        normalized.marketProjection.summary = `${base.label} için pazar yorumu konum, taşınmaz özellikleri ve kullanıcı girdileri üzerinden niteliksel olarak hazırlanmıştır.`;
    }

    if (!normalized.regionalStats) {
        normalized.regionalStats = {
            demographicsSummary: `${base.label} çevresinde konut talebi; ulaşım, günlük ihtiyaç erişimi ve mahalle dokusu gibi faktörlerle birlikte değerlendirilmelidir.`,
            saleMarketSummary: compsCount
                ? `Satılık konut yorumu kullanıcı tarafından girilen ${compsCount} emsal üzerinden desteklenmiştir.`
                : "Satılık konut yorumu manuel emsal olmadan, konum ve taşınmaz özelliklerine göre ön değerlendirme niteliğindedir.",
            rentalMarketSummary: "Kiralık piyasa yorumu için kira emsalleri girilmediğinden net kira çarpanı hesaplanmamıştır; amortisman resmi veri yerine ihtiyatlı yorumlanmalıdır.",
            nearbyPlacesSummary: "Yakın çevre yorumu adres bilgisinden hareketle hazırlanmıştır; okul, ulaşım, sağlık ve ticari aks görselleri kullanıcı tarafından eklenirse rapor daha güçlü olur.",
            riskSummary: "Bölgesel riskler için deprem, imar, zemin ve resmi kurum kayıtları ayrıca kontrol edilmelidir.",
        };
    }

    return normalized;
}

module.exports = {
    buildFallbackEstimate,
    applyFallbackPriceEstimate,
    ensureProjectionSections,
};
