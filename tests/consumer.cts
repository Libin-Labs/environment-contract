import { createContract } from '@lp-labs/environment-contract';
const result: boolean = createContract({}).inspect({}).valid;
void result;
