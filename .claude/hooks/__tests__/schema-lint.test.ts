import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findSchemaFile, runCheckJsonschema, runSchemaLintStaged, runSchemaLintFull } from '../checks/schema-lint.js';
import { DECISION } from '../security-orchestrator.js';
import { getToolInstallHint } from '../checks/tools.js';

describe('schema-lint', () => {
  describe('findSchemaFile', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'findschema-test-'));
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('无 Schema 时应返回 null', () => {
      const jsonFile = join(tmpDir, 'config.json');
      writeFileSync(jsonFile, '{"key": "value"}');
      expect(findSchemaFile(jsonFile)).toBeNull();
    });

    it('应从 JSON $schema 字段解析 URL', () => {
      const jsonFile = join(tmpDir, 'config.json');
      writeFileSync(
        jsonFile,
        JSON.stringify({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          key: 'value',
        }),
      );
      expect(findSchemaFile(jsonFile)).toBe('https://json-schema.org/draft/2020-12/schema');
    });

    it('应从 JSON $schema 字段解析本地路径', () => {
      const schemaFile = join(tmpDir, 'config.schema.json');
      writeFileSync(schemaFile, JSON.stringify({ type: 'object' }));
      const jsonFile = join(tmpDir, 'config.json');
      writeFileSync(jsonFile, JSON.stringify({ $schema: './config.schema.json', key: 'value' }));
      expect(findSchemaFile(jsonFile)).toBe(schemaFile);
    });

    it('应检测同目录 {baseName}.schema.json', () => {
      const schemaFile = join(tmpDir, 'myconfig.schema.json');
      writeFileSync(schemaFile, JSON.stringify({ type: 'object' }));
      const jsonFile = join(tmpDir, 'myconfig.json');
      writeFileSync(jsonFile, '{"key": "value"}');
      expect(findSchemaFile(jsonFile)).toBe(schemaFile);
    });

    it('应从项目根 schemas/ 目录查找', () => {
      const schemasDir = join(tmpDir, 'schemas');
      mkdirSync(schemasDir, { recursive: true });
      const schemaFile = join(schemasDir, 'app.schema.json');
      writeFileSync(schemaFile, JSON.stringify({ type: 'object' }));
      writeFileSync(join(tmpDir, 'package.json'), '{}');
      const jsonFile = join(tmpDir, 'app.json');
      writeFileSync(jsonFile, '{"key": "value"}');
      expect(findSchemaFile(jsonFile)).toBe(schemaFile);
    });

    it('应从项目根 _schemas/ 目录查找', () => {
      const schemasDir = join(tmpDir, '_schemas');
      mkdirSync(schemasDir, { recursive: true });
      const schemaFile = join(schemasDir, 'app.schema.json');
      writeFileSync(schemaFile, JSON.stringify({ type: 'object' }));
      writeFileSync(join(tmpDir, 'package.json'), '{}');
      const jsonFile = join(tmpDir, 'app.json');
      writeFileSync(jsonFile, '{"key": "value"}');
      expect(findSchemaFile(jsonFile)).toBe(schemaFile);
    });

    it('应对 YAML 文件返回同目录 schema', () => {
      const schemaFile = join(tmpDir, 'config.schema.json');
      writeFileSync(schemaFile, JSON.stringify({ type: 'object' }));
      const yamlFile = join(tmpDir, 'config.yaml');
      writeFileSync(yamlFile, 'key: value\n');
      expect(findSchemaFile(yamlFile)).toBe(schemaFile);
    });

    it('应优先使用 $schema 字段而非同目录文件', () => {
      const localSchema = join(tmpDir, 'config.schema.json');
      writeFileSync(localSchema, JSON.stringify({ type: 'object' }));
      const urlSchema = 'https://example.com/schema.json';
      const jsonFile = join(tmpDir, 'config.json');
      writeFileSync(jsonFile, JSON.stringify({ $schema: urlSchema, key: 'value' }));
      expect(findSchemaFile(jsonFile)).toBe(urlSchema);
    });
  });

  describe('runCheckJsonschema', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'checkjsonschema-test-'));
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('schemaPath 为 null 时应 skipped', async () => {
      const jsonFile = join(tmpDir, 'test.json');
      writeFileSync(jsonFile, '{"key": "value"}');
      const result = await runCheckJsonschema(jsonFile, null, 'json', tmpDir);
      expect(result.skipped).toBe(true);
      expect(result.success).toBe(true);
    });

    it('应返回结构化结果', async () => {
      const result = await runCheckJsonschema('/fake/file.json', null, 'json', tmpDir);
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('output');
      expect(result).toHaveProperty('skipped');
    });

    it('应支持 yaml 格式参数', async () => {
      const result = await runCheckJsonschema('/fake/file.yaml', null, 'yaml', tmpDir);
      expect(result.skipped).toBe(true);
    });
  });

  describe('runSchemaLintStaged', () => {
    it('非 git 目录应 SKIP', async () => {
      const result = await runSchemaLintStaged('/tmp');
      expect(result.decision).toBe(DECISION.SKIP);
    });
  });

  describe('runSchemaLintFull', () => {
    it('非 git 目录应 SKIP', async () => {
      const result = await runSchemaLintFull('/tmp');
      expect(result.decision).toBe(DECISION.SKIP);
    });
  });

  describe('工具安装指引', () => {
    it('schema 工具应有安装 hint', () => {
      expect(getToolInstallHint('check-jsonschema')).toContain('check-jsonschema');
      expect(getToolInstallHint('jq')).toContain('jq');
      expect(getToolInstallHint('yq')).toContain('yq');
    });
  });
});
