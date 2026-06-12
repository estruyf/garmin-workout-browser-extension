import { execSync } from "child_process";
import { mkdirSync, readFileSync } from "fs";
import { join, resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const manifestPath = join(root, "dist", "chromium", "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const version = manifest.version;

const releasesDir = join(root, "releases");
mkdirSync(releasesDir, { recursive: true });

const outputFile = join(releasesDir, `garmin-workout-importer-v${version}.zip`);

execSync(`zip -r "${outputFile}" . -x "*.DS_Store"`, {
  cwd: join(root, "dist", "chromium"),
  stdio: "inherit",
});

console.log(`Created: releases/garmin-workout-importer-v${version}.zip`);
