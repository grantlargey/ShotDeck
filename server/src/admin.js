import "./env.js";
import { pool } from "./db.js";
import { createOwner, listAdmins, resetPasswordByEmail } from "./services/auth.service.js";
import { hashPassword, passwordProblem } from "./utils/passwords.js";

/*
 * Admin account CLI. This is the only way to create the owner account.
 *
 *   node src/admin.js hash                                   Print the scrypt hash of a password
 *   node src/admin.js create-owner --email E [--password-hash H]
 *   node src/admin.js reset-password --email E [--password-hash H]
 *   node src/admin.js list
 *
 * Without --password-hash, the password is read from the ADMIN_PASSWORD
 * environment variable or, at a terminal, from a hidden prompt. Make the hash
 * with `hash` and pass --password-hash when an interactive prompt isn't available.
 */

const USAGE = `Usage:
  node src/admin.js hash
  node src/admin.js create-owner --email <email> [--password-hash <hash>]
  node src/admin.js reset-password --email <email> [--password-hash <hash>]
  node src/admin.js list

Set ADMIN_PASSWORD to skip the password prompt.`;

function parseArgs(argv) {
    const [command, ...rest] = argv;
    const options = {};
    for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i];
        if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
        const name = arg.slice(2);
        const value = rest[i + 1];
        if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
        options[name] = value;
        i += 1;
    }
    return { command, options };
}

function promptSecret(question) {
    return new Promise((resolve, reject) => {
        const { stdin, stdout } = process;
        if (!stdin.isTTY) {
            reject(new Error("No terminal to prompt in. Set ADMIN_PASSWORD or pass --password-hash."));
            return;
        }
        stdout.write(question);
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding("utf8");
        let value = "";

        const finish = () => {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off("data", onData);
            stdout.write("\n");
        };
        function onData(chunk) {
            for (const char of chunk) {
                if (char === "") {
                    finish();
                    process.exit(130);
                }
                if (char === "\r" || char === "\n") {
                    finish();
                    resolve(value);
                    return;
                }
                if (char === "" || char === "\b") value = value.slice(0, -1);
                else value += char;
            }
        }
        stdin.on("data", onData);
    });
}

async function readPasswordHash(options) {
    if (options["password-hash"]) return options["password-hash"];

    let password = process.env.ADMIN_PASSWORD;
    if (!password) {
        password = await promptSecret("Password: ");
        const confirmation = await promptSecret("Confirm password: ");
        if (password !== confirmation) throw new Error("The passwords don't match.");
    }
    const problem = passwordProblem(password);
    if (problem) throw new Error(problem);
    return hashPassword(password);
}

function requireEmail(options) {
    if (!options.email) throw new Error("--email is required.");
    return options.email;
}

async function main() {
    const { command, options } = parseArgs(process.argv.slice(2));

    switch (command) {
        case "hash": {
            const hash = await readPasswordHash(options);
            console.log(hash);
            return;
        }
        case "create-owner": {
            const email = requireEmail(options);
            const passwordHash = await readPasswordHash(options);
            const user = await createOwner(pool, { email, passwordHash });
            console.log(`Created owner ${user.email} (${user.id}).`);
            return;
        }
        case "reset-password": {
            const email = requireEmail(options);
            const passwordHash = await readPasswordHash(options);
            const user = await resetPasswordByEmail(pool, { email, passwordHash });
            console.log(`Password updated for ${user.email}. Existing sessions were signed out.`);
            return;
        }
        case "list": {
            const rows = await listAdmins(pool);
            if (rows.length === 0) {
                console.log("No admin accounts yet.");
                return;
            }
            for (const row of rows) {
                const status = row.disabled_at ? "disabled" : "active";
                const lastLogin = row.last_login_at ? new Date(row.last_login_at).toISOString() : "never";
                console.log(`${row.email}\t${row.role}\t${status}\tlast sign-in ${lastLogin}`);
            }
            return;
        }
        default:
            throw new Error(command ? `Unknown command: ${command}\n\n${USAGE}` : USAGE);
    }
}

try {
    await main();
} catch (err) {
    console.error(err?.message || err);
    process.exitCode = 1;
} finally {
    await pool.end();
}
