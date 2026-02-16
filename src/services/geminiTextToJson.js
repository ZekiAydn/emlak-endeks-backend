const fetchFn =
    global.fetch ||
    ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));

function extractJsonFromText(text) {
    if (!text) return null;

    const cleaned = String(text)
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;

    const slice = cleaned.slice(start, end + 1);
    try {
        return JSON.parse(slice);
    } catch {
        return null;
    }
}

async function textToJson({ apiKey, modelName, prompt, input, temperature = 0 }) {
    if (!apiKey) throw new Error("GEMINI_API_KEY missing");
    if (!modelName) throw new Error("GEMINI_MODEL missing");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const body = {
        contents: [
            {
                role: "user",
                parts: [
                    { text: prompt.trim() },
                    { text: `INPUT_JSON:\n${JSON.stringify(input || {}, null, 2)}` }
                ]
            }
        ],
        generationConfig: {
            temperature,
            maxOutputTokens: 2048
        }
    };

    const r = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
        throw new Error(j?.error?.message || `Gemini error: ${r.status}`);
    }

    const rawText =
        j?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n") || "";

    const json = extractJsonFromText(rawText);
    return { rawText, json };
}

module.exports = { textToJson };
