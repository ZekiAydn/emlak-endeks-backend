const { GoogleGenerativeAI } = require("@google/generative-ai");
const { extractJson } = require("../utils/aiJson");

let _client = null;
let _clientKey = null;

function getClient(apiKey) {
    if (_client && _clientKey === apiKey) return _client;
    _clientKey = apiKey;
    _client = new GoogleGenerativeAI(apiKey);
    return _client;
}

/**
 * Gemini Vision: image + prompt -> { rawText, json }
 */
async function visionToJson({
                                apiKey,
                                modelName = "gemini-1.5-flash",
                                prompt,
                                imageBuffer,
                                mimeType = "image/jpeg",
                                temperature = 0
                            }) {
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    if (!prompt) throw new Error("Missing prompt");
    if (!imageBuffer) throw new Error("Missing imageBuffer");

    const genAI = getClient(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    const base64 = Buffer.from(imageBuffer).toString("base64");

    const result = await model.generateContent({
        contents: [
            {
                role: "user",
                parts: [
                    { text: prompt },
                    { inlineData: { data: base64, mimeType } }
                ]
            }
        ],
        generationConfig: { temperature }
        // bazı sürümlerde çalışıyor: responseMimeType: "application/json"
    });

    const rawText = result?.response?.text?.() || "";
    const json = extractJson(rawText);

    return { rawText, json };
}

module.exports = { visionToJson };
