const FALLBACK_DEFAULT_COMPARABLE_IMAGE_URL = "https://emlakskor.com/comparables/no-comparable-image.png";

function cleanString(value) {
    return String(value || "").trim();
}

export function getDefaultComparableImage(_propertyType = null) {
    return cleanString(process.env.DEFAULT_COMPARABLE_IMAGE_URL) || FALLBACK_DEFAULT_COMPARABLE_IMAGE_URL;
}

export function ensureComparableImage(imageUrl, propertyType = null) {
    const cleaned = cleanString(imageUrl);
    if (cleaned) {
        return {
            imageUrl: cleaned,
            imageStatus: cleaned === getDefaultComparableImage(propertyType) ? "DEFAULT" : "REAL",
        };
    }

    return {
        imageUrl: getDefaultComparableImage(propertyType),
        imageStatus: "DEFAULT",
    };
}

export { FALLBACK_DEFAULT_COMPARABLE_IMAGE_URL };

