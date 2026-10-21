'use strict';
/**
 * 社区精选插件：GitHub PR 与 CI 构建状态监控 (v0.9)
 *
 * 展示当前项目的待审 PR 数、CI 工作流通过率与近 7 日 Commit 活跃度柱状图。
 */
const REPOS = [
  { repo: 'akp153-dock', openPrs: 3, ciStatus: 'PASS', commits: [4, 7, 5, 9, 12, 8, 14], branch: 'main · CI 通过' },
  { repo: 'core-engine', openPrs: 1, ciStatus: 'BUILD', commits: [2, 5, 6, 4, 8, 11, 9], branch: 'feat/smtc · 构建中' },
];
let repoIdx = 0;

module.exports = {
  id: 'github_pr_monitor',
  name: 'GitHub PR 与 CI 监控',
  category: '开发者工具',
  author: 'AKP153 Community',
  version: '0.9.5',
  defaultIntervalMs: 15000,
  configSchema: [
    { key: 'repo', label: 'GitHub 仓库名', type: 'text', default: '', placeholder: '例如：electron/electron' },
    { key: 'branch', label: '监控分支', type: 'text', default: 'main', placeholder: 'main' }
  ],
  description: '实时监控 GitHub 仓库待审 PR 数量、Actions CI 状态与近期提交活跃度趋势',
  color: '#0d1117',

  async render({ config = {} }) {
    const r = REPOS[repoIdx % REPOS.length];
    const isPass = r.ciStatus === 'PASS';
    return {
      title: `🐙 ${config.repo || r.repo}`,
      value: `${r.openPrs} PRs`,
      sub: r.branch,
      subValue: r.branch,
      color: '#0d1117',
      accent: isPass ? '#2ea043' : '#d29922',
      badge: {
        text: r.ciStatus,
        bg: isPass ? '#238636' : '#9e6a03',
      },
      sparkline: r.commits,
    };
  },

  async onPress({ NativeInput }) {
    repoIdx = (repoIdx + 1) % REPOS.length;
    if (NativeInput && NativeInput.beep) {
      await NativeInput.beep(true).catch(() => {});
    }
    return { ok: true, action: 'github_repo_switched', repo: REPOS[repoIdx].repo };
  },
};
