import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always load server/.env even when starting the process from repository root.
dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

// Also allow shell-provided variables and cwd-based .env behavior.
dotenv.config({ quiet: true });
