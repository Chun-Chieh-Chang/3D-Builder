import { installDwg } from '../apps/mcp/src/dwgSetup.ts';

console.log(`LibreDWG installed at ${await installDwg(process.argv[2])}`);
