const { getBrowser } = require("./headlessBrowser");

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

async function captureParcelMapImage(parcelLookup) {
    const url = buildParcelHashUrl(parcelLookup);
    if (!url) return null;

    const browser = await getBrowser();
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1024, deviceScaleFactor: 1.5 },
        locale: "tr-TR",
    });

    try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
        await page.waitForTimeout(6000);

        await clickIfExists(page, "#close-popup");
        await clickIfExists(page, "#terms-ok");
        await page.waitForTimeout(5000);

        await clickIfExists(page, "#zoom-out-btn");
        await page.waitForTimeout(900);

        const mapCanvas = page.locator("#map-canvas");
        if (!(await mapCanvas.count())) return null;

        const box = await mapCanvas.boundingBox();
        if (!box || box.width < 100 || box.height < 100) return null;

        const clipTop = 42;
        const clip = {
            x: Math.max(0, Math.round(box.x)),
            y: Math.max(0, Math.round(box.y + clipTop)),
            width: Math.round(box.width),
            height: Math.max(100, Math.round(box.height - clipTop)),
        };

        const buffer = await page.screenshot({
            type: "png",
            clip,
        });

        return {
            buffer,
            mime: "image/png",
            filename: "tkgm-parsel-map.png",
            sourceUrl: url,
        };
    } finally {
        await page.close().catch(() => {});
    }
}

module.exports = {
    buildParcelHashUrl,
    captureParcelMapImage,
};
