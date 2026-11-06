import {
  createContract,
  EnvironmentContractError,
  type ContractResult,
} from '@lp-labs/environment-contract';
const contract = createContract({ PORT: { type: 'number', default: 80 } });
const report: ContractResult = contract.inspect({ PORT: '8080' });
// @ts-expect-error typed defaults match the declared field.
createContract({ PORT: { type: 'number', default: '80' } });
void [report, EnvironmentContractError];
