import { fuzzFile } from '../../packages/kernel/test/exact-round-fuzz.kit';
fuzzFile(Number(process.env.A), Number(process.env.B));
