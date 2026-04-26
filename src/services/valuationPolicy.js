function toNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function roundPrice(value) {
    const n = toNumber(value);
    return n === null ? null : Math.round(n / 1000) * 1000;
}

function roundSqm(value) {
    const n = toNumber(value);
    return n === null ? null : Math.round(n);
}

function policyNote() {
    return [
        "Fiyat bandı hızlı satış senaryosundaki minimum değer üzerinden oluşturulmuştur.",
        "Ortalama fiyat minimum değere %15 enflasyon/pazarlık farkı eklenerek, yüksek fiyat minimum değere %30 fark eklenerek hesaplanmıştır.",
        "Tahmini satış süreleri: minimum 1-3 ay, ortalama 3-6 ay, yüksek 6-12 ay.",
    ].join(" ");
}

function saleStrategy() {
    return {
        low: {
            label: "Hızlı Satış",
            priceKey: "minPrice",
            pricePerSqmKey: "minPricePerSqm",
            saleTimeLabel: "1-3 ay",
            multiplier: 1,
        },
        mid: {
            label: "Ortalama Satış",
            priceKey: "expectedPrice",
            pricePerSqmKey: "expectedPricePerSqm",
            saleTimeLabel: "3-6 ay",
            multiplier: 1.15,
            note: "%15 enflasyon/pazarlık farkı",
        },
        high: {
            label: "Yüksek Beklenti",
            priceKey: "maxPrice",
            pricePerSqmKey: "maxPricePerSqm",
            saleTimeLabel: "6-12 ay",
            multiplier: 1.3,
            note: "Minimum değere %30 fark",
        },
    };
}

function applyValuationPolicy(input = {}, areaHint = null) {
    const area = toNumber(areaHint);
    const sourceMinPrice = toNumber(input.minPrice);
    const sourceMinSqm = toNumber(input.minPricePerSqm);

    let minPrice = sourceMinPrice;
    if (minPrice === null && sourceMinSqm !== null && area && area > 0) {
        minPrice = sourceMinSqm * area;
    }

    if (minPrice === null) return {
        ...input,
        saleStrategy: saleStrategy(),
        valuationPolicy: {
            averageInflationPct: 15,
            highDifferencePct: 30,
            note: policyNote(),
        },
    };

    minPrice = roundPrice(minPrice);
    const expectedPrice = roundPrice(minPrice * 1.15);
    const maxPrice = roundPrice(minPrice * 1.3);

    const next = {
        ...input,
        minPrice,
        expectedPrice,
        maxPrice,
        avgPrice: expectedPrice,
        saleStrategy: saleStrategy(),
        valuationPolicy: {
            averageInflationPct: 15,
            highDifferencePct: 30,
            note: policyNote(),
        },
    };

    if (area && area > 0) {
        next.minPricePerSqm = roundSqm(minPrice / area);
        next.expectedPricePerSqm = roundSqm(expectedPrice / area);
        next.avgPricePerSqm = next.expectedPricePerSqm;
        next.maxPricePerSqm = roundSqm(maxPrice / area);
    } else {
        const minSqm = sourceMinSqm ?? toNumber(input.minPricePerSqm);
        if (minSqm !== null) {
            next.minPricePerSqm = roundSqm(minSqm);
            next.expectedPricePerSqm = roundSqm(minSqm * 1.15);
            next.avgPricePerSqm = next.expectedPricePerSqm;
            next.maxPricePerSqm = roundSqm(minSqm * 1.3);
        }
    }

    const existingNote = String(input.note || "").trim();
    next.note = existingNote ? `${existingNote}\n\n${policyNote()}` : policyNote();

    return next;
}

export {
    applyValuationPolicy,
    saleStrategy,
};
