const { spawnSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

mkdirSync(".data", { recursive: true });
if (!process.env.LIBSQL_URL) process.env.LIBSQL_URL = "file:./.data/worker.db";

const mig = spawnSync(process.execPath, ["scripts/migrate-libsql.mjs"], {
  stdio: "inherit",
  env: process.env,
});
if (mig.status !== 0) process.exit(mig.status ?? 1);

import(pathToFileURL(path.join(__dirname, "dist", "server.mjs")).href).catch((err) => {
  console.error(err);
  process.exit(1);
});
