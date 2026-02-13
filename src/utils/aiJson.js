function extractJson(text) {
    if (!text) return null;
    const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
    if (fenced && fenced[1]) {
        return safeParse(fenced[1]);
    }

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return safeParse(text.slice(firstBrace, lastBrace + 1));
    }

    return safeParse(text);
}

function safeParse(s) {
    try {
        return JSON.parse(s);
    } catch (e) {
        return null;
    }
}

function pickDefined(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (v !== undefined && v !== null && v !== "") out[k] = v;
    }
    return out;
}

module.exports = { extractJson, pickDefined };
