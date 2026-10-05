// app.js - Fallback entry point for Hostinger Node.js Application
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const distServer = path.join(__dirname, "dist", "server.cjs");
if (fs.existsSync(distServer)) {
  require(distServer);
} else {
  console.error("Error: dist/server.cjs was not found.");
  console.error("Please run 'npm run build' before starting the production server.");
  process.exit(1);
}

