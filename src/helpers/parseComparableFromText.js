function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function numberFromLocale(value) {
    if (value === undefined || value === null || value === "") return null;
    let text = String(value)
        .replace(/\s/g, "")
        .replace(/[^\d.,-]/g, "");

    if (!text || text === "-") return null;

    const commaCount = (text.match(/,/g) || []).length;
    const dotCount = (text.match(/\./g) || []).length;

    if (commaCount && dotCount) {
        if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
            text = text.replace(/\./g, "").replace(",", ".");
        } else {
            text = text.replace(/,/g, "");
        }
    } else if (commaCount > 1) {
        text = text.replace(/,/g, "");
    } else if (dotCount > 1) {
        text = text.replace(/\./g, "");
    } else if (commaCount === 1) {
        const [head, tail] = text.split(",");
        text = tail.length === 3 && head.length <= 3 ? `${head}${tail}` : `${head}.${tail}`;
    } else if (dotCount === 1) {
        const [head, tail] = text.split(".");
        text = tail.length === 3 && head.length <= 3 ? `${head}${tail}` : text;
    }

    const number = Number(text);
    return Number.isFinite(number) ? number : null;
}

function parsePrice(text) {
    const source = cleanText(text);
    const millionMatch = source.match(/(\d+(?:[.,]\d+)?)\s*(?:milyon|mn)\s*(?:tl|₺)?/i);
    if (millionMatch) {
        const value = numberFromLocale(millionMatch[1]);
        if (Number.isFinite(value)) {
            return {
                price: Math.round(value * 1_000_000),
                priceText: millionMatch[0],
            };
        }
    }

    const patterns = [
        /₺\s*(\d[\d.,]{3,})/gi,
        /(\d[\d.,]{3,})\s*(?:tl|₺)/gi,
    ];

    for (const pattern of patterns) {
        const matches = [...source.matchAll(pattern)];
        for (const match of matches) {
            const price = numberFromLocale(match[1]);
            if (Number.isFinite(price) && price >= 1000) {
                return {
                    price: Math.round(price),
                    priceText: match[0],
                };
            }
        }
    }

    return { price: null, priceText: null };
}

function parseArea(text) {
    const source = cleanText(text);
    const grossBefore = source.match(/(?:brüt|brut|gross)\s*:?\s*(\d{1,4}(?:[.,]\d+)?)\s*(?:m2|m²|metrekare)/i);
    const netBefore = source.match(/(?:net)\s*:?\s*(\d{1,4}(?:[.,]\d+)?)\s*(?:m2|m²|metrekare)/i);
    const grossAfter = source.match(/(\d{1,4}(?:[.,]\d+)?)\s*(?:m2|m²|metrekare)\s*(?:brüt|brut|gross)/i);
    const netAfter = source.match(/(\d{1,4}(?:[.,]\d+)?)\s*(?:m2|m²|metrekare)\s*net/i);

    const grossMatch = grossBefore || grossAfter;
    const netMatch = netBefore || netAfter;
    const genericMatch = source.match(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|metrekare)/i);

    const grossM2 = grossMatch ? numberFromLocale(grossMatch[1]) : null;
    const netM2 = netMatch ? numberFromLocale(netMatch[1]) : null;

    if (grossM2 || netM2) {
        return {
            grossM2,
            netM2,
            grossM2Text: grossMatch?.[0] || null,
            netM2Text: netMatch?.[0] || null,
            areaSource: grossM2 && netM2 ? "TEXT_GROSS_AND_NET" : grossM2 ? "TEXT_GROSS" : "TEXT_NET",
        };
    }

    const genericM2 = genericMatch ? numberFromLocale(genericMatch[1]) : null;
    return {
        grossM2: genericM2,
        netM2: null,
        grossM2Text: genericMatch?.[0] || null,
        netM2Text: null,
        areaSource: genericM2 ? "TEXT_GENERIC" : null,
    };
}

function parseRooms(text) {
    const match = cleanText(text).match(/(^|[^\d])(\d{1,2})\s*\+\s*(\d{1,2})([^\d]|$)/);
    if (!match) return { roomCount: null, salonCount: null, roomText: null };

    return {
        roomCount: Number(match[2]),
        salonCount: Number(match[3]),
        roomText: `${match[2]}+${match[3]}`,
    };
}

function parseFloor(text) {
    const source = cleanText(text);
    if (/bahçe\s*katı|bahce\s*kati|giriş\s*katı|giris\s*kati|zemin\s*kat/i.test(source)) {
        return { floor: 0, floorText: source.match(/(bahçe\s*katı|bahce\s*kati|giriş\s*katı|giris\s*kati|zemin\s*kat)/i)?.[0] || null };
    }
    if (/ara\s*kat/i.test(source)) {
        return { floor: null, floorText: "Ara kat" };
    }

    const match = source.match(/(-?\d{1,2})\s*\.?\s*(?:kat|katta|kattadır|katında)/i);
    if (!match) return { floor: null, floorText: null };

    return {
        floor: Number(match[1]),
        floorText: match[0],
    };
}

function parseBuildingAge(text) {
    const source = cleanText(text);
    if (/(?:sıfır|sifir|0\s*bina|yeni\s*bina)/i.test(source)) {
        return { buildingAge: 0, buildingAgeText: source.match(/(?:sıfır|sifir|0\s*bina|yeni\s*bina)/i)?.[0] || null };
    }

    const match = source.match(/(\d{1,3})\s*(?:yaşında|yasinda|yaş|yas|yıllık|yillik)/i);
    if (!match) return { buildingAge: null, buildingAgeText: null };

    return {
        buildingAge: Number(match[1]),
        buildingAgeText: match[0],
    };
}

function parseHeating(text) {
    const source = cleanText(text);
    const rules = [
        { value: "Yerden Isıtma", pattern: /yerden\s*(?:ısıtma|isitma)/i },
        { value: "Kombi Doğalgaz", pattern: /kombi.*(?:doğalgaz|dogalgaz)|(?:doğalgaz|dogalgaz).*kombi/i },
        { value: "Kombi", pattern: /kombi/i },
        { value: "Doğalgaz", pattern: /doğalgaz|dogalgaz/i },
        { value: "Merkezi", pattern: /merkezi/i },
        { value: "Klima", pattern: /klima/i },
        { value: "Soba", pattern: /soba/i },
    ];

    const found = rules.find((rule) => rule.pattern.test(source));
    return {
        heating: found?.value || null,
        heatingText: found ? source.match(found.pattern)?.[0] || found.value : null,
    };
}

function parseLocationHint(text) {
    const source = cleanText(text);
    const neighborhoodMatch = source.match(/([\p{L}\d'’.\-\s]{2,45})\s+(?:mahallesi|mah\.|mah|mh\.|mh)/iu);
    return {
        parsedNeighborhood: neighborhoodMatch ? cleanText(neighborhoodMatch[1]) : null,
    };
}

export function parseComparableFromText(text, context = {}) {
    const source = cleanText(text);
    const price = parsePrice(source);
    const area = parseArea(source);
    const rooms = parseRooms(source);
    const floor = parseFloor(source);
    const buildingAge = parseBuildingAge(source);
    const heating = parseHeating(source);
    const locationHint = parseLocationHint(source);

    const city = cleanText(context.city) || null;
    const district = cleanText(context.district) || null;
    const neighborhood = cleanText(context.neighborhood) || null;
    const addressText = cleanText(context.addressText) || [city, district, neighborhood].filter(Boolean).join(" / ") || null;

    return {
        price: price.price,
        grossM2: area.grossM2,
        netM2: area.netM2,
        roomCount: rooms.roomCount,
        salonCount: rooms.salonCount,
        buildingAge: buildingAge.buildingAge,
        floor: floor.floor,
        heating: heating.heating,
        city,
        district,
        neighborhood,
        addressText,
        parsedRaw: {
            sourceText: source || null,
            priceText: price.priceText,
            grossM2Text: area.grossM2Text,
            netM2Text: area.netM2Text,
            areaSource: area.areaSource,
            roomText: rooms.roomText,
            floorText: floor.floorText,
            buildingAgeText: buildingAge.buildingAgeText,
            heatingText: heating.heatingText,
            parsedNeighborhood: locationHint.parsedNeighborhood,
        },
    };
}

export default parseComparableFromText;
