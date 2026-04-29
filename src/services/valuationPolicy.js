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

function premiumFeatureAdjustment(buildingDetails = {}, options = {}) {
    const isResidential = !options.propertyCategory || options.propertyCategory === "residential";
    if (!isResidential) {
        return {
            multiplier: 1,
            percent: 0,
            features: [],
            note: null,
        };
    }

    const features = [];
    let percent = 0;

    if (buildingDetails.isSite) {
        percent += 0.04;
        features.push("site içerisinde");
    }

    if (buildingDetails.closedPool) {
        percent += 0.05;
        features.push("kapalı havuz");
    }

    if (buildingDetails.hasFitnessCenter || buildingDetails.hasSportsArea) {
        percent += 0.04;
        features.push("fitness/spor alanı");
    }

    percent = Math.min(0.15, percent);

    return {
        multiplier: percent > 0 ? 1 + percent : 1,
        percent,
        features,
        note: percent > 0
            ? `${features.join(", ")} özellikleri için fiyat bandına yaklaşık %${Math.round(percent * 100)} premium uygulanmıştır.`
            : null,
    };
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

function applyValuationPolicy(input = {}, areaHint = null, valuationType = "SALE", options = {}) {
    const isRental = String(valuationType || "").toUpperCase() === "RENTAL";
    const premium = options.skipAmenityPremium
        ? { multiplier: 1, percent: 0, features: [], note: null }
        : premiumFeatureAdjustment(options.buildingDetails || {}, options);
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
    let expectedPrice = roundPrice(minPrice * (isRental ? 1.1 : 1.15));
    let maxPrice = roundPrice(minPrice * (isRental ? 1.22 : 1.3));

    if (premium.percent > 0) {
        minPrice = roundPrice(minPrice * premium.multiplier);
        expectedPrice = roundPrice(expectedPrice * premium.multiplier);
        maxPrice = roundPrice(maxPrice * premium.multiplier);
    }

    const next = {
        ...input,
        minPrice,
        expectedPrice,
        maxPrice,
        avgPrice: expectedPrice,
        saleStrategy: isRental ? rentalStrategy() : saleStrategy(),
        valuationPolicy: {
            note: isRental ? "Kira bandı farklı pazarlama süreleri için oluşturulmuştur." : policyNote(),
            amenityPremium: premium.percent > 0
                ? {
                      percent: Math.round(premium.percent * 100),
                      multiplier: premium.multiplier,
                      features: premium.features,
                      note: premium.note,
                  }
                : null,
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

    const noteText = [next.valuationPolicy.note, premium.note].filter(Boolean).join(" ");
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
