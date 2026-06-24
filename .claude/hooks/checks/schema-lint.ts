import { existsSync, readFileSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { execCommandAsync, formatResult, withTimeout, DECISION } from '../security-orchestrator.js';
import { getStagedFiles } from './git-policy.js';
import { classifyFiles, listTrackedFiles } from './file-patterns.js';
import { denyIfToolMissing, denyOnToolError } from './tools.js';
import type { CheckResult } from '../types.js';

export function findSchemaFile(filePath: string, cwd?: string): string | null {
  const absPath = filePath.startsWith('/') ? filePath : join(cwd ?? process.cwd(), filePath);
  const dir = dirname(absPath);
  const ext = extname(absPath);
  const baseName = basename(absPath, ext);

  if (ext === '.json') {
    try {
      const content = readFileSync(absPath, 'utf-8');
      const parsed = JSON.parse(content) as { $schema?: string };
      if (parsed.$schema) {
        if (parsed.$schema.startsWith('http://') || parsed.$schema.startsWith('https://')) {
          return parsed.$schema;
        }
        const schemaPath = join(dir, parsed.$schema);
        if (existsSync(schemaPath)) return schemaPath;
      }
    } catch {
      // JSON 解析失败，跳过
    }
  }

  const localSchema = join(dir, `${baseName}.schema.json`);
  if (existsSync(localSchema)) return localSchema;

  let rootDir = dir;
  for (let i = 0; i < 10; i++) {
    const parent = dirname(rootDir);
    if (parent === rootDir) break;
    if (existsSync(join(rootDir, 'package.json')) || existsSync(join(rootDir, '.git'))) break;
    rootDir = parent;
  }

  for (const schemaDir of ['schemas', '_schemas']) {
    const candidate = join(rootDir, schemaDir, `${baseName}.schema.json`);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

export async function runCheckJsonschema(
  filePath: string,
  schemaPath: string | null,
  format: 'json' | 'yaml',
  cwd?: string,
) {
  if (!schemaPath) {
    return { success: true, output: '', skipped: true };
  }

  const missing = denyIfToolMissing('check-jsonschema', 'schema-check-jsonschema', cwd);
  if (missing) {
    return { success: false, output: missing.message, skipped: false, deny: missing };
  }

  const formatFlag = format === 'yaml' ? '--format yaml ' : '';
  const result = await execCommandAsync(
    `bunx check-jsonschema ${formatFlag}--schemafile "${schemaPath}" "${filePath}"`,
    { cwd, timeout: 30000 },
  );
  return {
    success: result.success,
    output: (result.stderr || result.stdout).slice(0, 500),
    skipped: false,
  };
}

async function runSchemaChecks(jsonFiles: string[], yamlFiles: string[], idPrefix: string, cwd?: string) {
  const results: CheckResult[] = [];

  if (jsonFiles.length === 0 && yamlFiles.length === 0) {
    return formatResult(`${idPrefix}-schema`, DECISION.SKIP, '无 JSON/YAML 文件，跳过 schema 检查');
  }

  const schemaTargets: { file: string; format: 'json' | 'yaml' }[] = [
    ...jsonFiles.map((f) => ({ file: f, format: 'json' as const })),
    ...yamlFiles.map((f) => ({ file: f, format: 'yaml' as const })),
  ];

  const filesWithSchema = schemaTargets
    .map(({ file, format }) => ({ file, format, schema: findSchemaFile(file, cwd) }))
    .filter((t) => t.schema);

  if (filesWithSchema.length > 0) {
    const missing = denyIfToolMissing('check-jsonschema', `${idPrefix}-check-jsonschema`, cwd);
    if (missing) return missing;

    for (const { file, format, schema } of filesWithSchema) {
      try {
        const check = await withTimeout(
          runCheckJsonschema(file, schema, format, cwd),
          30000,
          `check-jsonschema 超时 (30s): ${file}`,
        );
        if (check.deny) return check.deny;
        results.push(
          check.success
            ? formatResult(`${idPrefix}-check-jsonschema`, DECISION.ALLOW, `Schema 验证通过: ${file}`)
            : formatResult(`${idPrefix}-check-jsonschema`, DECISION.DENY, `Schema 验证失败: ${file}`, {
                output: check.output,
              }),
        );
      } catch (e) {
        results.push(denyOnToolError(e, `${idPrefix}-check-jsonschema`, 'check-jsonschema'));
      }
    }
  }

  if (jsonFiles.length > 0) {
    const missing = denyIfToolMissing('jq', `${idPrefix}-jq`, cwd);
    if (missing) return missing;
    for (const file of jsonFiles) {
      try {
        const jqResult = await withTimeout(
          execCommandAsync(`jq empty "${file}"`, { cwd, timeout: 15000 }),
          15000,
          `jq 超时 (15s): ${file}`,
        );
        results.push(
          jqResult.success
            ? formatResult(`${idPrefix}-jq`, DECISION.ALLOW, `JSON 语法校验通过: ${file}`)
            : formatResult(`${idPrefix}-jq`, DECISION.DENY, `JSON 语法校验失败: ${file}`, {
                output: (jqResult.stderr || jqResult.stdout).slice(0, 500),
              }),
        );
      } catch (e) {
        results.push(denyOnToolError(e, `${idPrefix}-jq`, 'jq'));
      }
    }
  }

  if (yamlFiles.length > 0) {
    const missing = denyIfToolMissing('yq', `${idPrefix}-yq`, cwd);
    if (missing) return missing;
    for (const file of yamlFiles) {
      try {
        const yqResult = await withTimeout(
          execCommandAsync(`yq eval '.' "${file}" > /dev/null`, { cwd, timeout: 15000 }),
          15000,
          `yq 超时 (15s): ${file}`,
        );
        results.push(
          yqResult.success
            ? formatResult(`${idPrefix}-yq`, DECISION.ALLOW, `YAML 语法校验通过: ${file}`)
            : formatResult(`${idPrefix}-yq`, DECISION.DENY, `YAML 语法校验失败: ${file}`, {
                output: (yqResult.stderr || yqResult.stdout).slice(0, 500),
              }),
        );
      } catch (e) {
        results.push(denyOnToolError(e, `${idPrefix}-yq`, 'yq'));
      }
    }
  }

  const failure = results.find((r) => r.decision === DECISION.DENY);
  if (failure) return failure;
  if (results.length === 0) {
    return formatResult(`${idPrefix}-schema`, DECISION.SKIP, '无 schema 目标且语法检查跳过');
  }
  return formatResult(`${idPrefix}-schema`, DECISION.ALLOW, 'JSON/YAML schema 与语法检查通过');
}

export async function runSchemaLintStaged(cwd?: string) {
  const staged = getStagedFiles(cwd);
  const { json, yaml } = classifyFiles(staged, cwd);
  return runSchemaChecks(json, yaml, 'schema-staged', cwd);
}

export async function runSchemaLintFull(cwd?: string) {
  const json = listTrackedFiles((f) => f.endsWith('.json') && !f.endsWith('.schema.json'), cwd);
  const yaml = listTrackedFiles((f) => /\.(yaml|yml)$/i.test(f), cwd);
  return runSchemaChecks(json, yaml, 'schema-full', cwd);
}
