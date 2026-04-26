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
    return "Fiyat bandı üç farklı satış vadesi senaryosuna göre oluşturulmuştur.";
}

function saleStrategy() {
    return {
        low: {
            label: "Hızlı Satış",
            priceKey: "minPrice",
            pricePerSqmKey: "minPricePerSqm",
            saleTimeLabel: "1-3 ay",
        },
        mid: {
            label: "Ortalama Satış",
            priceKey: "expectedPrice",
            pricePerSqmKey: "expectedPricePerSqm",
            saleTimeLabel: "3-6 ay",
        },
        high: {
            label: "Yüksek Beklenti",
            priceKey: "maxPrice",
            pricePerSqmKey: "maxPricePerSqm",
            saleTimeLabel: "6-12 ay",
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
