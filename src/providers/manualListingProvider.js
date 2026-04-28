import BaseListingProvider from "./baseListingProvider.js";
import { normalizeComparableListing } from "../helpers/normalizeComparableListing.js";

export default class ManualListingProvider extends BaseListingProvider {
    async normalize(entries = [], context = {}) {
        return (Array.isArray(entries) ? entries : [entries]).map((entry) =>
            normalizeComparableListing(
                {
                    ...entry,
                    providerRaw: entry,
                },
                { context }
            )
        );
    }
}

