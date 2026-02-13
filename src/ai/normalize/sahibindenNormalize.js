function cleanNumberString(v) {
    if (v === undefined || v === null || v === "") return "";
    return String(v).trim();
}

// 6.699.000 TL -> 6699000
function toNumberOrNull(v) {
    const s0 = cleanNumberString(v);
    if (!s0) return null;

    // binlik noktaları kaldır, virgülü noktaya çevir
    const s = s0
        .replace(/\./g, "")
        .replace(",", ".")
        .replace(/[^\d.]/g, "");

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

function toIntOrNull(v) {
    const n = toNumberOrNull(v);
    return n === null ? null : Math.trunc(n);
}

function toBoolOrNull(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === "boolean") return v;

    const s = String(v).toLowerCase().trim();
    if (["var", "evet", "true", "1", "mevcut"].includes(s)) return true;
    if (["yok", "hayır", "false", "0", "degil", "değil"].includes(s)) return false;

    // otopark metni gibi durumlar
    if (s.includes("otopark")) return true;

    return null;
}

// "3+1" -> {roomCount:3, salonCount:1}
function parseRoomSalon(v) {
    const s = cleanNumberString(v);
    if (!s) return { roomCount: null, salonCount: null };

    // Stüdyo gibi
    if (s.toLowerCase().includes("stüdyo") || s.toLowerCase().includes("stüdyo")) {
        return { roomCount: 1, salonCount: 0 };
    }

    const m = s.match(/(\d+)\s*\+\s*(\d+)/);
    if (m) return { roomCount: Number(m[1]), salonCount: Number(m[2]) };

    // sadece "3" gibi
    const n = s.match(/(\d+)/);
    if (n) return { roomCount: Number(n[1]), salonCount: null };

    return { roomCount: null, salonCount: null };
}

// "11-15 arası" -> 13 (ortalama), "21 ve üzeri" -> 21
function parseBuildingAgeTextToInt(ageText) {
    const s = cleanNumberString(ageText).toLowerCase();
    if (!s) return null;

    if (s.includes("sıfır") || s === "0") return 0;

    // 11-15
    const r = s.match(/(\d+)\s*-\s*(\d+)/);
    if (r) {
        const a = Number(r[1]);
        const b = Number(r[2]);
        if (Number.isFinite(a) && Number.isFinite(b)) return Math.round((a + b) / 2);
    }

    // "21 ve üzeri"
    const up = s.match(/(\d+)\s*(ve\s*üzeri|ve\s*uzeri|\+)/);
    if (up) return Number(up[1]);

    // tek sayı yakala
    const one = s.match(/(\d+)/);
    if (one) return Number(one[1]);

    return null;
}

function normalizeSahibinden(parsed) {
    const listing = parsed?.listing || {};
    const propertyDetails = parsed?.propertyDetails || {};
    const buildingDetails = parsed?.buildingDetails || {};
    const pricingAnalysis = parsed?.pricingAnalysis || {};
    const extras = parsed?.extras || {};

    // oda sayısı bazen propertyDetails içinde değil, extras/başka yerde gelebilir
    const roomRaw = propertyDetails.roomCount ?? parsed?.odaSayisi ?? extras?.roomText ?? null;
    const rooms = parseRoomSalon(roomRaw);

    const buildingAgeText = buildingDetails.buildingAgeText ?? parsed?.buildingAgeText ?? null;

    const extracted = {
        listing: {
            id: listing.id ?? null, // ilan no
            title: listing.title ?? null,
            price: toNumberOrNull(listing.price),
            locationText: listing.locationText ?? null,
            listingDateText: listing.listingDateText ?? null
        },

        // report alanları
        addressText: parsed?.addressText ?? listing.locationText ?? null,
        parcelText: parsed?.parcelText ?? null,

        propertyDetails: {
            roomCount: rooms.roomCount,
            salonCount: rooms.salonCount,
            bathCount: toIntOrNull(propertyDetails.bathCount),
            grossArea: toNumberOrNull(propertyDetails.grossArea),
            netArea: toNumberOrNull(propertyDetails.netArea),
            floor: toIntOrNull(propertyDetails.floor),
            heating: propertyDetails.heating ?? null,
            facade: propertyDetails.facade ?? null,
            view: propertyDetails.view ?? null
        },

        buildingDetails: {
            buildingAge: parseBuildingAgeTextToInt(buildingAgeText),
            buildingFloors: toIntOrNull(buildingDetails.buildingFloors),
            hasElevator: toBoolOrNull(buildingDetails.hasElevator),
            hasParking: toBoolOrNull(buildingDetails.hasParking ?? extras.parkingText),
            isSite: toBoolOrNull(buildingDetails.isSite),
            security: toBoolOrNull(buildingDetails.security)
        },

        pricingAnalysis: {
            minPrice: null,
            expectedPrice: toNumberOrNull(pricingAnalysis.expectedPrice ?? listing.price),
            maxPrice: null,
            note: pricingAnalysis.note ?? null
        },

        // şemada olmayan alanlar (comparablesJson'a koyacağız)
        extras: {
            propertyType: extras.propertyType ?? null,
            kitchen: extras.kitchen ?? null,
            balcony: extras.balcony ?? null,
            furnished: extras.furnished ?? null,
            usageStatus: extras.usageStatus ?? null,
            siteName: extras.siteName ?? null,
            duesTL: toNumberOrNull(extras.duesTL),
            creditEligible: extras.creditEligible ?? null,
            deedStatus: extras.deedStatus ?? null,
            fromWho: extras.fromWho ?? null,
            barter: extras.barter ?? null,
            parkingText: extras.parkingText ?? null,
            buildingAgeText: buildingAgeText ?? null
        }
    };

    return extracted;
}

module.exports = { normalizeSahibinden };
