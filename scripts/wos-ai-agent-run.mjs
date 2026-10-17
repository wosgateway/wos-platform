#!/usr/bin/env node
// npm run ai:agent -- "ตรวจสอบและแก้ regression ..."   One command: reproduce -> root cause -> patch -> verify -> report -> STOP.
import { main } from "./overnight/cli.mjs";
process.exit(await main(process.argv.slice(2), "agent"));
