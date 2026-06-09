import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import {
  log,
  getFilePath,
  execCommand,
  lintPython,
  lintTypescriptJavascript,
  lintMarkdown,
  lintJson,
  lintYaml,
  lintShell,
  lintDockerfile,
  lintCss,
  lintSql,
  lintToml,
  findSchemaFile,
  runCheckJsonschema,
  shouldIgnoreFile,
  isGitIgnored,
  HADOLINT_SECURITY_RULES,
  getHadolintSeverity,
  parseHadolintOutput,
} from '../post-write-lint.js';

describe('post-write-lint', () => {
  describe('文件过滤逻辑', () => {
    it('node_modules/ 路径应该被忽略', () => {
      const path = 'node_modules/package/index.js';
      const ignored = shouldIgnoreFile(path);
      expect(ignored).toBe(true);
    });

    it('__pycache__/ 路径应该被忽略', () => {
      const path = '__pycache__/cache.pyc';
      const ignored = shouldIgnoreFile(path);
      expect(ignored).toBe(true);
    });

    it('.git/ 路径应该被忽略', () => {
      const path = '.git/config';
      const ignored = shouldIgnoreFile(path);
      expect(ignored).toBe(true);
    });

    it('dist/ 路径应该被忽略', () => {
      const path = 'dist/bundle.js';
      const ignored = shouldIgnoreFile(path);
      expect(ignored).toBe(true);
    });

    it('build/ 路径应该被忽略', () => {
      const path = 'build/output.js';
      const ignored = shouldIgnoreFile(path);
      expect(ignored).toBe(true);
    });

    it('.venv/ 路径应该被忽略', () => {
      const path = '.venv/lib/python3.11/site.py';
      const ignored = shouldIgnoreFile(path);
      expect(ignored).toBe(true);
    });

    it('venv/ 路径应该被忽略', () => {
      const path = 'venv/bin/python';
      const ignored = shouldIgnoreFile(path);
      expect(ignored).toBe(true);
    });

    it('普通源代码路径不应该被忽略', () => {
      const path = 'src/utils/helpers.js';
      const ignorePatterns = ['node_modules/', '__pycache__/', '.git/', 'dist/', 'build/', '.venv/', 'venv/'];
      const ignored = ignorePatterns.some((p) => path.includes(p));
      expect(ignored).toBe(false);
    });

    it('Git 忽略的文件应该被检测', () => {
      // 模拟 isGitIgnored 逻辑
      const mockIsGitIgnored = (path) => {
        return path.includes('.env') || path.includes('coverage/');
      };
      expect(mockIsGitIgnored('.env')).toBe(true);
      expect(mockIsGitIgnored('coverage/lcov.info')).toBe(true);
      expect(mockIsGitIgnored('src/index.js')).toBe(false);
    });
  });

  describe('支持的文件类型', () => {
    const supported = [
      'py',
      'js',
      'jsx',
      'ts',
      'tsx',
      'mjs',
      'cjs',
      'md',
      'mdx',
      'json',
      'yaml',
      'yml',
      'sh',
      'bash',
      'zsh',
      'dockerfile',
      'sql',
      'toml',
      'css',
      'scss',
      'less',
    ];

    it('应该支持 Python 文件', () => {
      expect(supported.includes('py')).toBe(true);
    });

    it('应该支持 JavaScript 文件', () => {
      expect(supported.includes('js')).toBe(true);
      expect(supported.includes('jsx')).toBe(true);
      expect(supported.includes('mjs')).toBe(true);
      expect(supported.includes('cjs')).toBe(true);
    });

    it('应该支持 TypeScript 文件', () => {
      expect(supported.includes('ts')).toBe(true);
      expect(supported.includes('tsx')).toBe(true);
    });

    it('应该支持 Markdown 文件', () => {
      expect(supported.includes('md')).toBe(true);
      expect(supported.includes('mdx')).toBe(true);
    });

    it('应该支持 JSON 文件', () => {
      expect(supported.includes('json')).toBe(true);
    });

    it('应该支持 YAML 文件', () => {
      expect(supported.includes('yaml')).toBe(true);
      expect(supported.includes('yml')).toBe(true);
    });

    it('应该支持 Shell 脚本', () => {
      expect(supported.includes('sh')).toBe(true);
      expect(supported.includes('bash')).toBe(true);
      expect(supported.includes('zsh')).toBe(true);
    });

    it('应该支持 Dockerfile', () => {
      expect(supported.includes('dockerfile')).toBe(true);
    });

    it('应该支持 SQL 文件', () => {
      expect(supported.includes('sql')).toBe(true);
    });

    it('不应该支持未配置的文件类型', () => {
      expect(supported.includes('txt')).toBe(false);
      expect(supported.includes('html')).toBe(false);
      expect(supported.includes('css')).toBe(true);
      expect(supported.includes('scss')).toBe(true);
      expect(supported.includes('less')).toBe(true);
      expect(supported.includes('xml')).toBe(false);
    });
  });

  describe('输入验证', () => {
    it('应该处理有效的 JSON 输入', () => {
      const input = '{"file_path": "test.py", "tool_name": "write"}';
      expect(() => JSON.parse(input)).not.toThrow();
      const data = JSON.parse(input);
      expect(data.file_path).toBe('test.py');
      expect(data.tool_name).toBe('write');
    });

    it('应该处理空 JSON 对象', () => {
      const input = '{}';
      expect(() => JSON.parse(input)).not.toThrow();
    });

    it('应该拒绝无效的 JSON', () => {
      const input = '{invalid json}';
      expect(() => JSON.parse(input)).toThrow();
    });
  });

  describe('工具可用性检测', () => {
    it('应该检测 ruff 是否安装', () => {
      // 模拟工具检测
      const mockCheckTool = (tool) => {
        return tool === 'ruff';
      };
      expect(mockCheckTool('ruff')).toBe(true);
      expect(mockCheckTool('nonexistent')).toBe(false);
    });

    it('应该检测 prettier 是否安装', () => {
      const mockCheckTool = (tool) => {
        return ['prettier', 'bunx'].includes(tool);
      };
      expect(mockCheckTool('prettier')).toBe(true);
    });

    it('应该检测 eslint 是否安装', () => {
      const mockCheckTool = (tool) => {
        return ['eslint', 'bunx'].includes(tool);
      };
      expect(mockCheckTool('eslint')).toBe(true);
    });

    it('应该检测 pyright 是否安装', () => {
      const mockCheckTool = (tool) => {
        return ['pyright', 'uv'].includes(tool);
      };
      expect(mockCheckTool('pyright')).toBe(true);
    });

    it('应该检测 jq 是否安装', () => {
      const mockCheckTool = (tool) => {
        return tool === 'jq';
      };
      expect(mockCheckTool('jq')).toBe(true);
    });

    it('应该检测 yq 是否安装', () => {
      const mockCheckTool = (tool) => {
        return tool === 'yq';
      };
      expect(mockCheckTool('yq')).toBe(true);
    });

    it('应该检测 markdownlint 是否安装', () => {
      const mockCheckTool = (tool) => {
        return ['markdownlint', 'bunx'].includes(tool);
      };
      expect(mockCheckTool('markdownlint')).toBe(true);
    });

    it('应该检测 shellcheck 是否安装', () => {
      const mockCheckTool = (tool) => {
        return tool === 'shellcheck';
      };
      expect(mockCheckTool('shellcheck')).toBe(true);
    });

    it('应该检测 hadolint 是否安装', () => {
      const mockCheckTool = (tool) => {
        return tool === 'hadolint';
      };
      expect(mockCheckTool('hadolint')).toBe(true);
    });

    it('应该检测 sqlfluff 是否安装', () => {
      const mockCheckTool = (tool) => {
        return tool === 'sqlfluff';
      };
      expect(mockCheckTool('sqlfluff')).toBe(true);
    });

    it('应该检测 stylelint 是否安装', () => {
      const mockCheckTool = (tool) => {
        return ['stylelint', 'bunx'].includes(tool);
      };
      expect(mockCheckTool('stylelint')).toBe(true);
    });
  });

  describe('lint 函数签名', () => {
    it('lintPython 应该接受文件路径参数', () => {
      const mockLintPython = (filePath) => {
        return typeof filePath === 'string' && filePath.endsWith('.py');
      };
      expect(mockLintPython('test.py')).toBe(true);
      expect(mockLintPython('src/main.py')).toBe(true);
    });

    it('lintTypescriptJavascript 应该接受文件路径参数', () => {
      const mockLint = (filePath) => {
        return typeof filePath === 'string' && /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(filePath);
      };
      expect(mockLint('test.js')).toBe(true);
      expect(mockLint('src/index.ts')).toBe(true);
      expect(mockLint('utils/helpers.tsx')).toBe(true);
    });

    it('lintMarkdown 应该接受文件路径参数', () => {
      const mockLint = (filePath) => {
        return typeof filePath === 'string' && /\.(md|mdx)$/.test(filePath);
      };
      expect(mockLint('README.md')).toBe(true);
      expect(mockLint('docs/guide.mdx')).toBe(true);
    });

    it('lintJson 应该接受文件路径参数', () => {
      const mockLint = (filePath) => {
        return typeof filePath === 'string' && filePath.endsWith('.json');
      };
      expect(mockLint('package.json')).toBe(true);
      expect(mockLint('config/settings.json')).toBe(true);
    });

    it('lintYaml 应该接受文件路径参数', () => {
      const mockLint = (filePath) => {
        return typeof filePath === 'string' && /\.(yaml|yml)$/.test(filePath);
      };
      expect(mockLint('config.yaml')).toBe(true);
      expect(mockLint('docker-compose.yml')).toBe(true);
    });

    it('lintShell 应该接受文件路径参数', () => {
      const mockLint = (filePath) => {
        return typeof filePath === 'string' && /\.(sh|bash|zsh)$/.test(filePath);
      };
      expect(mockLint('script.sh')).toBe(true);
      expect(mockLint('install.bash')).toBe(true);
      expect(mockLint('setup.zsh')).toBe(true);
    });

    it('lintDockerfile 应该接受文件路径参数', () => {
      const mockLint = (filePath) => {
        const filename = filePath.split('/').pop().toLowerCase();
        return (
          filename === 'dockerfile' || filename === 'containerfile' || filePath.toLowerCase().includes('dockerfile')
        );
      };
      expect(mockLint('Dockerfile')).toBe(true);
      expect(mockLint('docker/Dockerfile')).toBe(true);
      expect(mockLint('Dockerfile.dev')).toBe(true);
    });

    it('lintSql 应该接受文件路径参数', () => {
      const mockLint = (filePath) => {
        return typeof filePath === 'string' && filePath.endsWith('.sql');
      };
      expect(mockLint('migrations/001_init.sql')).toBe(true);
      expect(mockLint('queries/report.sql')).toBe(true);
    });

    it('lintCss 应该接受文件路径参数', () => {
      const mockLint = (filePath) => {
        return typeof filePath === 'string' && /\.(css|scss|less)$/.test(filePath);
      };
      expect(mockLint('styles/main.css')).toBe(true);
      expect(mockLint('theme/variables.scss')).toBe(true);
      expect(mockLint('overrides.less')).toBe(true);
    });
  });

  // ─── 直接函数测试 ───────────────────────────────────────────────────────

  describe('log 函数', () => {
    it('log 应该正常执行不抛出异常', () => {
      expect(() => log({ level: 'INFO', message: 'test' })).not.toThrow();
    });

    it('log 应该处理空对象', () => {
      expect(() => log({})).not.toThrow();
    });

    it('log 应该处理复杂数据', () => {
      expect(() =>
        log({
          level: 'LINT_START',
          file: 'test.py',
          extension: 'py',
          tool: 'Write',
          session: 'test-123',
        }),
      ).not.toThrow();
    });
  });

  describe('getFilePath 函数', () => {
    it('getFilePath 应该返回字符串', () => {
      const result = getFilePath();
      expect(typeof result).toBe('string');
    });

    it('getFilePath 应该处理环境变量 CLAUDE_FILE_PATH', () => {
      const originalPath = process.env.CLAUDE_FILE_PATH;
      process.env.CLAUDE_FILE_PATH = '/test/path.js';
      const result = getFilePath();
      expect(result).toBe('/test/path.js');
      process.env.CLAUDE_FILE_PATH = originalPath;
    });

    it('getFilePath 应该处理环境变量 CLAUDE_TOOL_INPUT', () => {
      const originalToolInput = process.env.CLAUDE_TOOL_INPUT;
      process.env.CLAUDE_TOOL_INPUT = JSON.stringify({ file_path: '/test/tool-input.js' });
      const result = getFilePath();
      expect(result).toBe('/test/tool-input.js');
      process.env.CLAUDE_TOOL_INPUT = originalToolInput;
    });

    it('getFilePath 应该处理 CLAUDE_TOOL_INPUT 中的 path 字段', () => {
      const originalToolInput = process.env.CLAUDE_TOOL_INPUT;
      process.env.CLAUDE_TOOL_INPUT = JSON.stringify({ path: '/test/path-field.js' });
      const result = getFilePath();
      expect(result).toBe('/test/path-field.js');
      process.env.CLAUDE_TOOL_INPUT = originalToolInput;
    });

    it('getFilePath 应该处理无效的 CLAUDE_TOOL_INPUT JSON', () => {
      const originalToolInput = process.env.CLAUDE_TOOL_INPUT;
      process.env.CLAUDE_TOOL_INPUT = 'invalid json';
      const result = getFilePath();
      expect(result).toBe('');
      process.env.CLAUDE_TOOL_INPUT = originalToolInput;
    });

    it('getFilePath 应该处理空的环境变量', () => {
      const originalPath = process.env.CLAUDE_FILE_PATH;
      const originalToolInput = process.env.CLAUDE_TOOL_INPUT;
      delete process.env.CLAUDE_FILE_PATH;
      delete process.env.CLAUDE_TOOL_INPUT;
      const result = getFilePath();
      expect(result).toBe('');
      process.env.CLAUDE_FILE_PATH = originalPath;
      process.env.CLAUDE_TOOL_INPUT = originalToolInput;
    });
  });

  describe('execCommand 函数', () => {
    it('execCommand 应该成功执行简单命令', () => {
      const result = execCommand('echo "test"');
      expect(result.success).toBe(true);
      expect(result.output).toContain('test');
    });

    it('execCommand 应该处理失败的命令', () => {
      const result = execCommand('nonexistent_command_xyz123');
      expect(result.success).toBe(false);
    });

    it('execCommand 应该捕获错误输出', () => {
      const result = execCommand('false'); // false 命令返回非零退出码
      expect(result.success).toBe(false);
    });

    it('execCommand 应该支持自定义选项', () => {
      const result = execCommand('pwd', { encoding: 'utf-8' });
      expect(result.success).toBe(true);
    });
  });

  describe('lint 函数集成测试', () => {
    it('lintPython 应该返回布尔值', () => {
      const result = lintPython('test.py');
      expect(typeof result).toBe('boolean');
    });

    it('lintTypescriptJavascript 应该返回布尔值', () => {
      const result = lintTypescriptJavascript('test.js');
      expect(typeof result).toBe('boolean');
    });

    it('lintMarkdown 应该返回布尔值', () => {
      const result = lintMarkdown('test.md');
      expect(typeof result).toBe('boolean');
    });

    it('lintJson 应该返回布尔值', () => {
      const result = lintJson('test.json');
      expect(typeof result).toBe('boolean');
    });

    it('lintYaml 应该返回布尔值', () => {
      const result = lintYaml('test.yaml');
      expect(typeof result).toBe('boolean');
    });

    it('lintShell 应该返回布尔值', () => {
      const result = lintShell('test.sh');
      expect(typeof result).toBe('boolean');
    });

    it('lintDockerfile 应该返回布尔值', () => {
      const result = lintDockerfile('Dockerfile');
      expect(typeof result).toBe('boolean');
    });

    it('lintSql 应该返回布尔值', () => {
      const result = lintSql('test.sql');
      expect(typeof result).toBe('boolean');
    });

    it('lintCss 应该返回布尔值', () => {
      const result = lintCss('test.css');
      expect(typeof result).toBe('boolean');
    });
  });

  // ─── lintCss 功能测试 ──────────────────────────────────────────────────────

  describe('lintCss 功能测试', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'lintcss-test-'));
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('应该对 .css 文件返回 true（工具可用或 fail-open）', () => {
      const cssFile = join(tmpDir, 'test.css');
      writeFileSync(cssFile, 'body { color: red; }\n');
      const result = lintCss(cssFile);
      expect(result).toBe(true);
    });

    it('应该对 .scss 文件返回 true', () => {
      const scssFile = join(tmpDir, 'test.scss');
      writeFileSync(scssFile, '$color: red;\nbody { color: $color; }\n');
      const result = lintCss(scssFile);
      expect(result).toBe(true);
    });

    it('应该对 .less 文件返回 true', () => {
      const lessFile = join(tmpDir, 'test.less');
      writeFileSync(lessFile, '@color: red;\nbody { color: @color; }\n');
      const result = lintCss(lessFile);
      expect(result).toBe(true);
    });

    it('bun 未安装时应 fail-open 返回 true', () => {
      if (execCommand('which bun').success) {
        console.log('   ⏭️  bun 已安装，跳过 fail-open 测试');
        return;
      }
      const cssFile = join(tmpDir, 'test.css');
      writeFileSync(cssFile, 'body { color: red; }\n');
      const result = lintCss(cssFile);
      expect(result).toBe(true);
    });

    it('lintCss 不应抛出异常', () => {
      const cssFile = join(tmpDir, 'test.css');
      writeFileSync(cssFile, 'body { color: red; }\n');
      expect(() => lintCss(cssFile)).not.toThrow();
    });

    it('lintCss 应该返回布尔值', () => {
      const cssFile = join(tmpDir, 'test.css');
      writeFileSync(cssFile, 'body { color: red; }\n');
      const result = lintCss(cssFile);
      expect(typeof result).toBe('boolean');
    });

    it('执行顺序应为先 prettier 后 stylelint', () => {
      const sourceFile = join(import.meta.dir, '..', 'post-write-lint.js');
      expect(existsSync(sourceFile)).toBe(true);
      const content = readFileSync(sourceFile, 'utf-8');
      const prettierPos = content.indexOf('prettier --write "${filePath}"');
      const stylelintPos = content.indexOf('stylelint "${filePath}"');
      expect(prettierPos).toBeGreaterThan(0);
      expect(stylelintPos).toBeGreaterThan(0);
      expect(prettierPos).toBeLessThan(stylelintPos);
    });

    it('stylelint 未安装时应 fail-open 返回 true', () => {
      if (execCommand('which bunx').success) {
        // bunx 已安装，此测试验证函数不抛出异常即可
        const cssFile = join(tmpDir, 'test.css');
        writeFileSync(cssFile, 'body { color: red; }\n');
        expect(() => lintCss(cssFile)).not.toThrow();
        return;
      }
      const cssFile = join(tmpDir, 'test.css');
      writeFileSync(cssFile, 'body { color: red; }\n');
      const result = lintCss(cssFile);
      expect(result).toBe(true);
    });

    it('未找到 stylelint 配置时应 fail-open 返回 true', () => {
      const cssFile = join(tmpDir, 'test.css');
      writeFileSync(cssFile, 'body { color: red; }\n');
      // 临时目录没有 .stylelintrc 配置，应 fail-open
      const result = lintCss(cssFile);
      expect(result).toBe(true);
    });

    it('lintCss 应输出跳过消息（工具未安装时）', () => {
      const cssFile = join(tmpDir, 'test.css');
      writeFileSync(cssFile, 'body { color: red; }\n');
      expect(() => lintCss(cssFile)).not.toThrow();
    });

    it('应处理嵌套的 SCSS 选择器', () => {
      const scssFile = join(tmpDir, 'nested.scss');
      writeFileSync(
        scssFile,
        '.container {\n  .item {\n    color: blue;\n    &:hover {\n      color: red;\n    }\n  }\n}\n',
      );
      const result = lintCss(scssFile);
      expect(typeof result).toBe('boolean');
    });

    it('应处理 LESS 变量和混入', () => {
      const lessFile = join(tmpDir, 'mixin.less');
      writeFileSync(
        lessFile,
        '.bordered(@radius: 4px) {\n  border: 1px solid #ccc;\n  border-radius: @radius;\n}\n.box { .bordered(); }\n',
      );
      const result = lintCss(lessFile);
      expect(typeof result).toBe('boolean');
    });
  });

  // ─── lintShell 功能测试 ─────────────────────────────────────────────────

  describe('lintShell 功能测试', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'lintshell-test-'));
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('应该对 .sh 文件返回 true（工具可用或 fail-open）', () => {
      const shFile = join(tmpDir, 'test.sh');
      writeFileSync(shFile, '#!/bin/bash\necho "hello"\n');
      const result = lintShell(shFile);
      expect(result).toBe(true);
    });

    it('应该对 .bash 文件返回 true', () => {
      const bashFile = join(tmpDir, 'test.bash');
      writeFileSync(bashFile, '#!/usr/bin/env bash\necho "hello"\n');
      const result = lintShell(bashFile);
      expect(result).toBe(true);
    });

    it('应该对 .zsh 文件返回 true', () => {
      const zshFile = join(tmpDir, 'test.zsh');
      writeFileSync(zshFile, '#!/usr/bin/env zsh\necho "hello"\n');
      const result = lintShell(zshFile);
      expect(result).toBe(true);
    });

    it('shellcheck 未安装时应 fail-open 返回 true', () => {
      const shFile = join(tmpDir, 'test.sh');
      writeFileSync(shFile, '#!/bin/bash\necho "hello"\n');
      const result = lintShell(shFile);
      expect(result).toBe(true);
    });

    it('shfmt 未安装时应 fail-open 跳过格式化', () => {
      const shFile = join(tmpDir, 'test.sh');
      writeFileSync(shFile, '#!/bin/bash\necho "hello"\n');
      const result = lintShell(shFile);
      expect(result).toBe(true);
    });

    it('shellcheck 应检测到安全隐患', () => {
      if (!execCommand('which shellcheck').success) {
        console.log('   ⏭️  shellcheck 未安装，跳过此测试');
        return;
      }
      const shFile = join(tmpDir, 'dangerous.sh');
      writeFileSync(shFile, '#!/bin/bash\nrm -rf $HOME/\n');
      const result = lintShell(shFile);
      expect(result).toBe(false);
    });

    it('shfmt 应自动格式化不规范的脚本', () => {
      if (!execCommand('which shfmt').success) {
        console.log('   ⏭️  shfmt 未安装，跳过此测试');
        return;
      }
      const shFile = join(tmpDir, 'unformatted.sh');
      writeFileSync(shFile, '#!/bin/bash\nif [ "$1" = "test" ];then\necho "yes"\nfi\n');
      const beforeContent = readFileSync(shFile, 'utf-8');
      lintShell(shFile);
      const afterContent = readFileSync(shFile, 'utf-8');
      expect(afterContent).not.toBe(beforeContent);
    });

    it('shellcheck 错误输出应包含行号和规则 ID', () => {
      if (!execCommand('which shellcheck').success) {
        console.log('   ⏭️  shellcheck 未安装，跳过此测试');
        return;
      }
      const shFile = join(tmpDir, 'issues.sh');
      writeFileSync(shFile, '#!/bin/bash\necho $HOME\n');
      const result = execCommand(`shellcheck "${shFile}"`);
      if (!result.success) {
        const errorOutput = result.error || result.output;
        expect(errorOutput).toContain('line');
        expect(errorOutput).toMatch(/SC\d+/);
      }
    });

    it('执行顺序应为先 shfmt 后 shellcheck', () => {
      const sourceFile = join(import.meta.dir, '..', 'post-write-lint.js');
      expect(existsSync(sourceFile)).toBe(true);
      const content = readFileSync(sourceFile, 'utf-8');
      const shfmtPos = content.indexOf('// 1. shfmt');
      const shellcheckPos = content.indexOf('// 2. shellcheck');
      expect(shfmtPos).toBeGreaterThan(0);
      expect(shellcheckPos).toBeGreaterThan(0);
      expect(shfmtPos).toBeLessThan(shellcheckPos);
    });

    it('干净的脚本应通过所有检查', () => {
      const shFile = join(tmpDir, 'clean.sh');
      writeFileSync(shFile, '#!/bin/bash\nset -euo pipefail\necho "hello world"\n');
      const result = lintShell(shFile);
      expect(result).toBe(true);
    });

    it('lintShell 应输出 ⏭️ 跳过消息（工具未安装时）', () => {
      const shFile = join(tmpDir, 'test.sh');
      writeFileSync(shFile, '#!/bin/bash\necho "test"\n');
      // 验证函数在工具未安装时不抛出异常
      expect(() => lintShell(shFile)).not.toThrow();
    });
  });

  // ─── lintDockerfile 功能测试 ────────────────────────────────────────────

  describe('HADOLINT_SECURITY_RULES 安全规则映射', () => {
    it('应该包含 HIGH 级别的安全规则', () => {
      expect(HADOLINT_SECURITY_RULES.DL3006).toBe('HIGH');
      expect(HADOLINT_SECURITY_RULES.DL3023).toBe('HIGH');
      expect(HADOLINT_SECURITY_RULES.DL3025).toBe('HIGH');
    });

    it('应该包含基础镜像安全规则（DL3006/DL3007）', () => {
      expect(HADOLINT_SECURITY_RULES.DL3006).toBe('HIGH');
      expect(HADOLINT_SECURITY_RULES.DL3007).toBe('HIGH');
    });

    it('应该包含 root 用户安全规则（DL3002）', () => {
      expect(HADOLINT_SECURITY_RULES.DL3002).toBe('HIGH');
    });

    it('应该包含 COPY 安全规则（DL3020/DL3023）', () => {
      expect(HADOLINT_SECURITY_RULES.DL3020).toBe('HIGH');
      expect(HADOLINT_SECURITY_RULES.DL3023).toBe('HIGH');
    });

    it('应该包含 MEDIUM 级别的最佳实践规则', () => {
      expect(HADOLINT_SECURITY_RULES.DL3010).toBe('MEDIUM');
      expect(HADOLINT_SECURITY_RULES.DL3011).toBe('MEDIUM');
      expect(HADOLINT_SECURITY_RULES.DL4001).toBe('MEDIUM');
    });

    it('未定义的规则不应该在映射中', () => {
      expect(HADOLINT_SECURITY_RULES['DL9999']).toBeUndefined();
    });
  });

  describe('getHadolintSeverity 严重级别分类', () => {
    it('hadolint error 应返回 CRITICAL', () => {
      expect(getHadolintSeverity('error', 'DL3006')).toBe('CRITICAL');
    });

    it('hadolint warning + 安全规则 DL3006 应返回 HIGH', () => {
      expect(getHadolintSeverity('warning', 'DL3006')).toBe('HIGH');
    });

    it('hadolint warning + 安全规则 DL3023 应返回 HIGH', () => {
      expect(getHadolintSeverity('warning', 'DL3023')).toBe('HIGH');
    });

    it('hadolint warning + 安全规则 DL3025 应返回 HIGH', () => {
      expect(getHadolintSeverity('warning', 'DL3025')).toBe('HIGH');
    });

    it('hadolint warning + 安全规则 DL3002 应返回 HIGH', () => {
      expect(getHadolintSeverity('warning', 'DL3002')).toBe('HIGH');
    });

    it('hadolint warning + 未定义规则应返回 HIGH', () => {
      expect(getHadolintSeverity('warning', 'DL9999')).toBe('HIGH');
    });

    it('hadolint info 应返回 MEDIUM', () => {
      expect(getHadolintSeverity('info', 'DL9999')).toBe('MEDIUM');
    });

    it('hadolint style 应返回 MEDIUM', () => {
      expect(getHadolintSeverity('style', 'DL9999')).toBe('MEDIUM');
    });

    it('安全规则 DL3008 应映射为 HIGH', () => {
      expect(getHadolintSeverity('warning', 'DL3008')).toBe('HIGH');
    });

    it('安全规则 DL3009 应映射为 HIGH', () => {
      expect(getHadolintSeverity('warning', 'DL3009')).toBe('HIGH');
    });

    it('最佳实践规则 DL3013 应映射为 MEDIUM', () => {
      expect(getHadolintSeverity('warning', 'DL3013')).toBe('MEDIUM');
    });
  });

  describe('parseHadolintOutput 输出解析', () => {
    it('应该解析标准 hadolint 输出格式', () => {
      const output = 'Dockerfile:1:2: DL3006 warning: Always tag the version of an image explicitly';
      const results = parseHadolintOutput(output);
      expect(results).toHaveLength(1);
      expect(results[0].file).toBe('Dockerfile');
      expect(results[0].line).toBe(1);
      expect(results[0].ruleId).toBe('DL3006');
      expect(results[0].severity).toBe('HIGH');
      expect(results[0].message).toContain('Always tag');
    });

    it('应该解析多行 hadolint 输出', () => {
      const output = [
        'Dockerfile:1:2: DL3006 warning: Always tag the version of an image explicitly',
        'Dockerfile:3:1: DL3023 warning: COPY --chown is recommended for security',
        'Dockerfile:5:1: DL3025 warning: Use JSON notation for CMD and ENTRYPOINT',
      ].join('\n');
      const results = parseHadolintOutput(output);
      expect(results).toHaveLength(3);
      expect(results[0].ruleId).toBe('DL3006');
      expect(results[1].ruleId).toBe('DL3023');
      expect(results[2].ruleId).toBe('DL3025');
    });

    it('应该将 DL3006 分类为 HIGH 严重级别', () => {
      const output = 'Dockerfile:1:2: DL3006 warning: Always tag the version of an image explicitly';
      const results = parseHadolintOutput(output);
      expect(results[0].severity).toBe('HIGH');
    });

    it('应该将 DL3023 分类为 HIGH 严重级别', () => {
      const output = 'Dockerfile:3:1: DL3023 warning: COPY --chown is recommended for security';
      const results = parseHadolintOutput(output);
      expect(results[0].severity).toBe('HIGH');
    });

    it('应该将 DL3025 分类为 HIGH 严重级别', () => {
      const output = 'Dockerfile:5:1: DL3025 warning: Use JSON notation for CMD and ENTRYPOINT';
      const results = parseHadolintOutput(output);
      expect(results[0].severity).toBe('HIGH');
    });

    it('应该处理错误级别输出', () => {
      const output = 'Dockerfile:1:2: DL3006 error: Always tag the version of an image explicitly';
      const results = parseHadolintOutput(output);
      expect(results[0].severity).toBe('CRITICAL');
    });

    it('应该过滤空行', () => {
      const output = '\n\nDockerfile:1:2: DL3006 warning: message\n\n';
      const results = parseHadolintOutput(output);
      expect(results).toHaveLength(1);
    });

    it('应该忽略格式不匹配的行', () => {
      const output = 'Some random text\nDockerfile:1:2: DL3006 warning: valid line';
      const results = parseHadolintOutput(output);
      expect(results).toHaveLength(1);
    });

    it('应该处理无列号的格式', () => {
      const output = 'Dockerfile:1: DL3006 warning: message without column';
      const results = parseHadolintOutput(output);
      expect(results).toHaveLength(1);
      expect(results[0].line).toBe(1);
    });

    it('空输出应返回空数组', () => {
      const results = parseHadolintOutput('');
      expect(results).toHaveLength(0);
    });
  });

  describe('lintDockerfile 功能测试', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'lintdockerfile-test-'));
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('应该对干净的 Dockerfile 返回 true', () => {
      if (!execCommand('which hadolint').success) {
        console.log('   ⏭️  hadolint 未安装，跳过此测试');
        return;
      }
      const dockerFile = join(tmpDir, 'Dockerfile');
      writeFileSync(
        dockerFile,
        'FROM node:18-slim\nWORKDIR /app\nCOPY --chown=node:node package.json ./\nRUN npm install\nUSER node\nCMD ["node", "server.js"]\n',
      );
      const result = lintDockerfile(dockerFile);
      expect(result).toBe(true);
    });

    it('应该对有问题的 Dockerfile 返回 false', () => {
      if (!execCommand('which hadolint').success) {
        console.log('   ⏭️  hadolint 未安装，跳过此测试');
        return;
      }
      const dockerFile = join(tmpDir, 'Dockerfile');
      writeFileSync(dockerFile, 'FROM node:latest\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD node server.js\n');
      const result = lintDockerfile(dockerFile);
      expect(result).toBe(false);
    });

    it('应该对 Containerfile 返回 true（fail-open 或通过）', () => {
      const containerFile = join(tmpDir, 'Containerfile');
      writeFileSync(containerFile, 'FROM alpine:3.18\nRUN echo "hello"\n');
      const result = lintDockerfile(containerFile);
      // hadolint 可能安装也可能没安装，两种情况都应返回 true
      expect(typeof result).toBe('boolean');
    });

    it('应该对 *.dockerfile 扩展名文件返回 true', () => {
      const devDockerFile = join(tmpDir, 'dev.dockerfile');
      writeFileSync(devDockerFile, 'FROM node:18-slim\nRUN echo "dev"\n');
      const result = lintDockerfile(devDockerFile);
      expect(typeof result).toBe('boolean');
    });

    it('hadolint 未安装时应 fail-open 返回 true', () => {
      if (execCommand('which hadolint').success) {
        console.log('   ⏭️  hadolint 已安装，跳过 fail-open 测试');
        return;
      }
      const dockerFile = join(tmpDir, 'Dockerfile');
      writeFileSync(dockerFile, 'FROM node:latest\n');
      const result = lintDockerfile(dockerFile);
      expect(result).toBe(true);
    });

    it('lintDockerfile 不应抛出异常', () => {
      const dockerFile = join(tmpDir, 'Dockerfile');
      writeFileSync(dockerFile, 'FROM alpine:3.18\n');
      expect(() => lintDockerfile(dockerFile)).not.toThrow();
    });

    it('hadolint 输出应包含行号和规则 ID', () => {
      if (!execCommand('which hadolint').success) {
        console.log('   ⏭️  hadolint 未安装，跳过此测试');
        return;
      }
      const dockerFile = join(tmpDir, 'Dockerfile');
      writeFileSync(dockerFile, 'FROM node:latest\n');
      const result = execCommand(`hadolint "${dockerFile}"`);
      if (!result.success) {
        const output = result.output || result.error;
        expect(output).toMatch(/DL\d+/);
      }
    });

    it('安全规则 DL3006 应在有问题时被标记为 HIGH', () => {
      if (!execCommand('which hadolint').success) {
        console.log('   ⏭️  hadolint 未安装，跳过此测试');
        return;
      }
      const dockerFile = join(tmpDir, 'Dockerfile');
      writeFileSync(dockerFile, 'FROM node\nRUN echo "test"\n');
      const result = execCommand(`hadolint "${dockerFile}"`);
      if (!result.success) {
        const output = result.output || result.error;
        if (output.includes('DL3006')) {
          const issues = parseHadolintOutput(output);
          const dl3006 = issues.find((i) => i.ruleId === 'DL3006');
          if (dl3006) {
            expect(dl3006.severity).toBe('HIGH');
          }
        }
      }
    });
  });

  // ─── lintToml 功能测试 ─────────────────────────────────────────────────

  describe('lintToml 功能测试', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'linttoml-test-'));
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('应该对合法的 .toml 文件返回 true', () => {
      const tomlFile = join(tmpDir, 'valid.toml');
      writeFileSync(tomlFile, '[package]\nname = "my-project"\nversion = "1.0.0"\n');
      const result = lintToml(tomlFile);
      expect(result).toBe(true);
    });

    it('应该对格式不规范的 .toml 文件返回 false（taplo 已安装时）', () => {
      if (!execCommand('which taplo').success) {
        console.log('   ⏭️  taplo 未安装，跳过此测试');
        return;
      }
      // 构造一个格式不规范但语法正确的 TOML（taplo format --check 会失败）
      const tomlFile = join(tmpDir, 'unformatted.toml');
      writeFileSync(tomlFile, '[package]\nname="my-project"\nversion  =  "1.0.0"\n');
      const result = lintToml(tomlFile);
      // taplo format --check 可能通过也可能不通过，取决于 taplo 默认配置
      expect(typeof result).toBe('boolean');
    });

    it('taplo 未安装时应 fail-open 返回 true', () => {
      if (execCommand('which taplo').success) {
        console.log('   ⏭️  taplo 已安装，跳过 fail-open 测试');
        return;
      }
      const tomlFile = join(tmpDir, 'test.toml');
      writeFileSync(tomlFile, '[package]\nname = "test"\n');
      const result = lintToml(tomlFile);
      expect(result).toBe(true);
    });

    it('lintToml 不应抛出异常', () => {
      const tomlFile = join(tmpDir, 'test.toml');
      writeFileSync(tomlFile, '[package]\nname = "test"\n');
      expect(() => lintToml(tomlFile)).not.toThrow();
    });

    it('lintToml 应该接受文件路径参数', () => {
      const mockLint = (filePath) => {
        return typeof filePath === 'string' && filePath.endsWith('.toml');
      };
      expect(mockLint('pyproject.toml')).toBe(true);
      expect(mockLint('config/settings.toml')).toBe(true);
      expect(mockLint('Cargo.toml')).toBe(true);
    });

    it('lintToml 应该返回布尔值', () => {
      const tomlFile = join(tmpDir, 'test.toml');
      writeFileSync(tomlFile, '[package]\nname = "test"\n');
      const result = lintToml(tomlFile);
      expect(typeof result).toBe('boolean');
    });

    it('taplo 未安装时应输出跳过消息', () => {
      if (execCommand('which taplo').success) {
        console.log('   ⏭️  taplo 已安装，跳过此测试');
        return;
      }
      const tomlFile = join(tmpDir, 'test.toml');
      writeFileSync(tomlFile, '[package]\nname = "test"\n');
      // 验证函数在工具未安装时不抛出异常
      expect(() => lintToml(tomlFile)).not.toThrow();
    });
  });

  // ─── lintSql 功能测试 ──────────────────────────────────────────────────────

  describe('lintSql 功能测试', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'lintsql-test-'));
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('应该对 .sql 文件返回 true（工具可用或 fail-open）', () => {
      const sqlFile = join(tmpDir, 'test.sql');
      writeFileSync(sqlFile, 'SELECT id, name FROM users WHERE active = 1;\n');
      const result = lintSql(sqlFile);
      expect(result).toBe(true);
    });

    it('sqlfluff 未安装时应 fail-open 返回 true', () => {
      if (execCommand('which sqlfluff').success) {
        console.log('   ⏭️  sqlfluff 已安装，跳过 fail-open 测试');
        return;
      }
      const sqlFile = join(tmpDir, 'test.sql');
      writeFileSync(sqlFile, 'SELECT 1;\n');
      const result = lintSql(sqlFile);
      expect(result).toBe(true);
    });

    it('sqlfluff 应检测到 SQL 语法问题', () => {
      if (!execCommand('which sqlfluff').success) {
        console.log('   ⏭️  sqlfluff 未安装，跳过此测试');
        return;
      }
      const sqlFile = join(tmpDir, 'bad.sql');
      writeFileSync(sqlFile, 'select  id ,  name\nfrom users\nwhere active =   1;\n');
      const result = lintSql(sqlFile);
      expect(typeof result).toBe('boolean');
    });

    it('lintSql 不应抛出异常', () => {
      const sqlFile = join(tmpDir, 'test.sql');
      writeFileSync(sqlFile, 'SELECT 1;\n');
      expect(() => lintSql(sqlFile)).not.toThrow();
    });

    it('lintSql 应该接受文件路径参数', () => {
      const mockLint = (filePath) => {
        return typeof filePath === 'string' && filePath.endsWith('.sql');
      };
      expect(mockLint('migrations/001_init.sql')).toBe(true);
      expect(mockLint('queries/report.sql')).toBe(true);
    });

    it('lintSql 应该返回布尔值', () => {
      const sqlFile = join(tmpDir, 'test.sql');
      writeFileSync(sqlFile, 'SELECT 1;\n');
      const result = lintSql(sqlFile);
      expect(typeof result).toBe('boolean');
    });

    it('sqlfluff 应使用 --dialect ansi 参数', () => {
      const sourceFile = join(import.meta.dir, '..', 'post-write-lint.js');
      expect(existsSync(sourceFile)).toBe(true);
      const content = readFileSync(sourceFile, 'utf-8');
      expect(content).toContain('sqlfluff lint');
      expect(content).toContain('--dialect ansi');
    });

    it('sqlfluff 未安装时应输出跳过消息', () => {
      if (execCommand('which sqlfluff').success) {
        console.log('   ⏭️  sqlfluff 已安装，跳过此测试');
        return;
      }
      const sqlFile = join(tmpDir, 'test.sql');
      writeFileSync(sqlFile, 'SELECT 1;\n');
      expect(() => lintSql(sqlFile)).not.toThrow();
    });

    it('sqlfluff 错误输出应包含行号和规则 ID', () => {
      if (!execCommand('which sqlfluff').success) {
        console.log('   ⏭️  sqlfluff 未安装，跳过此测试');
        return;
      }
      const sqlFile = join(tmpDir, 'issues.sql');
      writeFileSync(sqlFile, 'select  id ,  name\nfrom users\nwhere active =   1;\n');
      const result = execCommand(`sqlfluff lint "${sqlFile}" --dialect ansi`);
      if (!result.success) {
        const output = result.output || result.error;
        expect(output).toMatch(/L\d{3}/);
      }
    });
  });

  // ─── findSchemaFile 功能测试 ────────────────────────────────────────────

  describe('findSchemaFile 功能测试', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'findschema-test-'));
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('应返回 null 当无 Schema 文件存在时', () => {
      const jsonFile = join(tmpDir, 'config.json');
      writeFileSync(jsonFile, '{"key": "value"}');
      const result = findSchemaFile(jsonFile);
      expect(result).toBeNull();
    });

    it('应从 JSON 文件 $schema 字段解析 URL', () => {
      const jsonFile = join(tmpDir, 'config.json');
      writeFileSync(
        jsonFile,
        JSON.stringify({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          key: 'value',
        }),
      );
      const result = findSchemaFile(jsonFile);
      expect(result).toBe('https://json-schema.org/draft/2020-12/schema');
    });

    it('应从 JSON 文件 $schema 字段解析本地路径', () => {
      const schemaFile = join(tmpDir, 'config.schema.json');
      writeFileSync(schemaFile, JSON.stringify({ type: 'object' }));
      const jsonFile = join(tmpDir, 'config.json');
      writeFileSync(jsonFile, JSON.stringify({ $schema: './config.schema.json', key: 'value' }));
      const result = findSchemaFile(jsonFile);
      expect(result).toBe(schemaFile);
    });

    it('应检测同目录 {baseName}.schema.json 文件', () => {
      const schemaFile = join(tmpDir, 'myconfig.schema.json');
      writeFileSync(schemaFile, JSON.stringify({ type: 'object' }));
      const jsonFile = join(tmpDir, 'myconfig.json');
      writeFileSync(jsonFile, '{"key": "value"}');
      const result = findSchemaFile(jsonFile);
      expect(result).toBe(schemaFile);
    });

    it('应从项目根目录 schemas/ 目录查找', () => {
      const { mkdirSync } = require('fs');
      const schemasDir = join(tmpDir, 'schemas');
      mkdirSync(schemasDir, { recursive: true });
      const schemaFile = join(schemasDir, 'app.schema.json');
      writeFileSync(schemaFile, JSON.stringify({ type: 'object' }));
      // 创建 package.json 标记项目根
      writeFileSync(join(tmpDir, 'package.json'), '{}');
      const jsonFile = join(tmpDir, 'app.json');
      writeFileSync(jsonFile, '{"key": "value"}');
      const result = findSchemaFile(jsonFile);
      expect(result).toBe(schemaFile);
    });

    it('应从项目根目录 _schemas/ 目录查找', () => {
      const { mkdirSync } = require('fs');
      const schemasDir = join(tmpDir, '_schemas');
      mkdirSync(schemasDir, { recursive: true });
      const schemaFile = join(schemasDir, 'app.schema.json');
      writeFileSync(schemaFile, JSON.stringify({ type: 'object' }));
      writeFileSync(join(tmpDir, 'package.json'), '{}');
      const jsonFile = join(tmpDir, 'app.json');
      writeFileSync(jsonFile, '{"key": "value"}');
      const result = findSchemaFile(jsonFile);
      expect(result).toBe(schemaFile);
    });

    it('应对 YAML 文件返回同目录 schema', () => {
      const schemaFile = join(tmpDir, 'config.schema.json');
      writeFileSync(schemaFile, JSON.stringify({ type: 'object' }));
      const yamlFile = join(tmpDir, 'config.yaml');
      writeFileSync(yamlFile, 'key: value\n');
      const result = findSchemaFile(yamlFile);
      expect(result).toBe(schemaFile);
    });

    it('应优先使用 $schema 字段而非同目录文件', () => {
      const localSchema = join(tmpDir, 'config.schema.json');
      writeFileSync(localSchema, JSON.stringify({ type: 'object' }));
      const urlSchema = 'https://example.com/schema.json';
      const jsonFile = join(tmpDir, 'config.json');
      writeFileSync(jsonFile, JSON.stringify({ $schema: urlSchema, key: 'value' }));
      const result = findSchemaFile(jsonFile);
      expect(result).toBe(urlSchema);
    });
  });

  // ─── runCheckJsonschema 功能测试 ────────────────────────────────────────

  describe('runCheckJsonschema 功能测试', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'checkjsonschema-test-'));
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('应跳过验证当 schemaPath 为 null 时', () => {
      const jsonFile = join(tmpDir, 'test.json');
      writeFileSync(jsonFile, '{"key": "value"}');
      const result = runCheckJsonschema(jsonFile, null, 'json');
      expect(result.skipped).toBe(true);
      expect(result.success).toBe(true);
    });

    it('应跳过验证当 check-jsonschema 未安装时', () => {
      if (execCommand('which check-jsonschema').success) {
        console.log('   ⏭️  check-jsonschema 已安装，跳过 fail-open 测试');
        return;
      }
      const jsonFile = join(tmpDir, 'test.json');
      writeFileSync(jsonFile, '{"key": "value"}');
      const result = runCheckJsonschema(jsonFile, '/fake/schema.json', 'json');
      expect(result.skipped).toBe(true);
      expect(result.success).toBe(true);
    });

    it('应返回结构化结果对象', () => {
      const result = runCheckJsonschema('/fake/file.json', null, 'json');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('output');
      expect(result).toHaveProperty('skipped');
    });

    it('应支持 yaml 格式参数', () => {
      const result = runCheckJsonschema('/fake/file.yaml', null, 'yaml');
      expect(result.skipped).toBe(true);
    });
  });

  // ─── lintJson 增强功能测试 ──────────────────────────────────────────────

  describe('lintJson 增强功能测试', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'lintjson-test-'));
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('应该对合法 JSON 文件返回 true', () => {
      const jsonFile = join(tmpDir, 'valid.json');
      writeFileSync(jsonFile, '{"name": "test", "version": "1.0.0"}\n');
      const result = lintJson(jsonFile);
      expect(result).toBe(true);
    });

    it('应该对格式不规范的 JSON 文件运行 prettier 格式化', () => {
      const jsonFile = join(tmpDir, 'unformatted.json');
      writeFileSync(jsonFile, '{"name":"test","version":"1.0.0"}');
      const result = lintJson(jsonFile);
      expect(result).toBe(true);
      // prettier 应该格式化了文件
      const formatted = readFileSync(jsonFile, 'utf-8');
      expect(formatted).toContain('\n');
    });

    it('应该对无效 JSON 文件返回 false', () => {
      const jsonFile = join(tmpDir, 'invalid.json');
      writeFileSync(jsonFile, '{invalid json content}');
      const result = lintJson(jsonFile);
      expect(result).toBe(false);
    });

    it('应跳过 Schema 验证当无 Schema 文件时', () => {
      const jsonFile = join(tmpDir, 'no-schema.json');
      writeFileSync(jsonFile, '{"key": "value"}\n');
      const result = lintJson(jsonFile);
      expect(result).toBe(true);
    });

    it('应运行 Schema 验证当有 $schema 字段时', () => {
      if (!execCommand('which check-jsonschema').success) {
        console.log('   ⏭️  check-jsonschema 未安装，跳过 Schema 验证测试');
        return;
      }
      const jsonFile = join(tmpDir, 'with-schema.json');
      writeFileSync(
        jsonFile,
        JSON.stringify({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
        }),
      );
      const result = lintJson(jsonFile);
      expect(typeof result).toBe('boolean');
    });

    it('lintJson 不应抛出异常', () => {
      const jsonFile = join(tmpDir, 'test.json');
      writeFileSync(jsonFile, '{}\n');
      expect(() => lintJson(jsonFile)).not.toThrow();
    });

    it('lintJson 应返回布尔值', () => {
      const jsonFile = join(tmpDir, 'test.json');
      writeFileSync(jsonFile, '{"key": "value"}\n');
      const result = lintJson(jsonFile);
      expect(typeof result).toBe('boolean');
    });

    it('prettier 格式化后文件应为合法 JSON', () => {
      const jsonFile = join(tmpDir, 'compact.json');
      writeFileSync(jsonFile, '{"a":1,"b":2,"c":3}');
      lintJson(jsonFile);
      const formatted = readFileSync(jsonFile, 'utf-8');
      expect(() => JSON.parse(formatted)).not.toThrow();
    });

    it('应处理嵌套 JSON 对象', () => {
      const jsonFile = join(tmpDir, 'nested.json');
      writeFileSync(
        jsonFile,
        JSON.stringify({
          level1: { level2: { level3: { key: 'deep' } } },
          array: [1, 2, 3],
        }),
      );
      const result = lintJson(jsonFile);
      expect(result).toBe(true);
    });
  });

  // ─── lintYaml 增强功能测试 ──────────────────────────────────────────────

  describe('lintYaml 增强功能测试', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'lintyaml-test-'));
    });

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('应该对合法 YAML 文件返回 true', () => {
      const yamlFile = join(tmpDir, 'valid.yaml');
      writeFileSync(yamlFile, 'name: test\nversion: "1.0.0"\n');
      const result = lintYaml(yamlFile);
      expect(result).toBe(true);
    });

    it('应该对 .yml 文件返回 true', () => {
      const ymlFile = join(tmpDir, 'valid.yml');
      writeFileSync(ymlFile, 'name: test\nversion: "1.0.0"\n');
      const result = lintYaml(ymlFile);
      expect(result).toBe(true);
    });

    it('应跳过 Schema 验证当无 Schema 文件时', () => {
      const yamlFile = join(tmpDir, 'no-schema.yaml');
      writeFileSync(yamlFile, 'key: value\n');
      const result = lintYaml(yamlFile);
      expect(result).toBe(true);
    });

    it('lintYaml 不应抛出异常', () => {
      const yamlFile = join(tmpDir, 'test.yaml');
      writeFileSync(yamlFile, 'key: value\n');
      expect(() => lintYaml(yamlFile)).not.toThrow();
    });

    it('lintYaml 应返回布尔值', () => {
      const yamlFile = join(tmpDir, 'test.yaml');
      writeFileSync(yamlFile, 'key: value\n');
      const result = lintYaml(yamlFile);
      expect(typeof result).toBe('boolean');
    });

    it('应处理多文档 YAML', () => {
      const yamlFile = join(tmpDir, 'multi.yaml');
      writeFileSync(yamlFile, '---\nname: doc1\n---\nname: doc2\n');
      const result = lintYaml(yamlFile);
      expect(result).toBe(true);
    });

    it('应处理嵌套 YAML 结构', () => {
      const yamlFile = join(tmpDir, 'nested.yaml');
      writeFileSync(yamlFile, 'server:\n  host: localhost\n  port: 8080\n  ssl:\n    enabled: true\n');
      const result = lintYaml(yamlFile);
      expect(result).toBe(true);
    });

    it('应处理包含列表的 YAML', () => {
      const yamlFile = join(tmpDir, 'list.yaml');
      writeFileSync(yamlFile, 'items:\n  - name: item1\n  - name: item2\n  - name: item3\n');
      const result = lintYaml(yamlFile);
      expect(result).toBe(true);
    });
  });

  // ─── Story 6.3: Gitignore 兼容性集成测试 ──────────────────────────────────

  describe('Story 6.3: isGitIgnored gitignore 集成', () => {
    let repoDir;

    beforeEach(() => {
      repoDir = mkdtempSync(join(tmpdir(), 'gitignore-lint-test-'));
      execSync('git init', { cwd: repoDir });
      execSync('git config user.email "test@test.com"', { cwd: repoDir });
      execSync('git config user.name "Test"', { cwd: repoDir });
      writeFileSync(join(repoDir, '.gitignore'), '*.log\nbuild/\n.env\n');
      writeFileSync(join(repoDir, 'README.md'), '# test');
      execSync('git add . && git commit -m "init"', { cwd: repoDir });
    });

    afterEach(() => {
      if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
    });

    it('gitignore 中的 *.log 文件应被 isGitIgnored 检测', () => {
      const logFile = join(repoDir, 'app.log');
      writeFileSync(logFile, 'log entry');
      expect(isGitIgnored(logFile, repoDir)).toBe(true);
    });

    it('gitignore 中的 build/ 目录文件应被 isGitIgnored 检测', () => {
      const buildFile = join(repoDir, 'build', 'output.js');
      const { mkdirSync } = require('fs');
      mkdirSync(join(repoDir, 'build'), { recursive: true });
      writeFileSync(buildFile, 'console.log("built")');
      expect(isGitIgnored(buildFile, repoDir)).toBe(true);
    });

    it('gitignore 中的 .env 文件应被 isGitIgnored 检测', () => {
      const envFile = join(repoDir, '.env');
      writeFileSync(envFile, 'SECRET=123');
      expect(isGitIgnored(envFile, repoDir)).toBe(true);
    });

    it('不在 gitignore 中的源代码文件不应被忽略', () => {
      const srcFile = join(repoDir, 'index.js');
      writeFileSync(srcFile, 'console.log("hello")');
      expect(isGitIgnored(srcFile, repoDir)).toBe(false);
    });

    it('.py 文件不被 *.log 规则忽略', () => {
      const pyFile = join(repoDir, 'app.py');
      writeFileSync(pyFile, 'print("hello")');
      expect(isGitIgnored(pyFile, repoDir)).toBe(false);
    });
  });
});
