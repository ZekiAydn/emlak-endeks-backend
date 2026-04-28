export default class BaseListingProvider {
    constructor(options = {}) {
        this.options = options;
    }

    async search() {
        throw new Error("Provider search() metodu uygulanmalı.");
    }
}

export function providerSourceFromUrl(url) {
    const text = String(url || "").toLowerCase();
    if (text.includes("hepsiemlak.com")) return "HEPSIEMLAK";
    if (text.includes("emlakjet.com")) return "EMLAKJET";
    if (text.includes("remax.com.tr")) return "REMAX";
    if (text.includes("sahibinden.com")) return "SAHIBINDEN";
    return "OTHER";
}

