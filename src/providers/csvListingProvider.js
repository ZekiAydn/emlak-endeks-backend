import BaseListingProvider from "./baseListingProvider.js";

function cleanCell(value) {
    return String(value ?? "").trim();
}

function parseCsvLine(line, delimiter = ",") {
    const cells = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];

        if (char === '"' && inQuotes && next === '"') {
            current += '"';
            i += 1;
            continue;
        }

        if (char === '"') {
            inQuotes = !inQuotes;
            continue;
        }

        if (char === delimiter && !inQuotes) {
            cells.push(cleanCell(current));
            current = "";
            continue;
        }

        current += char;
    }

    cells.push(cleanCell(current));
    return cells;
}

export function parseCsv(text, delimiter = ",") {
    const rows = [];
    const source = String(text || "").replace(/^\uFEFF/, "");
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];
        const next = source[i + 1];

        if (char === '"' && inQuotes && next === '"') {
            current += '""';
            i += 1;
            continue;
        }

        if (char === '"') inQuotes = !inQuotes;

        if ((char === "\n" || char === "\r") && !inQuotes) {
            if (char === "\r" && next === "\n") i += 1;
            if (current.trim()) rows.push(current);
            current = "";
            continue;
        }

        current += char;
    }

    if (current.trim()) rows.push(current);
    if (!rows.length) return [];

    const headers = parseCsvLine(rows[0], delimiter).map((header) => cleanCell(header));
    return rows.slice(1).map((row) => {
        const values = parseCsvLine(row, delimiter);
        return headers.reduce((acc, header, index) => {
            acc[header] = values[index] ?? "";
            return acc;
        }, {});
    });
}

export default class CsvListingProvider extends BaseListingProvider {
    parse(bufferOrText, options = {}) {
        const text = Buffer.isBuffer(bufferOrText) ? bufferOrText.toString(options.encoding || "utf8") : String(bufferOrText || "");
        return parseCsv(text, options.delimiter || ",");
    }
}

