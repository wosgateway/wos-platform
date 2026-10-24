#!/usr/bin/env node
// npm run ai:overnight -- --task "..." --max-iterations 8 --timeout 6h      (DEV only; never commits/pushes/deploys)
import { main } from "./overnight/cli.mjs";
process.exit(await main(process.argv.slice(2), "overnight"));
