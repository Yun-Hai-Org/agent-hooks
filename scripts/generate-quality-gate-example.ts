#!/usr/bin/env bun
/** 从 gate-registry 生成 .claude/quality-gate.example.yaml */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { generateExampleYaml } from '../.claude/hooks/gate-registry.js';

const repoRoot = join(import.meta.dir, '..');
const outPath = join(repoRoot, '.claude', 'quality-gate.example.yaml');
writeFileSync(outPath, generateExampleYaml(), 'utf-8');
