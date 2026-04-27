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

function rentalStrategy() {
    return {
        low: {
            label: "Hızlı Kiralama",
            priceKey: "minPrice",
            pricePerSqmKey: "minPricePerSqm",
            saleTimeLabel: "1-2 hafta",
        },
        mid: {
            label: "Piyasa Kirası",
            priceKey: "expectedPrice",
            pricePerSqmKey: "expectedPricePerSqm",
            saleTimeLabel: "2-4 hafta",
        },
        high: {
            label: "Yüksek Kira Beklentisi",
            priceKey: "maxPrice",
            pricePerSqmKey: "maxPricePerSqm",
            saleTimeLabel: "1-2 ay",
        },
    };
}

function rentalEstimateFromSale(expectedPrice, areaHint = null) {
    const price = toNumber(expectedPrice);
    if (price === null || price <= 0) return null;

    const minRent = roundPrice(price * 0.0037);
    const expectedRent = roundPrice(price * 0.0042);
    const maxRent = roundPrice(price * 0.0048);
    const area = toNumber(areaHint);

    return {
        minRent,
        expectedRent,
        maxRent,
        minRentPerSqm: area && area > 0 ? roundSqm(minRent / area) : null,
        expectedRentPerSqm: area && area > 0 ? roundSqm(expectedRent / area) : null,
        maxRentPerSqm: area && area > 0 ? roundSqm(maxRent / area) : null,
        grossYieldPct: 5.0,
        note: "Satış değeri üzerinden aylık brüt kira karşılığı yaklaşık %4,4-%5,8 yıllık brüt getiri bandıyla tahmin edilmiştir.",
    };
}

function applyValuationPolicy(input = {}, areaHint = null, valuationType = "SALE") {
    const isRental = String(valuationType || "").toUpperCase() === "RENTAL";
    const area = toNumber(areaHint);
    const sourceMinPrice = toNumber(input.minPrice);
    const sourceMinSqm = toNumber(input.minPricePerSqm);

    let minPrice = sourceMinPrice;
    if (minPrice === null && sourceMinSqm !== null && area && area > 0) {
        minPrice = sourceMinSqm * area;
    }

    if (minPrice === null) return {
        ...input,
        saleStrategy: isRental ? rentalStrategy() : saleStrategy(),
        valuationPolicy: {
            note: isRental ? "Kira bandı farklı pazarlama süreleri için oluşturulmuştur." : policyNote(),
        },
    };

    minPrice = roundPrice(minPrice);
    const expectedPrice = roundPrice(minPrice * (isRental ? 1.1 : 1.15));
    const maxPrice = roundPrice(minPrice * (isRental ? 1.22 : 1.3));

    const next = {
        ...input,
        minPrice,
        expectedPrice,
        maxPrice,
        avgPrice: expectedPrice,
        saleStrategy: isRental ? rentalStrategy() : saleStrategy(),
        valuationPolicy: {
            note: isRental ? "Kira bandı farklı pazarlama süreleri için oluşturulmuştur." : policyNote(),
        },
        valuationType: isRental ? "RENTAL" : "SALE",
    };

    if (!isRental) next.rentalEstimate = input.rentalEstimate || rentalEstimateFromSale(expectedPrice, area);

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

    const noteText = next.valuationPolicy.note;
    const existingNote = String(input.note || "").trim();
    next.note = existingNote ? `${existingNote}\n\n${noteText}` : noteText;

    return next;
}

export {
    applyValuationPolicy,
    rentalEstimateFromSale,
    rentalStrategy,
    saleStrategy,
};
