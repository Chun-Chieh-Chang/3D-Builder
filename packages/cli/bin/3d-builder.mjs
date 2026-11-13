#!/usr/bin/env node
import { main } from '../../../apps/mcp/dist/headless.mjs';
await main(process.argv.slice(2));
