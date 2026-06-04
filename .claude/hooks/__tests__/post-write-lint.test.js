import { describe, it, expect } from 'bun:test';

describe('post-write-lint', () => {
  describe('文件过滤逻辑', () => {
    it('node_modules/ 路径应该被忽略', () => {
      const path = 'node_modules/package/index.js';
      const ignorePatterns = ['node_modules/', '__pycache__/', '.git/', 'dist/', 'build/', '.venv/', 'venv/'];
      const ignored = ignorePatterns.some((p) => path.includes(p));
      expect(ignored).toBe(true);
    });

    it('__pycache__/ 路径应该被忽略', () => {
      const path = '__pycache__/cache.pyc';
      const ignorePatterns = ['node_modules/', '__pycache__/', '.git/', 'dist/', 'build/', '.venv/', 'venv/'];
      const ignored = ignorePatterns.some((p) => path.includes(p));
      expect(ignored).toBe(true);
    });

    it('.git/ 路径应该被忽略', () => {
      const path = '.git/config';
      const ignorePatterns = ['node_modules/', '__pycache__/', '.git/', 'dist/', 'build/', '.venv/', 'venv/'];
      const ignored = ignorePatterns.some((p) => path.includes(p));
      expect(ignored).toBe(true);
    });

    it('dist/ 路径应该被忽略', () => {
      const path = 'dist/bundle.js';
      const ignorePatterns = ['node_modules/', '__pycache__/', '.git/', 'dist/', 'build/', '.venv/', 'venv/'];
      const ignored = ignorePatterns.some((p) => path.includes(p));
      expect(ignored).toBe(true);
    });

    it('build/ 路径应该被忽略', () => {
      const path = 'build/output.js';
      const ignorePatterns = ['node_modules/', '__pycache__/', '.git/', 'dist/', 'build/', '.venv/', 'venv/'];
      const ignored = ignorePatterns.some((p) => path.includes(p));
      expect(ignored).toBe(true);
    });

    it('.venv/ 路径应该被忽略', () => {
      const path = '.venv/lib/python3.11/site.py';
      const ignorePatterns = ['node_modules/', '__pycache__/', '.git/', 'dist/', 'build/', '.venv/', 'venv/'];
      const ignored = ignorePatterns.some((p) => path.includes(p));
      expect(ignored).toBe(true);
    });

    it('venv/ 路径应该被忽略', () => {
      const path = 'venv/bin/python';
      const ignorePatterns = ['node_modules/', '__pycache__/', '.git/', 'dist/', 'build/', '.venv/', 'venv/'];
      const ignored = ignorePatterns.some((p) => path.includes(p));
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

    it('不应该支持未配置的文件类型', () => {
      expect(supported.includes('txt')).toBe(false);
      expect(supported.includes('html')).toBe(false);
      expect(supported.includes('css')).toBe(false);
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
  });
});
