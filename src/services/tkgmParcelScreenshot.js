import { getBrowser } from "./headlessBrowser.js";

function buildParcelHashUrl(parcelLookup) {
    const neighborhoodId = parcelLookup?.neighborhoodId;
    const blockNo = parcelLookup?.properties?.blockNo;
    const parcelNo = parcelLookup?.properties?.parcelNo;

    if (!neighborhoodId || !blockNo || !parcelNo) return null;

    return `https://parselsorgu.tkgm.gov.tr/#ara/idari/${encodeURIComponent(neighborhoodId)}/${encodeURIComponent(blockNo)}/${encodeURIComponent(parcelNo)}/${Date.now()}`;
}

async function clickIfExists(page, selector) {
    const locator = page.locator(selector);
    if (!(await locator.count())) return;
    await locator.click({ force: true }).catch(() => {});
}

async function clickTextIfExists(page, text) {
    const locator = page.getByText(text, { exact: false }).first();
    if (!(await locator.count().catch(() => 0))) return;
    await locator.click({ force: true, timeout: 1500 }).catch(() => {});
}

async function firstVisibleMapLocator(page) {
    const selectors = [
        "#map-canvas",
        ".ol-viewport",
        ".ol-map",
        ".leaflet-container",
        ".cesium-widget",
        "canvas",
        "body",
    ];

    for (const selector of selectors) {
        const locator = page.locator(selector).first();
        const count = await locator.count().catch(() => 0);
        if (!count) continue;

        const box = await locator.boundingBox().catch(() => null);
        if (!box || box.width < 100 || box.height < 100) continue;

        return { selector, locator, box };
    }

    return null;
}

async function captureParcelMapImage(parcelLookup, options = {}) {
    const url = buildParcelHashUrl(parcelLookup);
    if (!url) return null;

    const logPrefix = "[TKGM_SCREENSHOT]";
    const reportId = options.reportId || null;
    const startedAt = Date.now();

    const browser = await getBrowser();
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1024, deviceScaleFactor: 1.5 },
        locale: "tr-TR",
    });

    try {
        console.log(logPrefix, "start", {
            reportId,
            url,
            neighborhoodId: parcelLookup?.neighborhoodId,
            blockNo: parcelLookup?.properties?.blockNo,
            parcelNo: parcelLookup?.properties?.parcelNo,
        });

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(5000);

        await clickIfExists(page, "#close-popup");
        await clickIfExists(page, "#terms-ok");
        await clickTextIfExists(page, "Kabul");
        await clickTextIfExists(page, "Tamam");
        await clickTextIfExists(page, "Kapat");
        await page.waitForTimeout(3500);

        await clickIfExists(page, "#zoom-out-btn");
        await page.waitForTimeout(900);

        const mapTarget = await firstVisibleMapLocator(page);
        if (!mapTarget) {
            console.warn(logPrefix, "map target not found", {
                reportId,
                title: await page.title().catch(() => null),
                elapsedMs: Date.now() - startedAt,
            });
            return null;
        }

        const clipTop = 42;
        const box = mapTarget.box;
        const clip = {
            x: Math.max(0, Math.round(box.x)),
            y: Math.max(0, Math.round(box.y + (mapTarget.selector === "body" ? 0 : clipTop))),
            width: Math.round(box.width),
            height: Math.max(100, Math.round(box.height - (mapTarget.selector === "body" ? 0 : clipTop))),
        };

        const buffer = await page.screenshot({
            type: "png",
            clip,
        });

        console.log(logPrefix, "success", {
            reportId,
            selector: mapTarget.selector,
            bytes: buffer.length,
            elapsedMs: Date.now() - startedAt,
        });

        return {
            buffer,
            mime: "image/png",
            filename: "tkgm-parsel-map.png",
            sourceUrl: url,
        };
    } catch (error) {
        console.error(logPrefix, "failed", {
            reportId,
            message: String(error.message || error),
            elapsedMs: Date.now() - startedAt,
        });
        throw error;
    } finally {
        await page.close().catch(() => {});
    }
}

export {
    buildParcelHashUrl,
    captureParcelMapImage,
};
