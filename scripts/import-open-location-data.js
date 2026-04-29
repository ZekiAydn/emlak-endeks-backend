#!/usr/bin/env node
import {
    FREE_LOCATION_DATA_SOURCES,
    importNufusuneAll,
    importNufusuneCity,
    importNufusuneDistrict,
} from "../src/services/openLocationData.js";

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i += 1) {
        const item = argv[i];
        if (!item.startsWith("--")) continue;

        const key = item.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
            args[key] = true;
        } else {
            args[key] = next;
            i += 1;
        }
    }
    return args;
}

function usage() {
    return `
Usage:
  node scripts/import-open-location-data.js --source nufusune --city istanbul --district pendik --dry-run
  node scripts/import-open-location-data.js --source nufusune --city istanbul --limit-districts 3
  node scripts/import-open-location-data.js --source nufusune --all --delay-ms 400

Options:
  --source nufusune       Current enabled source.
  --city <name>           City name or slug.
  --district <name>       District name or slug.
  --all                   Import every city discovered from nufusune.com.
  --dry-run               Fetch and parse without writing to DB.
  --upsert-existing       Update existing rows instead of insert-only skip duplicates.
  --limit-cities <n>      Safety limiter for --all.
  --limit-districts <n>   Safety limiter for city import.
  --delay-ms <n>          Delay after each request. Default: 350.
  --sources               Print known free/open source registry.
`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || args.h) {
        console.log(usage());
        return;
    }

    if (args.sources) {
        console.log(JSON.stringify(FREE_LOCATION_DATA_SOURCES, null, 2));
        return;
    }

    const source = String(args.source || "nufusune").toLowerCase();
    if (source !== "nufusune") {
        throw new Error(`Unsupported source "${source}". Use --sources to inspect available source statuses.`);
    }

    const options = {
        dryRun: Boolean(args["dry-run"]),
        upsertExisting: Boolean(args["upsert-existing"]),
        delayMs: Number(args["delay-ms"] || 350),
        limitCities: args["limit-cities"] ? Number(args["limit-cities"]) : null,
        limitDistricts: args["limit-districts"] ? Number(args["limit-districts"]) : null,
    };

    let result;
    if (args.all) {
        result = await importNufusuneAll(options);
    } else if (args.city && args.district) {
        result = await importNufusuneDistrict({
            ...options,
            city: args.city,
            district: args.district,
        });
    } else if (args.city) {
        result = await importNufusuneCity({
            ...options,
            city: args.city,
        });
    } else {
        console.log(usage());
        throw new Error("Missing --city or --all.");
    }

    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch((error) => {
        console.error(error?.stack || error?.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        const prisma = await import("../src/prisma.js").then((mod) => mod.default).catch(() => null);
        if (prisma) await prisma.$disconnect().catch(() => {});
    });
