/**
 * Local invoke — run the Lambda handler directly without Docker/LocalStack.
 *
 * Usage:
 *   cp .env.example .env   # add your API key
 *   npx tsx scripts/invoke-local.ts
 */

import { config } from "dotenv";
config(); // Load .env

import { handler } from "../src/index.js";

async function main() {
  console.log("Invoking Claude Metrics Lambda locally...\n");

  const result = await handler();

  if (result.statusCode !== 200) {
    console.error(`Error (${result.statusCode}):`);
    console.error(result.body);
    process.exit(1);
  }

  console.log(result.body);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
