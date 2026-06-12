import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;

const manifestPath = join(root, "src", "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

manifest.version = version;

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

execSync("git add src/manifest.json", { cwd: root, stdio: "inherit" });

console.log(`Updated src/manifest.json to version ${version}`);
