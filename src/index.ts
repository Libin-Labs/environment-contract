export type Environment = Readonly<Record<string, string | undefined>>;
export type Field =
  | { type: 'string'; required?: boolean; default?: string; sensitive?: boolean; pattern?: string }
  | {
      type: 'number';
      required?: boolean;
      default?: number;
      sensitive?: boolean;
      integer?: boolean;
      min?: number;
      max?: number;
    }
  | { type: 'boolean'; required?: boolean; default?: boolean; sensitive?: boolean }
  | {
      type: 'enum';
      values: readonly string[];
      required?: boolean;
      default?: string;
      sensitive?: boolean;
    };
export interface Feature {
  id: string;
  probe: () => boolean;
}
export interface ContractOptions {
  features?: readonly Feature[];
  maxFields?: number;
}
export interface ContractIssue {
  key: string;
  code: 'missing' | 'invalid' | 'feature';
  message: string;
}
export interface ContractResult {
  valid: boolean;
  values: Record<string, string | number | boolean>;
  issues: ContractIssue[];
  diagnostics: Record<string, string | number | boolean>;
}
export class EnvironmentContractError extends Error {
  constructor(readonly issues: readonly ContractIssue[]) {
    super('Environment contract failed. Inspect redacted issues.');
    this.name = 'EnvironmentContractError';
  }
}
export interface EnvironmentContract {
  inspect(environment: Environment): ContractResult;
  assert(environment: Environment): Record<string, string | number | boolean>;
}
function dataEntries(input: object): [string, unknown][] {
  if (
    !input ||
    typeof input !== 'object' ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  )
    throw new TypeError('Expected a plain record.');
  return Reflect.ownKeys(input).map((key) => {
    if (typeof key !== 'string' || !key || key.length > 256)
      throw new TypeError('Keys must be nonempty strings up to 256 units.');
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!descriptor.enumerable || !('value' in descriptor))
      throw new TypeError('Expected enumerable data properties.');
    return [key, descriptor.value];
  });
}
export function createContract(
  definition: Readonly<Record<string, Field>>,
  options: ContractOptions = {},
): EnvironmentContract {
  const maximum = options.maxFields ?? 1000;
  if (!Number.isSafeInteger(maximum) || maximum < 0)
    throw new RangeError('maxFields must be non-negative.');
  const entries = dataEntries(definition);
  if (entries.length > maximum) throw new RangeError('Contract exceeds maxFields.');
  const fields = entries.map(([key, raw]) => {
    const values = Object.fromEntries(dataEntries(raw as object));
    for (const flag of ['required', 'sensitive', 'integer'])
      if (values[flag] !== undefined && typeof values[flag] !== 'boolean')
        throw new TypeError(`Invalid ${flag} option.`);
    const type = values.type;
    const allowed = [
      'type',
      'required',
      'default',
      'sensitive',
      ...(type === 'string'
        ? ['pattern']
        : type === 'number'
          ? ['integer', 'min', 'max']
          : type === 'enum'
            ? ['values']
            : []),
    ];
    if (Object.keys(values).some((name) => !allowed.includes(name)))
      throw new TypeError('Unknown field option.');
    if (typeof type !== 'string' || !['string', 'number', 'boolean', 'enum'].includes(type))
      throw new TypeError('Unknown field type.');
    if (type === 'enum') {
      if (
        !Array.isArray(values.values) ||
        !values.values.length ||
        values.values.length > 1000 ||
        Array.from(values.values).some((item) => typeof item !== 'string' || item.length > 4096)
      )
        throw new TypeError('Enum requires 1..1000 bounded string choices.');
      values.values = [...values.values];
    }
    if (type === 'number') {
      for (const bound of ['min', 'max'])
        if (
          values[bound] !== undefined &&
          (typeof values[bound] !== 'number' || !Number.isFinite(values[bound]))
        )
          throw new TypeError('Bounds must be finite.');
      if (
        typeof values.min === 'number' &&
        typeof values.max === 'number' &&
        values.min > values.max
      )
        throw new RangeError('min exceeds max.');
    }
    let pattern: RegExp | undefined;
    if (values.pattern !== undefined) {
      if (typeof values.pattern !== 'string' || values.pattern.length > 256)
        throw new TypeError('Invalid pattern.');
      pattern = new RegExp(values.pattern, 'u');
    }
    const accept = (value: unknown) => {
      if (type === 'string')
        return (
          typeof value === 'string' && value.length <= 65_536 && (!pattern || pattern.test(value))
        );
      if (type === 'boolean') return typeof value === 'boolean';
      if (type === 'enum')
        return typeof value === 'string' && (values.values as string[]).includes(value);
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (!values.integer || Number.isSafeInteger(value)) &&
        (values.min === undefined || value >= (values.min as number)) &&
        (values.max === undefined || value <= (values.max as number))
      );
    };
    if (Object.hasOwn(values, 'default') && !accept(values.default))
      throw new TypeError(`Invalid default for ${key}.`);
    return { key, values, accept };
  });
  const features = [...(options.features ?? [])];
  if (features.length > maximum) throw new RangeError('Too many features.');
  const featureIds = new Set<string>();
  const probes = features.map((feature) => {
    if (
      typeof feature.id !== 'string' ||
      !feature.id ||
      feature.id.length > 256 ||
      typeof feature.probe !== 'function'
    )
      throw new TypeError('Invalid feature probe.');
    if (featureIds.has(feature.id)) throw new TypeError('Duplicate feature.');
    featureIds.add(feature.id);
    return { id: feature.id, probe: feature.probe };
  });
  const inspect = (environment: Environment): ContractResult => {
    if (!environment || typeof environment !== 'object')
      throw new TypeError('Expected an environment record.');
    const values: [string, string | number | boolean][] = [],
      diagnostics: [string, string | number | boolean][] = [];
    const issues: ContractIssue[] = [];
    for (const { key, values: config, accept } of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(environment, key);
      if (descriptor && !('value' in descriptor))
        throw new TypeError('Environment accessors are not supported.');
      const raw: unknown = descriptor?.value;
      let value: unknown;
      if (raw === undefined) {
        if (Object.hasOwn(config, 'default')) value = config.default;
        else {
          if (config.required)
            issues.push({ key, code: 'missing', message: 'Required environment field is absent.' });
          continue;
        }
      } else {
        if (typeof raw !== 'string')
          throw new TypeError('Environment values must be strings or undefined.');
        value = raw;
        if (config.type === 'number')
          value = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) ? Number(raw) : NaN;
        if (config.type === 'boolean')
          value = raw === 'true' ? true : raw === 'false' ? false : undefined;
      }
      if (!accept(value)) {
        issues.push({
          key,
          code: 'invalid',
          message: 'Environment field does not satisfy its declared type or constraints.',
        });
        continue;
      }
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
        throw new TypeError('Internal contract value error.');
      values.push([key, value]);
      diagnostics.push([key, config.sensitive ? '[REDACTED]' : value]);
    }
    for (const feature of probes) {
      const supported = feature.probe();
      if (typeof supported !== 'boolean')
        throw new TypeError('Feature probes must return booleans synchronously.');
      if (!supported)
        issues.push({
          key: feature.id,
          code: 'feature',
          message: 'Required runtime feature is unavailable.',
        });
    }
    return {
      valid: issues.length === 0,
      values: Object.fromEntries(values),
      diagnostics: Object.fromEntries(diagnostics),
      issues,
    };
  };
  return {
    inspect,
    assert(environment) {
      const report = inspect(environment);
      if (!report.valid) throw new EnvironmentContractError(report.issues);
      return report.values;
    },
  };
}
