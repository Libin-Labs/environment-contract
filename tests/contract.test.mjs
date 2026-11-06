import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createContract, EnvironmentContractError } from '../dist/esm/index.js';
test('types parse explicit decimal/exponent, strict booleans and exact enumerations', () => {
  const contract = createContract({
    PORT: { type: 'number', integer: true, min: 1, max: 65535, required: true },
    ENABLED: { type: 'boolean' },
    MODE: { type: 'enum', values: ['dev', 'prod'] },
    RATE: { type: 'number' },
  });
  assert.deepEqual(
    contract.assert({ PORT: '8080', ENABLED: 'false', MODE: 'prod', RATE: '1e-2' }),
    { PORT: 8080, ENABLED: false, MODE: 'prod', RATE: 0.01 },
  );
});
test('defaults are typed, missing optional fields omitted and required issues explicit', () => {
  const contract = createContract({
    A: { type: 'string', required: true },
    B: { type: 'number', default: 10 },
    C: { type: 'boolean' },
  });
  const report = contract.inspect({});
  assert.equal(report.valid, false);
  assert.deepEqual(report.values, { B: 10 });
  assert.deepEqual(report.issues, [
    { key: 'A', code: 'missing', message: 'Required environment field is absent.' },
  ]);
  assert.throws(() => contract.assert({}), EnvironmentContractError);
});
test('whitespace, hex, nonfinite numbers and truthy booleans are not silently coerced', () => {
  const number = createContract({ X: { type: 'number' } }),
    boolean = createContract({ X: { type: 'boolean' } });
  for (const X of ['', ' ', '0x10', 'Infinity', 'NaN', ' 10 ', '1e999'])
    assert.equal(number.inspect({ X }).valid, false, X);
  for (const X of ['1', '0', 'TRUE', 'yes', ''])
    assert.equal(boolean.inspect({ X }).valid, false, X);
});
test('string constraints and enum membership apply to defaults and runtime fields', () => {
  const contract = createContract({ X: { type: 'string', pattern: '^[a-z]+$' } });
  assert.equal(contract.inspect({ X: 'hello' }).valid, true);
  assert.equal(contract.inspect({ X: '123' }).valid, false);
  assert.throws(() => createContract({ X: { type: 'string', pattern: '[' } }), SyntaxError);
  assert.throws(
    () => createContract({ X: { type: 'enum', values: ['a'], default: 'b' } }),
    TypeError,
  );
  assert.throws(() => createContract({ X: { type: 'number', default: '10' } }), TypeError);
});
test('sensitive diagnostics and errors never contain supplied field values', () => {
  const contract = createContract({
    TOKEN: { type: 'string', sensitive: true },
    N: { type: 'number', sensitive: true },
  });
  const report = contract.inspect({ TOKEN: 'private-token', N: 'invalid-private' });
  assert.equal(report.values.TOKEN, 'private-token');
  assert.equal(report.diagnostics.TOKEN, '[REDACTED]');
  assert.equal(JSON.stringify(report.issues).includes('invalid-private'), false);
  assert.throws(
    () => contract.assert({ N: 'private' }),
    (error) => !JSON.stringify(error).includes('private'),
  );
});
test('feature probes run only on inspection and exceptions propagate', () => {
  let calls = 0;
  const contract = createContract(
    {},
    {
      features: [
        {
          id: 'fetch',
          probe() {
            calls++;
            return false;
          },
        },
      ],
    },
  );
  assert.equal(calls, 0);
  assert.equal(contract.inspect({}).issues[0].code, 'feature');
  assert.equal(calls, 1);
  assert.throws(
    () =>
      createContract(
        {},
        {
          features: [
            {
              id: 'x',
              probe() {
                throw new Error('probe');
              },
            },
          ],
        },
      ).inspect({}),
    /probe/,
  );
  assert.throws(
    () => createContract({}, { features: [{ id: 'x', probe: () => 1 }] }).inspect({}),
    TypeError,
  );
});
test('enum options and definitions are copied and outputs are independent', () => {
  const field = { type: 'enum', values: ['a'] },
    contract = createContract({ X: field });
  field.values.push('b');
  field.type = 'string';
  assert.equal(contract.inspect({ X: 'b' }).valid, false);
  const report = contract.inspect({ X: 'a' });
  report.values.X = 'b';
  assert.equal(contract.assert({ X: 'a' }).X, 'a');
});
test('own-key handling ignores inherited values and rejects accessors without invoking them', () => {
  const contract = createContract(JSON.parse('{"__proto__":{"type":"string","required":true}}'));
  assert.equal(contract.inspect({}).valid, false);
  assert.equal(contract.assert(JSON.parse('{"__proto__":"ok"}')).__proto__, 'ok');
  let called = false;
  const environment = Object.defineProperty({}, '__proto__', {
    get() {
      called = true;
      return 'x';
    },
  });
  assert.throws(() => contract.inspect(environment), TypeError);
  assert.equal(called, false);
});
test('invalid definitions and capacities fail before any probe runs', () => {
  assert.throws(() => createContract({ X: { type: 'number', min: 2, max: 1 } }), RangeError);
  assert.throws(() => createContract({ X: { type: 'string', typo: true } }), TypeError);
  assert.throws(() => createContract({ X: { type: 'enum', values: [] } }), TypeError);
  assert.throws(() => createContract({ X: { type: 'boolean', integer: true } }), TypeError);
  assert.throws(() => createContract({ X: { type: 'string' } }, { maxFields: 0 }), RangeError);
  assert.throws(
    () =>
      createContract(
        {},
        {
          features: [
            { id: 'a', probe: () => true },
            { id: 'a', probe: () => true },
          ],
        },
      ),
    TypeError,
  );
  assert.throws(() => createContract({ X: { type: 'number' } }).inspect({ X: 1 }), TypeError);
});
test('CommonJS supports explicit startup assertions', () => {
  const api = createRequire(import.meta.url)('../dist/cjs/index.js');
  assert.equal(api.createContract({ X: { type: 'boolean', default: true } }).assert({}).X, true);
});
