const { chromium: playwrightChromium } = require("playwright");

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

function configuredExecutablePath() {
    return (
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        process.env.CHROMIUM_EXECUTABLE_PATH ||
        process.env.CHROME_EXECUTABLE_PATH ||
        null
    );
}

async function buildLaunchOptions() {
    const args = new Set(DEFAULT_ARGS);
    const executablePath = configuredExecutablePath();

    if (executablePath) {
        return {
            headless: true,
            executablePath,
            args: Array.from(args),
        };
    }

    if (isServerlessRuntime()) {
        const chromium = require("@sparticuz/chromium");
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

module.exports = {
    buildLaunchOptions,
    getBrowser,
    isServerlessRuntime,
};
