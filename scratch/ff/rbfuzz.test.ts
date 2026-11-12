// Scratch run of the rolling-ball recognition fuzz to measure rates before the files are fixed. FROM/TO.
import { fuzzFile } from '../../tests/phase8/recognize-rolling-ball.kit';
fuzzFile(Number(process.env.FROM ?? 1), Number(process.env.TO ?? 10));
