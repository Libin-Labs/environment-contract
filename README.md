# @lp-labs/environment-contract

Explicit startup validation for environment strings and synchronous runtime feature probes.
Independent, framework-neutral implementation with zero runtime or peer dependencies.
Never reads `process.env` or global capabilities automatically.

## Install

```bash
npm install @lp-labs/environment-contract
```

ES2022 ESM/CommonJS and TypeScript declarations. CommonJS uses
`const { createContract } = require('@lp-labs/environment-contract')`.

## Quickstart

```js
import { createContract } from '@lp-labs/environment-contract';

const contract = createContract({
  PORT: { type: 'number', integer: true, min: 1, max: 65535, default: 8080 },
  MODE: { type: 'enum', values: ['development', 'production'], required: true },
  TOKEN: { type: 'string', required: true, sensitive: true },
});
const report = contract.inspect({ MODE: 'production', TOKEN: 'example-only' });
if (!report.valid) throw new Error('Invalid startup configuration');
if (report.values.PORT !== 8080 || report.diagnostics.TOKEN !== '[REDACTED]') {
  throw new Error('Contract output mismatch');
}
```

Pass `process.env` explicitly on Node or a build-generated plain string record in a browser.
Never embed server secrets in a frontend bundle.

## Definitions and customization

`createContract(definition: Record<string, Field>, options?: ContractOptions): EnvironmentContract`

Definition keys are nonempty strings up to 256 UTF-16 units. Definition/field objects must be
plain own enumerable data records; symbols, getters and unknown field options are rejected.
All fields support `required?: boolean`, typed `default?` and `sensitive?: boolean`.

| `type`      | Additional options          | Parsing and validation                                                                                       |
| ----------- | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `'string'`  | `pattern?: string`          | Maximum 65536 units; optional Unicode regex, tested as written (add anchors to require whole-value matches). |
| `'number'`  | `integer?`, `min?`, `max?`  | Finite decimal/exponent grammar; integer requires a safe integer; bounds inclusive.                          |
| `'boolean'` | none                        | Exactly `'true'` or `'false'`, case-sensitive.                                                               |
| `'enum'`    | `values: readonly string[]` | Exact case-sensitive membership in 1..1000 strings, each up to 4096 units.                                   |

Numeric values permit signs, fractions and exponents; no whitespace trimming, hex, empty-string
coercion, Infinity or NaN. Empty strings are present, not missing, and may be valid string/enum
values. Missing own properties and `undefined` use a valid default, otherwise produce a missing
issue if required. Optional absent fields are omitted. Defaults must already have the declared
JavaScript type; number defaults are numbers, not environment strings.

Options:

- `maxFields = 1000`: non-negative safe integer limit for definitions and, separately, probes.
- `features = []`: `{ id, probe: () => boolean }[]`. IDs are unique nonempty strings up to
  256 units. Probes run on every inspection/assertion, never during contract creation.

```js
import { createContract, EnvironmentContractError } from '@lp-labs/environment-contract';

const contract = createContract(
  { ENABLED: { type: 'boolean', default: false } },
  { features: [{ id: 'array-at', probe: () => typeof Array.prototype.at === 'function' }] },
);
const values = contract.assert({});
if (values.ENABLED !== false) throw new Error('Wrong typed default');
try {
  contract.assert({ ENABLED: 'yes' });
  throw new Error('Invalid boolean accepted');
} catch (error) {
  if (!(error instanceof EnvironmentContractError)) throw error;
  if (error.issues[0].code !== 'invalid') throw new Error('Missing issue');
}
```

## Inspection, assertions and privacy

- `inspect(environment: Environment): ContractResult` returns
  `{ valid, values, diagnostics, issues }`.
- `values` contains only successfully validated fields. **It includes actual sensitive values.**
- `diagnostics` is a separate record replacing successful sensitive values with `'[REDACTED]'`.
- `issues` contains `{ key, code: 'missing' | 'invalid' | 'feature', message }`, never raw values.
- `assert(environment)` returns `values` when valid; otherwise throws
  `EnvironmentContractError` with `issues`. Do not log returned values as diagnostics.
- Unrelated environment properties are ignored. Inherited fields do not satisfy contracts.
  Requested accessors and non-string/non-undefined input values throw `TypeError`.

Malformed definitions/probes, nonboolean probe results and invalid defaults throw.
Probe exceptions propagate unchanged; they are programming/runtime errors rather than
success-shaped unsupported-feature results. Probes must be synchronous and trusted.

## Performance and scope

Inspection is O(F + P) plus regex/probe work, using O(F + P) output memory.
Patterns are limited to 256 units, but regex execution has **no timeout or complexity guarantee**;
use only trusted, reviewed patterns and bounded inputs. This is not a hardened execution sandbox.
Snapshots do not expose mutable internal definitions.

No dotenv parser, file loading, asynchronous probes, environment mutation, secret storage,
remote capability negotiation or dynamic dependency installation is included.

Exported types: `Environment`, `Field`, `Feature`, `ContractOptions`, `ContractIssue`,
`ContractResult`, `EnvironmentContract`. Runtime exports: `createContract`, `EnvironmentContractError`.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
