import { readFileSync } from 'node:fs';
import { Ajv, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import { parse } from 'yaml';
import type { Response } from 'supertest';
import { expect } from 'vitest';

// Contrôle de conformité des réponses au contrat specification/openapi.yml
// (OpenAPI 3.0.3) : le statut doit être déclaré pour l'opération, le corps
// doit valider le schéma déclaré, et un 429 doit porter Retry-After.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;

const document = parse(readFileSync(new URL('../../specification/openapi.yml', import.meta.url), 'utf8')) as JsonObject;

// OAS 3.0 → JSON Schema : `nullable`, `exclusiveMinimum` booléen, et mots-clés
// propres à OpenAPI ignorés.
function convert(node: Json): Json {
  if (Array.isArray(node)) return node.map(convert);
  if (node === null || typeof node !== 'object') return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'nullable' || key === 'example' || key === 'deprecated') continue;
    out[key] = convert(value);
  }
  if (node.exclusiveMinimum === true && typeof node.minimum === 'number') {
    out.exclusiveMinimum = node.minimum;
    delete out.minimum;
  }
  if (node.nullable === true) {
    return { anyOf: [{ type: 'null' }, out] };
  }
  return out;
}

const components = (document.components as JsonObject).schemas as JsonObject;
const root = {
  $id: 'openapi',
  components: { schemas: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, convert(v)])) },
};

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addFormat('password', true);
ajv.addSchema(root);

function resolveRef<T extends Json>(node: T): T {
  if (node && typeof node === 'object' && !Array.isArray(node) && typeof node.$ref === 'string') {
    const path = node.$ref.replace(/^#\//, '').split('/');
    let target: Json = document;
    for (const segment of path) target = (target as JsonObject)[segment] as Json;
    return resolveRef(target as T);
  }
  return node;
}

const validators = new Map<string, ValidateFunction>();

function validatorFor(schema: JsonObject, cacheKey: string): ValidateFunction {
  let validator = validators.get(cacheKey);
  if (!validator) {
    const rewritten = JSON.parse(JSON.stringify(convert(schema)).replaceAll('"#/components/', '"openapi#/components/')) as object;
    validator = ajv.compile(rewritten);
    validators.set(cacheKey, validator);
  }
  return validator;
}

// `path` est le chemin du contrat (ex. `/sync/changes`), sans le préfixe /v1.
export function expectConformant(res: Response, method: string, path: string): void {
  const paths = document.paths as JsonObject;
  const operation = (paths[path] as JsonObject | undefined)?.[method.toLowerCase()] as JsonObject | undefined;
  expect(operation, `opération ${method} ${path} absente du contrat`).toBeDefined();
  const responses = operation!.responses as JsonObject;
  const status = String(res.status);
  const declared = responses[status];
  expect(declared, `statut ${status} non déclaré pour ${method} ${path}`).toBeDefined();
  const response = resolveRef(declared as JsonObject);

  const content = response.content as JsonObject | undefined;
  if (!content) {
    expect(res.text ?? '', `${method} ${path} ${status} ne doit pas avoir de corps`).toBe('');
    return;
  }
  const schema = (content['application/json'] as JsonObject).schema as JsonObject;
  const validate = validatorFor(schema, `${method} ${path} ${status}`);
  const valid = validate(res.body);
  expect(valid, `${method} ${path} ${status} : ${ajv.errorsText(validate.errors)}\n${JSON.stringify(res.body).slice(0, 2000)}`).toBe(true);

  const headers = response.headers as JsonObject | undefined;
  if (headers?.['Retry-After']) {
    const retryAfter = Number(res.headers['retry-after']);
    expect(Number.isInteger(retryAfter) && retryAfter >= 1, 'Retry-After entier ≥ 1').toBe(true);
  }
}
