#!/usr/bin/env bun
/**
 * Security Orchestrator - 共享安全决策模块
 * 提供统一的安全检查结果格式和决策引擎
 * 供 commit-gate.js 和 merge-gate.js 使用
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

/**
 * 格式化检查结果
 * @param {string} tool - 工具名称
 * @param {Array} findings - 发现列表
 * @returns {Object} 格式化的结果
 */
export function formatResult(tool, findings = []) {
  const severity = findings.reduce((max, f) => {
    const levels = { critical: 3, high: 2, info: 1 };
    return (levels[f.level] || 0) > (levels[max] || 0) ? f.level : max;
  }, 'info');

  return {
    tool,
    severity,
    findings: findings.map(f => ({
      rule: f.rule || f.id,
      file: f.file || null,
      line: f.line || null,
      message: f.message || f.reason,
      level: f.level || 'info'
    }))
  };
}

/**
 * 分级决策引擎
 * @param {Array} results - 多个工具的检查结果
 * @returns {Object} 决策结果
 */
export function decide(results) {
  const criticalFindings = [];
  const warningFindings = [];
  const infoFindings = [];

  for (const result of results) {
    for (const finding of result.findings) {
      switch (finding.level) {
        case 'critical':
          criticalFindings.push({ ...finding, tool: result.tool });
          break;
        case 'high':
          warningFindings.push({ ...finding, tool: result.tool });
          break;
        default:
          infoFindings.push({ ...finding, tool: result.tool });
      }
    }
  }

  // 任一 critical → deny
  if (criticalFindings.length > 0) {
    return {
      decision: 'deny',
      reasons: criticalFindings.map(f => `[${f.tool}] ${f.message}`),
      criticalFindings,
      warningFindings,
      infoFindings
    };
  }

  // 无 critical 但有 warning → allow + 报告 warning
  if (warningFindings.length > 0) {
    return {
      decision: 'allow',
      reasons: warningFindings.map(f => `[${f.tool}] ${f.message}`),
      criticalFindings,
      warningFindings,
      infoFindings
    };
  }

  // 全部 info → allow
  return {
    decision: 'allow',
    reasons: [],
    criticalFindings,
    warningFindings,
    infoFindings
  };
}

/**
 * 检查工具是否可用
 * @param {string} toolName - 工具名称
 * @returns {Object} { available: boolean, message?: string }
 */
export function checkToolAvailable(toolName) {
  try {
    execSync(`which ${toolName}`, { stdio: 'pipe' });
    return { available: true };
  } catch {
    return {
      available: false,
      message: `${toolName} 未安装或不在 PATH 中`
    };
  }
}

/**
 * 聚合多个工具的扫描结果
 * @param {Array} scanResults - 扫描结果数组
 * @returns {Object} 聚合后的决策
 */
export function aggregateAndDecide(scanResults) {
  const validResults = scanResults.filter(r => r && r.findings);
  return decide(validResults);
}

/**
 * 生成 deny 响应
 * @param {string} reason - 拒绝原因
 * @returns {string} JSON 字符串
 */
export function denyResponse(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  });
}

/**
 * 生成 allow 响应
 * @param {string} [warning] - 可选的警告信息
 * @returns {string} JSON 字符串
 */
export function allowResponse(warning = null) {
  if (warning) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: warning
      }
    });
  }
  return JSON.stringify({});
}

/**
 * 检查是否为 Git 仓库
 * @param {string} cwd - 工作目录
 * @returns {boolean}
 */
export function isGitRepo(cwd) {
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取当前分支名
 * @param {string} cwd - 工作目录
 * @returns {string|null}
 */
export function getCurrentBranch(cwd) {
  try {
    return execSync('git branch --show-current', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

/**
 * 检查是否有未提交的更改
 * @param {string} cwd - 工作目录
 * @returns {boolean}
 */
export function hasUncommittedChanges(cwd) {
  try {
    const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

/**
 * 检查是否有未暂存的更改
 * @param {string} cwd - 工作目录
 * @returns {boolean}
 */
export function hasUnstagedChanges(cwd) {
  try {
    const status = execSync('git diff --name-only', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

/**
 * 获取提交信息
 * @param {string} cwd - 工作目录
 * @param {string} commitHash - 提交哈希（默认 HEAD）
 * @returns {Object|null}
 */
export function getCommitInfo(cwd, commitHash = 'HEAD') {
  try {
    const info = execSync(
      `git log -1 --format='%H%n%an%n%ae%n%s%n%b' ${commitHash}`,
      { cwd, encoding: 'utf-8', stdio: 'pipe' }
    ).trim().split('\n');
    
    return {
      hash: info[0],
      author: info[1],
      email: info[2],
      subject: info[3],
      body: info.slice(4).join('\n')
    };
  } catch {
    return null;
  }
}

// 导出所有函数
export default {
  formatResult,
  decide,
  checkToolAvailable,
  aggregateAndDecide,
  denyResponse,
  allowResponse,
  isGitRepo,
  getCurrentBranch,
  hasUncommittedChanges,
  hasUnstagedChanges,
  getCommitInfo
};
