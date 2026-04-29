import { chromium as playwrightChromium } from "playwright";

let browserPromise = null;

const DEFAULT_ARGS = ["--disable-dev-shm-usage", "--disable-gpu"];

function isServerlessRuntime() {
    return Boolean(
        process.env.VERCEL ||
            process.env.AWS_EXECUTION_ENV ||
            process.env.AWS_LAMBDA_FUNCTION_NAME ||
            process.env.NETLIFY
    );
}

async function buildLaunchOptions() {
    const args = new Set(DEFAULT_ARGS);

    if (isServerlessRuntime()) {
        const { default: chromium } = await import("@sparticuz/chromium");
        for (const arg of chromium.args || []) args.add(arg);

        return {
            headless: true,
            executablePath: await chromium.executablePath(),
            args: Array.from(args),
        };
    }

    return {
        headless: true,
        args: Array.from(args),
    };
}

async function getBrowser() {
    if (!browserPromise) {
        browserPromise = (async () => {
            try {
                return await playwrightChromium.launch(await buildLaunchOptions());
            } catch (error) {
                browserPromise = null;
                throw error;
            }
        })();
    }

    const browser = await browserPromise;
    if (!browser.isConnected()) {
        browserPromise = null;
        return getBrowser();
    }

    return browser;
}

export {
    buildLaunchOptions,
    getBrowser,
    isServerlessRuntime,
};
