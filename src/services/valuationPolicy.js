function toNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function roundPrice(value) {
    const n = toNumber(value);
    return n === null ? null : Math.round(n / 1000) * 1000;
}

function roundPriceDown(value) {
    const n = toNumber(value);
    return n === null ? null : Math.floor(n / 1000) * 1000;
}

function roundSqm(value) {
    const n = toNumber(value);
    return n === null ? null : Math.round(n);
}

const SALE_EXPECTED_INFLATION_RATE = 0.15;
const SALE_MAX_INFLATION_RATE = 0.30;

function policyNote() {
    return "Fiyat bandı emsal verileri ve rapora girilen taşınmaz özellikleri birlikte değerlendirilerek oluşturulmuştur.";
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

    function add(condition, value, label) {
        if (!condition) return;
        percent += value;
        features.push(label);
    }

    add(buildingDetails.isSite, 0.04, "site içerisinde");
    add(buildingDetails.closedPool, 0.05, "kapalı havuz");
    add(!buildingDetails.closedPool && buildingDetails.openPool, 0.04, "açık havuz");
    add(buildingDetails.hasFitnessCenter || buildingDetails.hasSportsArea, 0.04, "fitness/spor alanı");
    add(buildingDetails.security, 0.03, "güvenlik");
    add(buildingDetails.closedParking, 0.03, "kapalı otopark");
    add(!buildingDetails.closedParking && buildingDetails.openParking, 0.01, "açık otopark");
    add(buildingDetails.hasGenerator, 0.02, "jeneratör");
    add(buildingDetails.hasHydrophore, 0.01, "hidrofor");
    add(buildingDetails.hasThermalInsulation, 0.02, "ısı yalıtımı");
    add(buildingDetails.hasWaterTank, 0.01, "su deposu");
    add(buildingDetails.hasAC, 0.02, "klima");
    add(buildingDetails.hasFireplace, 0.02, "şömine");

    percent = Math.min(0.24, percent);

    return {
        multiplier: percent > 0 ? 1 + percent : 1,
        percent,
        features,
        note: percent > 0
            ? `${features.join(", ")} özellikleri için fiyat bandına yaklaşık %${Math.round(percent * 100)} premium uygulanmıştır.`
            : null,
    };
}

function conditionAdjustment(buildingDetails = {}, propertyDetails = {}, options = {}) {
    const isResidential = !options.propertyCategory || options.propertyCategory === "residential";
    if (!isResidential) {
        return {
            multiplier: 1,
            percent: 0,
            factors: [],
            note: null,
        };
    }

    const age = toNumber(buildingDetails.buildingAge);
    const floor = toNumber(propertyDetails.floor);
    const hasElevator = buildingDetails.hasElevator === true;
    const noElevator = buildingDetails.hasElevator === false;
    const factors = [];
    let percent = 0;

    if (age !== null) {
        if (age >= 30) percent += 0.5;
        else if (age >= 25) percent += 0.42;
        else if (age >= 20) percent += 0.35;
        else if (age >= 15) percent += 0.28;
        else if (age >= 10) percent += 0.2;
        else if (age >= 5) percent += 0.1;
        else if (age >= 3) percent += 0.04;

        if (percent > 0) factors.push(`${Math.round(age)} yaş bina`);
    }

    if (noElevator) {
        percent += 0.06;
        factors.push("asansör yok");

        if (floor !== null && floor >= 3) {
            percent += 0.07;
            factors.push(`${Math.round(floor)}. kat asansörsüz kullanım`);
        }
    } else if (hasElevator && age !== null && age >= 10) {
        percent = Math.max(0, percent - 0.03);
        factors.push("asansör mevcut");
    }

    percent = Math.min(0.58, Math.max(0, percent));

    return {
        multiplier: percent > 0 ? 1 - percent : 1,
        percent,
        factors,
        note: percent > 0
            ? `${factors.join(", ")} nedeniyle fiyat bandına yaklaşık %${Math.round(percent * 100)} yaş/asansör düzeltmesi uygulanmıştır.`
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

function saleInflationBand(minPrice) {
    const basePrice = roundPrice(minPrice);
    if (basePrice === null) return null;

    const expectedPrice = roundPrice(basePrice * (1 + SALE_EXPECTED_INFLATION_RATE));
    const maxPrice = roundPriceDown(basePrice * (1 + SALE_MAX_INFLATION_RATE));

    return {
        minPrice: basePrice,
        expectedPrice: Math.max(basePrice, Math.min(expectedPrice, maxPrice)),
        maxPrice: Math.max(basePrice, maxPrice),
        expectedInflationPct: Math.round(SALE_EXPECTED_INFLATION_RATE * 100),
        maxInflationPct: Math.round(SALE_MAX_INFLATION_RATE * 100),
    };
}

function applyValuationPolicy(input = {}, areaHint = null, valuationType = "SALE", options = {}) {
    const isRental = String(valuationType || "").toUpperCase() === "RENTAL";
    const premium = options.skipAmenityPremium
        ? { multiplier: 1, percent: 0, features: [], note: null }
        : premiumFeatureAdjustment(options.buildingDetails || {}, options);
    const condition = conditionAdjustment(options.buildingDetails || {}, options.propertyDetails || {}, options);
    const area = toNumber(areaHint);
    const sourceMinPrice = toNumber(input.minPrice);
    const sourceExpectedPrice = toNumber(input.expectedPrice ?? input.avgPrice);
    const sourceMaxPrice = toNumber(input.maxPrice);
    const sourceMinSqm = toNumber(input.minPricePerSqm);
    const sourceExpectedSqm = toNumber(input.expectedPricePerSqm ?? input.avgPricePerSqm);
    const sourceMaxSqm = toNumber(input.maxPricePerSqm);

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
    let expectedPrice = sourceExpectedPrice;
    if (expectedPrice === null && sourceExpectedSqm !== null && area && area > 0) {
        expectedPrice = sourceExpectedSqm * area;
    }
    expectedPrice = roundPrice(expectedPrice ?? minPrice * (isRental ? 1.1 : 1.15));

    let maxPrice = sourceMaxPrice;
    if (maxPrice === null && sourceMaxSqm !== null && area && area > 0) {
        maxPrice = sourceMaxSqm * area;
    }
    maxPrice = roundPrice(maxPrice ?? minPrice * (isRental ? 1.22 : 1.3));

    if (expectedPrice < minPrice) expectedPrice = minPrice;
    if (maxPrice < expectedPrice) maxPrice = expectedPrice;

    if (premium.percent > 0) {
        minPrice = roundPrice(minPrice * premium.multiplier);
        expectedPrice = roundPrice(expectedPrice * premium.multiplier);
        maxPrice = roundPrice(maxPrice * premium.multiplier);
    }

    if (condition.percent > 0) {
        minPrice = roundPrice(minPrice * condition.multiplier);
        expectedPrice = roundPrice(expectedPrice * condition.multiplier);
        maxPrice = roundPrice(maxPrice * condition.multiplier);
    }

    const inflationBand = isRental ? null : saleInflationBand(minPrice);
    if (inflationBand) {
        minPrice = inflationBand.minPrice;
        expectedPrice = inflationBand.expectedPrice;
        maxPrice = inflationBand.maxPrice;
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
            saleInflationBand: inflationBand
                ? {
                      basePriceKey: "minPrice",
                      expectedInflationPct: inflationBand.expectedInflationPct,
                      maxInflationPct: inflationBand.maxInflationPct,
                      maxSpreadPct: inflationBand.maxInflationPct,
                  }
                : null,
            amenityPremium: premium.percent > 0
                ? {
                      percent: Math.round(premium.percent * 100),
                      multiplier: premium.multiplier,
                      features: premium.features,
                      note: premium.note,
                  }
                : null,
            conditionAdjustment: condition.percent > 0
                ? {
                      percent: Math.round(condition.percent * 100),
                      multiplier: condition.multiplier,
                      factors: condition.factors,
                      note: condition.note,
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
            next.expectedPricePerSqm = roundSqm(minSqm * (1 + (isRental ? 0.1 : SALE_EXPECTED_INFLATION_RATE)));
            next.avgPricePerSqm = next.expectedPricePerSqm;
            next.maxPricePerSqm = roundSqm(minSqm * (1 + (isRental ? 0.22 : SALE_MAX_INFLATION_RATE)));
        }
    }

    const noteText = [next.valuationPolicy.note, premium.note, condition.note].filter(Boolean).join(" ");
    const existingNote = String(input.note || "").trim();
    next.note = options.suppressPolicyNoteAppend
        ? existingNote
        : existingNote ? `${existingNote}\n\n${noteText}` : noteText;

    return next;
}

export {
    applyValuationPolicy,
    rentalEstimateFromSale,
    rentalStrategy,
    saleStrategy,
};
