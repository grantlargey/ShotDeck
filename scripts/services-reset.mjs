/*
 * Guarded `docker compose down -v`.
 *
 * Deleting the Compose volumes throws away the whole local database and every
 * uploaded file, with no backup, so this prints what is about to go and waits
 * for the word "reset" before running anything. Pass --yes to skip the prompt
 * (scripts, CI); without a terminal that flag is the only way through.
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const CONFIRMATION = "reset";

const VOLUMES = [
    { name: "scriptdeck_pgdata", holds: "the database: projects, scripts, captured scenes, stills, your admin account" },
    { name: "scriptdeck_s3data", holds: "every upload: covers, screenplay PDFs, stills, generated thumbnails" },
];

/** Size of a named volume as Docker reports it, or null when it does not exist. */
function volumeSize(name) {
    const result = spawnSync("docker", ["system", "df", "-v", "--format", "{{json .Volumes}}"], {
        encoding: "utf8",
    });
    if (result.status !== 0) return null;
    try {
        const found = JSON.parse(result.stdout).find((volume) => volume.Name === name);
        return found ? found.Size : null;
    } catch {
        return null;
    }
}

function warn() {
    console.log("");
    console.log("  npm run services:reset  ->  docker compose down -v");
    console.log("");
    console.log("  This permanently deletes both Docker volumes. There is no undo and no backup:");
    console.log("");
    for (const volume of VOLUMES) {
        const size = volumeSize(volume.name);
        const label = size ? `${volume.name} (${size})` : `${volume.name} (not created yet)`;
        console.log(`    - ${label}`);
        console.log(`        ${volume.holds}`);
    }
    console.log("");
    console.log("  Most problems do not need this:");
    console.log("    - free the ports, stop working    ->  npm run services:stop");
    console.log("    - pick up new migrations          ->  npm run db:migrate");
    console.log("    - a wedged container              ->  docker compose restart db s3");
    console.log("    - a missing bucket                ->  npm run services:up");
    console.log("");
    console.log("  Afterwards you are back at a fresh clone: npm run services:up && npm run db:migrate,");
    console.log("  then npm run admin -- create-owner to recreate your login.");
    console.log("");
}

async function confirmed() {
    if (process.argv.slice(2).includes("--yes")) return true;

    if (!process.stdin.isTTY) {
        console.error("  Refusing to reset without a terminal to confirm at. Re-run with --yes if you mean it.");
        console.error("");
        return false;
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answer = "";
    try {
        answer = await rl.question(`  Type ${CONFIRMATION} to delete this data, or anything else to cancel: `);
    } catch {
        // Ctrl+C or Ctrl+D at the prompt: treat it as the cancellation it is.
    } finally {
        rl.close();
    }

    console.log("");
    if (answer.trim() === CONFIRMATION) return true;
    console.log("  Cancelled. Nothing was deleted.");
    console.log("");
    return false;
}

warn();
if (!(await confirmed())) process.exit(1);

const down = spawnSync("docker", ["compose", "down", "-v"], { stdio: "inherit" });
process.exit(down.status ?? 1);
