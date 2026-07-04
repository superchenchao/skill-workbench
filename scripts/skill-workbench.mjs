#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSourceRoot = path.resolve(scriptDir, '..');
const sourceDashboardFavicon = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJTa2lsbCBTb3VyY2VzIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iYmciIHgxPSI4IiB5MT0iNiIgeDI9IjU2IiB5Mj0iNTgiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjMmY3ZDY4Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzExMTgyNyIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICA8L2RlZnM+CiAgPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9InVybCgjYmcpIi8+CiAgPHBhdGggZD0iTTQ0IDE3SDI1Yy02IDAtMTAgNC0xMCA5czQgOSAxMCA5aDE0YzYgMCAxMCA0IDEwIDlzLTQgOS0xMCA5SDE5IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmY4ZWMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgc3Ryb2tlLXdpZHRoPSIxMCIvPgogIDxwYXRoIGQ9Ik00NCAxN2g4djhNMTkgNTNoLTd2LTgiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2YzYmQ3MyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2Utd2lkdGg9IjUiLz4KICA8Y2lyY2xlIGN4PSI0OCIgY3k9IjQ4IiByPSI1IiBmaWxsPSIjODBjYmM0Ii8+Cjwvc3ZnPgo=';

const sourceGroup = { id: 'skills', label: 'Unified Skill pool' };
const sourceRulesFile = path.join('_manifests', 'source-rules.json');
const updateStatusCacheFile = path.join('_manifests', 'update-status.json');
const zhDescriptionsFile = path.join('_manifests', 'zh-descriptions.json');
const publicExportFile = path.join('_manifests', 'public-export.json');
const gitCommandTimeoutMs = 120000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function cleanGithubUrl(rawUrl) {
  return String(rawUrl || '')
    .trim()
    .replace(/^['"<]+|['">]+$/g, '')
    .replace(/[.,，。;；]+$/g, '');
}

export function normalizeGithubSource(rawUrl, slug) {
  const cleaned = cleanGithubUrl(rawUrl);
  if (!cleaned) return null;
  let url;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }
  if (url.hostname !== 'github.com') return null;
  const [owner, repoName] = url.pathname.split('/').filter(Boolean);
  if (!owner || !repoName) return null;
  const repo = repoName.replace(/\.git$/i, '');
  const fragment = decodeURIComponent(url.hash.replace(/^#/, ''));
  return {
    homepage: `https://github.com/${owner}/${repo}${fragment ? `#${fragment}` : ''}`,
    repoUrl: `https://github.com/${owner}/${repo}.git`,
    repoKey: `${owner}/${repo}`,
    repoDirName: `${owner}__${repo}`,
    sourcePath: fragment === slug ? `skills/${slug}` : '.',
  };
}

function githubSourceFromParts(owner, repo, extra = {}) {
  const cleanRepo = String(repo || '').replace(/\.git$/i, '');
  return {
    repoUrl: `https://github.com/${owner}/${cleanRepo}.git`,
    repoKey: `${owner}/${cleanRepo}`,
    repoDirName: `${owner}__${cleanRepo}`,
    requestedPath: extra.requestedPath || null,
    scanAll: Boolean(extra.scanAll),
    originalInput: extra.originalInput || `${owner}/${cleanRepo}`,
  };
}

export function parseImportInput(input) {
  const originalInput = String(input || '').trim();
  if (!originalInput) throw new Error('请输入 GitHub 仓库地址或 skills add 命令。');

  const commandMatch = originalInput.match(/\bskills\s+add\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\s|$)/);
  if (commandMatch) {
    const [owner, repo] = commandMatch[1].split('/');
    return githubSourceFromParts(owner, repo, {
      scanAll: /\s--all(?:\s|$)/.test(originalInput),
      originalInput,
    });
  }

  const shorthand = originalInput.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthand) {
    return githubSourceFromParts(shorthand[1], shorthand[2], { originalInput });
  }

  let url;
  try {
    url = new URL(cleanGithubUrl(originalInput));
  } catch {
    throw new Error('只支持 GitHub 仓库地址、owner/repo 或 npx -y skills add owner/repo 命令。');
  }
  if (url.hostname !== 'github.com') throw new Error('只支持 GitHub 公开仓库。');
  const parts = url.pathname.split('/').filter(Boolean);
  const [owner, repoName] = parts;
  if (!owner || !repoName) throw new Error('GitHub 地址缺少 owner/repo。');
  let requestedPath = null;
  if (parts[2] === 'tree') {
    requestedPath = parts.slice(4).join('/') || null;
  }
  return githubSourceFromParts(owner, repoName, { requestedPath, originalInput });
}

function loadSourceRules(sourceRoot = defaultSourceRoot) {
  const file = path.join(sourceRoot, sourceRulesFile);
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(parsed.rules) ? parsed.rules : [];
}

export function readZhDescriptionCache(sourceRoot = defaultSourceRoot) {
  const file = path.join(sourceRoot, zhDescriptionsFile);
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const descriptions = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed.descriptions || parsed)
    : {};
  return descriptions && typeof descriptions === 'object' && !Array.isArray(descriptions)
    ? descriptions
    : {};
}

function matchesSourceRule(slug, rule) {
  if (!rule?.match) return false;
  if (rule.match.exact) {
    const exact = Array.isArray(rule.match.exact) ? rule.match.exact : [rule.match.exact];
    if (exact.includes(slug)) return true;
  }
  if (rule.match.prefix) {
    const prefixes = Array.isArray(rule.match.prefix) ? rule.match.prefix : [rule.match.prefix];
    if (prefixes.some((prefix) => slug === prefix || slug.startsWith(`${prefix}-`))) return true;
  }
  if (rule.match.regex) return new RegExp(rule.match.regex).test(slug);
  return false;
}

function sourceFromRule(slug, rule) {
  const source = normalizeGithubSource(rule.repoUrl, slug);
  if (!source) return null;
  return {
    ...source,
    homepage: rule.homepage || source.homepage,
    label: rule.label || source.repoKey,
    ruleId: rule.id || source.repoKey,
    sourcePath: String(rule.sourcePathTemplate || source.sourcePath || '.').replace(/\{slug\}/g, slug),
  };
}

function sourceFromRules(slug, rules) {
  const exactRules = rules.filter((rule) => rule?.match?.exact);
  const otherRules = rules.filter((rule) => !rule?.match?.exact);
  for (const rule of [...exactRules, ...otherRules]) {
    if (matchesSourceRule(slug, rule)) return sourceFromRule(slug, rule);
  }
  return null;
}

function extractConfirmedGithubSource(text, slug) {
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatter) {
    const homepage = frontmatter[1].match(/^\s*homepage:\s*(https:\/\/github\.com\/[^\s)'"<>]+)/m);
    const normalized = normalizeGithubSource(homepage?.[1], slug);
    if (normalized) return normalized;
  }
  const canonical = text.match(/\bcanonical:\s*(https:\/\/github\.com\/[^\s)'"<>]+)/i);
  return normalizeGithubSource(canonical?.[1], slug);
}

function hasChinese(text) {
  return /[\u3400-\u9fff]/.test(String(text || ''));
}

function countChinese(text) {
  return (String(text || '').match(/[\u3400-\u9fff]/g) || []).length;
}

const dashboardCategoryMeta = {
  'Visual / Image': { label: '图像/视频能力', short: '图像', color: '#80cbc4', tint: '#e7f6f2' },
  'Lark / Feishu': { label: '飞书/协作', short: '飞书', color: '#8fb7ff', tint: '#eaf1ff' },
  Marketing: { label: '营销增长', short: '营销', color: '#f3bd73', tint: '#fff3df' },
  Content: { label: '内容生产相关', short: '内容', color: '#ee9faf', tint: '#ffe9ee' },
  Development: { label: '开发/流程', short: '开发', color: '#b79be8', tint: '#f1eafd' },
  DBS: { label: 'DBS 商业诊断', short: 'DBS', color: '#9ecfa8', tint: '#edf8ef' },
  General: { label: '其他', short: '其他', color: '#c7b9a4', tint: '#f4efe8' },
};

function dashboardCategory(category) {
  return dashboardCategoryMeta[category] || { label: category || '其他', short: category || '其他', color: '#cbd5e1', tint: '#f8fafc' };
}

function categoryLabel(category) {
  return ({
    'Visual / Image': '图像与视觉',
    'Lark / Feishu': '飞书协作',
    Marketing: '营销增长',
    Content: '内容生产',
    Development: '开发流程',
    DBS: '商业诊断',
    General: '通用能力',
  })[category] || '通用能力';
}

function skillSlugToChineseHint(slug) {
  const dictionary = {
    ab: 'A/B 测试',
    ads: '广告',
    article: '文章',
    baoyu: '宝玉',
    bug: '问题修复',
    card: '卡片',
    cards: '卡片',
    comic: '漫画',
    compress: '压缩',
    content: '内容',
    cover: '封面',
    danger: '高权限操作',
    dbs: 'DBS',
    deck: '演示文稿',
    design: '设计',
    dev: '开发',
    email: '邮件',
    format: '格式化',
    gemini: 'Gemini',
    git: 'Git',
    html: 'HTML',
    image: '图像',
    images: '图像',
    infographic: '信息图',
    lark: '飞书',
    markdown: 'Markdown',
    math: '数学',
    ppt: 'PPT',
    post: '发布',
    pricing: '定价',
    seo: 'SEO',
    slide: '幻灯片',
    social: '社交媒体',
    summary: '总结',
    test: '测试',
    translate: '翻译',
    url: '链接',
    video: '视频',
    wechat: '微信',
    weibo: '微博',
    x: 'X',
    xhs: '小红书',
    youtube: 'YouTube',
  };
  const parts = String(slug || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => dictionary[part.toLowerCase()] || part);
  return parts.join('、') || '对应能力';
}

function buildChineseDescription(slug, description, category) {
  return resolveChineseDescription(slug, description, category).zhDescription;
}

function cacheEntryText(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') return entry.zhDescription || entry.description || '';
  return '';
}

function isChineseFacingDescription(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!hasChinese(text)) return false;
  const chineseCount = countChinese(text);
  if (chineseCount < 20) return false;
  const firstChinese = text.search(/[\u3400-\u9fff]/);
  const firstLatin = text.search(/[A-Za-z]/);
  if (firstChinese !== -1 && (firstLatin === -1 || firstChinese < firstLatin)) return true;
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;
  if (firstLatin !== -1 && firstLatin < firstChinese) {
    return firstChinese <= 32 && chineseCount >= latinCount * 0.18;
  }
  return chineseCount >= latinCount * 0.25;
}

function cleanChineseSourceDescription(value) {
  return String(value || '')
    .replace(/\s+(Main entry point|Use when|Trigger|Triggers on|By default)\b[\s\S]*$/i, '')
    .replace(/\s+(Agent workspace migration|AI writing fingerprint|Execution block diagnosis|Benchmark analysis|Austrian economics chatroom|Content creation diagnosis|Personal decision system|Concept deconstruction|Business model diagnosis|Goal clarification|Turn fuzzy problems|Interactive learning workflow|Generate a deliverable|Restore the most recent|Save the current|Slow-is-fast diagnosis|Transmission psychology decoder|WeChat Official Account HTML generator|Xiaohongshu title formula tool|English explanation)\b[\s\S]*$/i, '')
    .trim();
}

function resolveChineseDescription(slug, description, category, zhDescriptionCache = {}) {
  const normalized = String(description || '').replace(/\s+/g, ' ').trim();
  const cached = String(cacheEntryText(zhDescriptionCache[slug]) || '').replace(/\s+/g, ' ').trim();
  if (cached) {
    return {
      zhDescription: cached.slice(0, 220),
      zhDescriptionStatus: 'cached',
    };
  }
  if (isChineseFacingDescription(normalized)) {
    return {
      zhDescription: cleanChineseSourceDescription(normalized).slice(0, 220),
      zhDescriptionStatus: 'source',
    };
  }
  if (normalized) {
    return {
      zhDescription: `待翻译：${normalized.slice(0, 220)}`,
      zhDescriptionStatus: 'missing',
    };
  }
  return {
    zhDescription: '还没有说明。',
    zhDescriptionStatus: 'missing',
  };
}

function parseSkillFile(skillFile) {
  const text = fs.readFileSync(skillFile, 'utf8');
  const slug = path.basename(path.dirname(skillFile));
  let name = slug;
  let description = '';
  const source = extractConfirmedGithubSource(text, slug);
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatter) {
    const lines = frontmatter[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match) continue;
      const key = match[1];
      const value = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (key === 'name' && value) name = value;
      if (key === 'description' && (value === '|' || value === '>-')) {
        const block = [];
        for (let j = i + 1; j < lines.length; j += 1) {
          if (!/^\s+/.test(lines[j])) break;
          block.push(lines[j].replace(/^\s+/, ''));
          i = j;
        }
        description = block.join(' ').replace(/\s+/g, ' ').trim();
        continue;
      }
      if (key === 'description' && value) description = value;
    }
  }
  if (!description) {
    const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
    description = (body.split(/\n\s*\n/).find(Boolean) || '')
      .replace(/^#+\s*/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }
  return { slug, name, description, source };
}

function safeSkillSlug(value) {
  const slug = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) ? slug : '';
}

function safeSkillSlugList(values) {
  if (!Array.isArray(values)) return null;
  return [...new Set(values.map((value) => safeSkillSlug(value)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function inferImportSlug(parsed, fallback) {
  return safeSkillSlug(parsed.name) || safeSkillSlug(parsed.slug) || safeSkillSlug(fallback);
}

function classifySkill(group, slug, description) {
  const text = `${group} ${slug} ${description}`.toLowerCase();
  if (text.includes('lark') || text.includes('飞书')) return 'Lark / Feishu';
  if (text.includes('baoyu') || text.includes('image') || text.includes('comic') || text.includes('diagram') || text.includes('illustration') || text.includes('图')) return 'Visual / Image';
  if (text.includes('marketing') || text.includes('seo') || text.includes('ads') || text.includes('pricing') || text.includes('launch') || text.includes('sales') || text.includes('copy')) return 'Marketing';
  if (text.includes('writing') || text.includes('content') || text.includes('email') || text.includes('social') || text.includes('wechat') || text.includes('xhs') || text.includes('weibo')) return 'Content';
  if (text.includes('debug') || text.includes('test') || text.includes('git') || text.includes('development') || text.includes('code') || text.includes('plan')) return 'Development';
  if (text.includes('dbs')) return 'DBS';
  return 'General';
}

export function buildSourceIndex(sourceRoot = defaultSourceRoot) {
  const skills = [];
  const groupDir = path.join(sourceRoot, sourceGroup.id);
  const sourceRules = loadSourceRules(sourceRoot);
  const zhDescriptionCache = readZhDescriptionCache(sourceRoot);
  if (fs.existsSync(groupDir)) {
    const entries = fs.readdirSync(groupDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(groupDir, entry.name))
      .filter((dir) => fs.existsSync(path.join(dir, 'SKILL.md')))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    for (const dir of entries) {
      const parsed = parseSkillFile(path.join(dir, 'SKILL.md'));
      const category = classifySkill(sourceGroup.id, parsed.slug, parsed.description);
      const source = parsed.source || sourceFromRules(parsed.slug, sourceRules);
      const zhDescription = resolveChineseDescription(parsed.slug, parsed.description, category, zhDescriptionCache);
      skills.push({
        ...parsed,
        source,
        group: sourceGroup.id,
        groupLabel: sourceGroup.label,
        category,
        ...zhDescription,
        path: dir,
        skillFile: path.join(dir, 'SKILL.md'),
      });
    }
  }
  const byGroup = {};
  const byCategory = {};
  for (const skill of skills) {
    byGroup[skill.groupLabel] = (byGroup[skill.groupLabel] || 0) + 1;
    byCategory[skill.category] = (byCategory[skill.category] || 0) + 1;
  }
  const confirmedSources = skills.filter((skill) => skill.source?.repoUrl).length;
  return {
    generatedAt: new Date().toISOString(),
    root: sourceRoot,
    total: skills.length,
    sourceStats: {
      confirmed: confirmedSources,
      unconfirmed: skills.length - confirmedSources,
    },
    byGroup,
    byCategory,
    skills,
  };
}

function publicPath(sourceRoot, targetPath) {
  const relativePath = path.relative(sourceRoot, targetPath || sourceRoot) || '.';
  return relativePath.split(path.sep).join('/');
}

function publicSourceIndex(index, sourceRoot) {
  return {
    ...index,
    root: '.',
    skills: index.skills.map((skill) => ({
      ...skill,
      sourceDescription: skill.description,
      description: skill.zhDescription || skill.description,
      path: publicPath(sourceRoot, skill.path),
      skillFile: publicPath(sourceRoot, skill.skillFile),
    })),
  };
}

export function listMissingZhDescriptions(sourceRoot = defaultSourceRoot) {
  const index = buildSourceIndex(sourceRoot);
  return index.skills
    .filter((skill) => skill.zhDescriptionStatus === 'missing')
    .map((skill) => ({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      skillFile: skill.skillFile,
      category: skill.category,
    }));
}

function projectAgentsText() {
  return `# AGENTS.md

本项目使用项目级 Skill。

## 目录结构

- \`.agents/skills.yml\`：本项目已启用 Skill 的清单。
- \`.agents/skills/\`：指向统一 Skill 源目录的软链接。
- \`.claude/skills\`：兼容入口，指向 \`../.agents/skills\`。
- \`output/skills/dashboard.html\`：本项目的 Skill 可视化面板。

## 规则

- 从统一 Skill 源仓库启用 Skill，不要手动复制 Skill 目录。
- 只启用本项目实际需要的 Skill。
- 修改已启用 Skill 后，重新生成项目 Skill 面板。
`;
}

export function initProject(projectDir) {
  const absoluteProjectDir = path.resolve(projectDir);
  ensureDir(absoluteProjectDir);
  ensureDir(path.join(absoluteProjectDir, '.agents', 'skills'));
  ensureDir(path.join(absoluteProjectDir, '.claude'));
  ensureDir(path.join(absoluteProjectDir, 'output', 'skills'));

  const agentsFile = path.join(absoluteProjectDir, 'AGENTS.md');
  if (!fs.existsSync(agentsFile)) {
    fs.writeFileSync(agentsFile, projectAgentsText());
  }

  const inventoryFile = path.join(absoluteProjectDir, '.agents', 'skills.yml');
  if (!fs.existsSync(inventoryFile)) {
    fs.writeFileSync(inventoryFile, '# Managed by skill-workbench. Edit with care.\nskills: []\n');
  }

  const claudeSkills = path.join(absoluteProjectDir, '.claude', 'skills');
  const expectedTarget = '../.agents/skills';
  if (fs.existsSync(claudeSkills) || fs.lstatSync(path.dirname(claudeSkills)).isDirectory()) {
    if (fs.existsSync(claudeSkills) || isBrokenSymlink(claudeSkills)) {
      const stat = fs.lstatSync(claudeSkills);
      if (!stat.isSymbolicLink()) {
        throw new Error(`Refusing to overwrite existing non-symlink: ${claudeSkills}`);
      }
      const currentTarget = fs.readlinkSync(claudeSkills);
      if (currentTarget !== expectedTarget) {
        fs.unlinkSync(claudeSkills);
        fs.symlinkSync(expectedTarget, claudeSkills);
      }
    } else {
      fs.symlinkSync(expectedTarget, claudeSkills);
    }
  }

  return { projectDir: absoluteProjectDir };
}

function isBrokenSymlink(filePath) {
  try {
    return fs.lstatSync(filePath).isSymbolicLink() && !fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function formatInventory(skills) {
  if (!skills.length) return '# Managed by skill-workbench. Edit with care.\nskills: []\n';
  const lines = ['# Managed by skill-workbench. Edit with care.', 'skills:'];
  for (const skill of skills.sort((a, b) => a.slug.localeCompare(b.slug))) {
    lines.push(`  - slug: ${skill.slug}`);
    lines.push(`    name: ${skill.name || skill.slug}`);
    lines.push(`    group: ${skill.group}`);
    lines.push(`    source: ${skill.source}`);
    lines.push('    description: |-');
    const description = String(skill.description || '').replace(/\n/g, ' ').trim();
    if (description) {
      for (const line of description.match(/.{1,100}(?:\s|$)/g) || [description]) {
        lines.push(`      ${line.trimEnd()}`);
      }
    } else {
      lines.push('      ');
    }
  }
  return `${lines.join('\n')}\n`;
}

export function readProjectSkills(projectDir) {
  const inventoryFile = path.join(path.resolve(projectDir), '.agents', 'skills.yml');
  if (!fs.existsSync(inventoryFile)) return { skills: [] };
  const text = fs.readFileSync(inventoryFile, 'utf8');
  const skills = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const item = line.match(/^\s*-\s+slug:\s*(.+)\s*$/);
    if (item) {
      current = { slug: item[1].trim() };
      skills.push(current);
      continue;
    }
    const prop = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)\s*$/);
    if (prop && current) {
      if (prop[1] === 'description' && (prop[2].trim() === '|-' || prop[2].trim() === '|')) {
        current.description = '';
      } else {
        current[prop[1]] = prop[2].trim();
      }
    } else if (/^\s{6,}/.test(line) && current && Object.hasOwn(current, 'description')) {
      current.description = `${current.description} ${line.trim()}`.trim();
    }
  }
  return { skills };
}

function writeProjectSkills(projectDir, skills) {
  const inventoryFile = path.join(path.resolve(projectDir), '.agents', 'skills.yml');
  fs.writeFileSync(inventoryFile, formatInventory(skills));
}

function findSkill(index, requestedSlug) {
  const matches = index.skills.filter((skill) => skill.slug === requestedSlug || skill.name === requestedSlug);
  if (matches.length === 0) throw new Error(`Skill not found in source index: ${requestedSlug}`);
  if (matches.length > 1) {
    const choices = matches.map((skill) => `${skill.group}/${skill.slug}`).join(', ');
    throw new Error(`Ambiguous Skill name "${requestedSlug}". Use one of: ${choices}`);
  }
  return matches[0];
}

function linkSkill(projectDir, skill) {
  const linkPath = path.join(projectDir, '.agents', 'skills', skill.slug);
  if (fs.existsSync(linkPath) || isBrokenSymlink(linkPath)) {
    const stat = fs.lstatSync(linkPath);
    if (!stat.isSymbolicLink()) {
      throw new Error(`Refusing to overwrite existing non-symlink: ${linkPath}`);
    }
    const currentTarget = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
    if (currentTarget !== skill.path) {
      fs.unlinkSync(linkPath);
      fs.symlinkSync(skill.path, linkPath);
    }
  } else {
    fs.symlinkSync(skill.path, linkPath);
  }
}

export function enableSkills(projectDir, sourceRoot = defaultSourceRoot, requestedSlugs = []) {
  const absoluteProjectDir = path.resolve(projectDir);
  initProject(absoluteProjectDir);
  const index = buildSourceIndex(sourceRoot);
  const current = readProjectSkills(absoluteProjectDir).skills;
  const bySlug = new Map(current.map((skill) => [skill.slug, skill]));
  const enabled = [];

  for (const requestedSlug of requestedSlugs) {
    const skill = findSkill(index, requestedSlug);
    linkSkill(absoluteProjectDir, skill);
    bySlug.set(skill.slug, {
      slug: skill.slug,
      name: skill.name,
      group: skill.group,
      source: skill.path,
      description: skill.description,
    });
    enabled.push(skill);
  }

  writeProjectSkills(absoluteProjectDir, [...bySlug.values()]);
  generateProjectDashboard(absoluteProjectDir);
  return enabled;
}

export function disableSkills(projectDir, requestedSlugs = []) {
  const absoluteProjectDir = path.resolve(projectDir);
  const current = readProjectSkills(absoluteProjectDir).skills;
  const requested = new Set(requestedSlugs);
  for (const slug of requested) {
    const linkPath = path.join(absoluteProjectDir, '.agents', 'skills', slug);
    if (fs.existsSync(linkPath) || isBrokenSymlink(linkPath)) {
      const stat = fs.lstatSync(linkPath);
      if (!stat.isSymbolicLink()) {
        throw new Error(`Refusing to remove existing non-symlink: ${linkPath}`);
      }
      fs.unlinkSync(linkPath);
    }
  }
  const kept = current.filter((skill) => !requested.has(skill.slug));
  writeProjectSkills(absoluteProjectDir, kept);
  generateProjectDashboard(absoluteProjectDir);
  return kept;
}

export function checkProject(projectDir) {
  const absoluteProjectDir = path.resolve(projectDir);
  const skillsDir = path.join(absoluteProjectDir, '.agents', 'skills');
  const brokenLinks = [];
  const nonSymlinkEntries = [];
  if (!fs.existsSync(skillsDir)) {
    return { projectDir: absoluteProjectDir, brokenLinks, nonSymlinkEntries, totalLinks: 0 };
  }
  let totalLinks = 0;
  for (const entry of fs.readdirSync(skillsDir)) {
    const entryPath = path.join(skillsDir, entry);
    const stat = fs.lstatSync(entryPath);
    if (!stat.isSymbolicLink()) {
      nonSymlinkEntries.push(entryPath);
      continue;
    }
    totalLinks += 1;
    const target = path.resolve(path.dirname(entryPath), fs.readlinkSync(entryPath));
    if (!fs.existsSync(target)) brokenLinks.push({ path: entryPath, target });
  }
  return { projectDir: absoluteProjectDir, brokenLinks, nonSymlinkEntries, totalLinks };
}

function defaultWorkspaceRoot(sourceRoot = defaultSourceRoot) {
  return path.dirname(path.resolve(sourceRoot));
}

function projectIdFor(workspaceRoot, projectDir) {
  return path.relative(workspaceRoot, projectDir).split(path.sep).join('/');
}

function projectGroupFromId(id) {
  const [group] = String(id || '').split('/');
  return group || 'project';
}

function isManagedOrHiddenDir(sourceRoot, dirent, absolutePath) {
  if (!dirent.isDirectory()) return true;
  if (dirent.name.startsWith('.')) return true;
  if (path.resolve(absolutePath) === path.resolve(sourceRoot)) return true;
  return ['node_modules', '.git'].includes(dirent.name);
}

export function listWorkspaceProjects(sourceRoot = defaultSourceRoot, workspaceRoot = defaultWorkspaceRoot(sourceRoot)) {
  const absoluteSourceRoot = path.resolve(sourceRoot);
  const absoluteWorkspaceRoot = path.resolve(workspaceRoot);
  if (!fs.existsSync(absoluteWorkspaceRoot)) return [];

  const projects = [];
  const seenProjects = new Set();
  const groupedDirs = new Set(['content', 'products', 'projects', 'web']);
  const directProjectDirs = new Set(['cc18168']);

  function pushProject(projectDir) {
    const absoluteProjectDir = path.resolve(projectDir);
    if (!isInside(absoluteWorkspaceRoot, absoluteProjectDir)) return;
    const id = projectIdFor(absoluteWorkspaceRoot, absoluteProjectDir);
    if (!id || id.startsWith('..')) return;
    if (seenProjects.has(id)) return;
    seenProjects.add(id);
    const isSourceRoot = absoluteProjectDir === absoluteSourceRoot;
    const inventory = readProjectSkills(absoluteProjectDir).skills;
    const report = checkProject(absoluteProjectDir);
    const initialized = fs.existsSync(path.join(absoluteProjectDir, '.agents', 'skills.yml'));
    projects.push({
      id,
      name: path.basename(absoluteProjectDir),
      group: projectGroupFromId(id),
      path: absoluteProjectDir,
      isSourceRoot,
      initialized,
      enabledCount: inventory.length,
      brokenLinks: report.brokenLinks,
      nonSymlinkEntries: report.nonSymlinkEntries,
      totalLinks: report.totalLinks,
      dashboardPath: fs.existsSync(path.join(absoluteProjectDir, 'output', 'skills', 'dashboard.html'))
        ? path.join(absoluteProjectDir, 'output', 'skills', 'dashboard.html')
        : null,
    });
  }

  pushProject(absoluteSourceRoot);

  for (const dirent of fs.readdirSync(absoluteWorkspaceRoot, { withFileTypes: true })) {
    const absolutePath = path.join(absoluteWorkspaceRoot, dirent.name);
    if (isManagedOrHiddenDir(absoluteSourceRoot, dirent, absolutePath)) continue;
    if (groupedDirs.has(dirent.name)) {
      for (const child of fs.readdirSync(absolutePath, { withFileTypes: true })) {
        const childPath = path.join(absolutePath, child.name);
        if (!isManagedOrHiddenDir(absoluteSourceRoot, child, childPath)) pushProject(childPath);
      }
      continue;
    }
    if (directProjectDirs.has(dirent.name) || !groupedDirs.has(dirent.name)) pushProject(absolutePath);
  }

  return projects.sort((a, b) => a.id.localeCompare(b.id, 'zh-CN'));
}

function resolveWorkspaceProject(projectId, sourceRoot = defaultSourceRoot, workspaceRoot = defaultWorkspaceRoot(sourceRoot)) {
  const absoluteWorkspaceRoot = path.resolve(workspaceRoot);
  const absoluteProjectDir = path.resolve(absoluteWorkspaceRoot, String(projectId || ''));
  if (!isInside(absoluteWorkspaceRoot, absoluteProjectDir)) throw new Error('项目路径不在工作区内部。');
  if (!fs.existsSync(absoluteProjectDir) || !fs.statSync(absoluteProjectDir).isDirectory()) {
    throw new Error(`项目不存在：${projectId}`);
  }
  return absoluteProjectDir;
}

export function getProjectSkillState(projectDir, sourceRoot = defaultSourceRoot) {
  const absoluteProjectDir = path.resolve(projectDir);
  const enabledSkills = readProjectSkills(absoluteProjectDir).skills;
  const enabledSlugs = new Set(enabledSkills.map((skill) => skill.slug));
  const report = checkProject(absoluteProjectDir);
  const index = buildSourceIndex(sourceRoot);
  return {
    path: absoluteProjectDir,
    initialized: fs.existsSync(path.join(absoluteProjectDir, '.agents', 'skills.yml')),
    enabledSkills,
    enabledSlugs: [...enabledSlugs].sort((a, b) => a.localeCompare(b)),
    availableSkills: index.skills.map((skill) => ({
      slug: skill.slug,
      name: skill.name,
      category: skill.category,
      categoryLabel: dashboardCategory(skill.category).label,
      categoryColor: dashboardCategory(skill.category).color,
      description: skill.zhDescription || skill.description,
      zhDescription: skill.zhDescription,
      sourceDescription: skill.description,
      enabled: enabledSlugs.has(skill.slug),
    })),
    report,
  };
}

export function generateProjectDashboard(projectDir) {
  const absoluteProjectDir = path.resolve(projectDir);
  ensureDir(path.join(absoluteProjectDir, 'output', 'skills'));
  const inventory = readProjectSkills(absoluteProjectDir).skills;
  const generatedAt = new Date().toISOString();
  const report = checkProject(absoluteProjectDir);
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Project Skill Dashboard</title>
  <style>
    :root { --bg: #f7f8fa; --panel: #fff; --ink: #171717; --muted: #64748b; --line: #e5e7eb; --accent: #0f766e; --soft: #d9f5ef; --danger: #b91c1c; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); }
    header, main { padding: 28px; }
    .shell { max-width: 1080px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 36px; line-height: 1.1; letter-spacing: 0; }
    p { margin: 0; color: var(--muted); line-height: 1.55; }
    .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 22px 0; }
    .stat, .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
    .stat strong { display: block; font-size: 28px; line-height: 1.1; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
    .tag { display: inline-block; margin-bottom: 10px; border-radius: 999px; padding: 4px 8px; background: var(--soft); color: var(--accent); font-size: 12px; }
    h2 { margin: 0 0 8px; font-size: 18px; letter-spacing: 0; overflow-wrap: anywhere; }
    code { display: block; margin-top: 12px; color: #475569; font-size: 12px; overflow-wrap: anywhere; }
    .danger { color: var(--danger); }
    @media (max-width: 720px) { header, main { padding: 18px; } .stats { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <div class="shell">
      <h1>Project Skill Dashboard</h1>
      <p>${escapeHtml(absoluteProjectDir)}</p>
      <div class="stats">
        <div class="stat"><strong>${inventory.length}</strong><span>enabled Skills</span></div>
        <div class="stat"><strong>${report.brokenLinks.length}</strong><span class="${report.brokenLinks.length ? 'danger' : ''}">broken links</span></div>
        <div class="stat"><strong>${report.nonSymlinkEntries.length}</strong><span>non-symlink entries</span></div>
      </div>
    </div>
  </header>
  <main>
    <div class="shell">
      <section class="grid">
        ${inventory.map((skill) => `<article class="card">
          <span class="tag">${escapeHtml(skill.group || 'project')}</span>
          <h2>${escapeHtml(skill.name || skill.slug)}</h2>
          <p>${escapeHtml(skill.description || '')}</p>
          <code>${escapeHtml(skill.source || '')}</code>
        </article>`).join('\n')}
      </section>
      <p style="margin-top:18px">Generated at ${escapeHtml(generatedAt)}.</p>
    </div>
  </main>
</body>
</html>`;
  const output = path.join(absoluteProjectDir, 'output', 'skills', 'dashboard.html');
  fs.writeFileSync(output, html);
  return output;
}

export function rebuildSourceDashboard(sourceRoot = defaultSourceRoot) {
  const index = buildSourceIndex(sourceRoot);
  const publicIndex = publicSourceIndex(index, sourceRoot);
  fs.writeFileSync(path.join(sourceRoot, 'skills-index.json'), JSON.stringify(publicIndex, null, 2));
  const categories = Object.keys(index.byCategory).sort();
  const categoryRows = categories.map((category) => ({
    id: category,
    ...dashboardCategory(category),
    count: index.byCategory[category],
  }));
  const topCategories = [...categoryRows].sort((a, b) => b.count - a.count).slice(0, 3);
  const maxCategoryCount = Math.max(1, ...categoryRows.map((category) => category.count));
  const graphData = {
    ...publicIndex,
    categories: categoryRows,
    skills: publicIndex.skills.map((skill) => ({
      ...skill,
      categoryLabel: dashboardCategory(skill.category).label,
      categoryShort: dashboardCategory(skill.category).short,
      categoryColor: dashboardCategory(skill.category).color,
      command: `接下来请优先使用「${skill.slug}」Skill。先阅读并遵循该 Skill 的规则，再根据我的具体需求完成任务。`,
    })),
  };
  const graphDataJson = JSON.stringify(graphData).replace(/</g, '\\u003c');
  const ringStops = categoryRows.length
    ? categoryRows.reduce((acc, category) => {
      const start = acc.offset;
      const span = (category.count / index.total) * 360;
      acc.parts.push(`${category.color} ${start.toFixed(2)}deg ${(start + span).toFixed(2)}deg`);
      acc.offset += span;
      return acc;
    }, { offset: 0, parts: [] }).parts.join(', ')
    : '#e5e7eb 0deg 360deg';
  const skillCategoryButtons = [
    { id: 'All', label: '全部 Skill', count: index.total, color: '#4f7f75' },
    { id: 'Favorites', label: '已收藏', count: 0, color: '#d9a441' },
    ...categoryRows,
  ];
  const projectCategoryOptions = [
    { id: 'All', label: '全部目录', count: index.total, color: '#4f7f75' },
    ...categoryRows,
  ];
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/svg+xml" href="${sourceDashboardFavicon}" />
  <title>本地 Skill 源库</title>
  <style>
    :root {
      --bg: #f4f1ea;
      --surface: #fbfaf7;
      --surface-2: #f0ece3;
      --ink: #23211d;
      --ink-strong: #23211d;
      --muted: #716b60;
      --hairline: #ded8cb;
      --line: #ded8cb;
      --primary: #6f4f2f;
      --primary-ink: #fff8ec;
      --ok: #3f7f5f;
      --warn: #a86427;
      --danger: #a84442;
      --blue: #4c6f91;
      --shadow: 0 18px 46px rgba(45, 35, 20, .08);
      --ring: ${ringStops};
      --font-ui: "Avenir Next", "Avenir", "Helvetica Neue", "Hiragino Sans GB", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif;
      --font-mono: "SF Mono", "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    html { min-height: 100%; overflow-x: hidden; }
    body {
      min-height: 100%;
      margin: 0;
      font-family: var(--font-ui);
      color: var(--ink);
      background: var(--bg);
      line-height: 1.5;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    button, input, select { font: inherit; }
    button { cursor: pointer; }
    .app { display: grid; grid-template-columns: 232px minmax(0, 1fr); min-height: 100vh; }
    .sidebar {
      padding: 22px 18px;
      border-right: 1px solid var(--hairline);
      background: #ebe5d9;
    }
    .brand { margin-bottom: 20px; padding: 6px 4px 20px; border-bottom: 1px solid #d8d0c0; }
    .brand-kicker {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      font-size: 10px;
      line-height: 1;
      font-family: var(--font-mono);
      font-weight: 600;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .brand-kicker::before { content: none; }
    .brand h1 { margin: 8px 0 6px; color: var(--ink-strong); font-size: 26px; line-height: 1.04; letter-spacing: 0; font-weight: 800; }
    .brand p { margin: 0; max-width: 168px; color: var(--muted); font-size: 12px; line-height: 1.4; font-weight: 500; }
    .nav { display: grid; gap: 6px; }
    .nav[hidden] { display: none; }
    .nav button {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-height: 38px;
      border: 1px solid transparent;
      border-radius: 7px;
      padding: 8px 10px;
      color: #50493f;
      background: transparent;
      text-align: left;
      font-size: 13px;
      font-weight: 600;
    }
    .nav button .rail { display: none; }
    .nav button.active { border-color: #d8d0c0; background: var(--surface); box-shadow: 0 8px 18px rgba(70, 52, 29, .05); }
    .nav .count { color: var(--muted); font-family: var(--font-mono); font-size: 11px; font-variant-numeric: tabular-nums; }
    .nav button span:not(.rail):not(.count) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nav button[data-category="Favorites"] { color: #6b5420; }
    .nav button[data-category="Favorites"].active { border-color: #d9c179; background: #fff8df; }
    .mode-nav { display: grid; gap: 8px; margin-bottom: 16px; }
    .mode-nav button {
      min-height: 34px;
      border: 1px solid transparent;
      border-radius: 7px;
      padding: 8px 10px;
      background: transparent;
      color: #50493f;
      font-size: 12px;
      font-weight: 600;
      text-align: left;
    }
    .mode-nav button.active { background: var(--surface); border-color: #d8d0c0; box-shadow: 0 8px 18px rgba(70, 52, 29, .05); }
    .main { min-width: 0; padding: 22px; }
    .section, .workspace, .panel, .map-panel, .cards-grid, .skill-card, .card-open, .skill-summary, .project-workspace { min-width: 0; max-width: 100%; }
    .section { display: none; min-height: 0; }
    .section.active { display: block; }
    .commandbar {
      display: grid;
      grid-template-columns: minmax(280px, 1fr) auto;
      gap: 14px;
      align-items: center;
      margin-bottom: 16px;
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: start;
      margin-bottom: 14px;
    }
    .title h2 { margin: 0; color: var(--ink-strong); font-size: 28px; line-height: 1.05; letter-spacing: 0; font-weight: 700; }
    .title p { margin: 5px 0 0; max-width: 880px; color: var(--muted); font-size: 13px; font-weight: 500; }
    .index-badge {
      display: grid;
      place-items: center;
      min-height: 56px;
      min-width: 116px;
      border: 1px solid var(--hairline);
      border-radius: 8px;
      background: var(--surface);
      color: var(--primary);
      box-shadow: var(--shadow);
    }
    .index-badge strong { display: block; font-size: 25px; line-height: 1; font-family: var(--font-mono); font-weight: 700; }
    .index-badge span { display: block; margin-top: 4px; color: var(--muted); font-size: 10px; font-weight: 600; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; margin: 0; border-bottom: 1px solid var(--hairline); }
    .stat {
      min-height: 78px;
      border-right: 1px solid var(--hairline);
      padding: 15px 17px;
      background: transparent;
      box-shadow: none;
    }
    .stat:last-child { border-right: 0; }
    .stat span { display: block; color: var(--muted); font-size: 11px; font-weight: 600; }
    .stat strong { display: block; margin-top: 3px; color: var(--ink-strong); font-size: 26px; line-height: 1; font-family: var(--font-mono); font-weight: 700; }
    .workspace { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 16px; min-height: 610px; }
    .panel {
      border: 1px solid var(--hairline);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .insights { padding: 16px; }
    .panel h3 { margin: 0 0 13px; color: var(--ink-strong); font-size: 17px; letter-spacing: 0; font-weight: 700; }
    .donut-row { display: grid; grid-template-columns: 116px 1fr; gap: 14px; align-items: center; margin-bottom: 18px; }
    .donut {
      position: relative;
      width: 106px;
      height: 106px;
      border-radius: 50%;
      background: conic-gradient(var(--ring));
      box-shadow: inset 0 0 0 18px rgba(255,255,255,.72), 0 12px 28px rgba(45,35,20,.08);
    }
    .donut::after {
      content: "";
      position: absolute;
      inset: 27px;
      border-radius: 50%;
      background: var(--surface);
      box-shadow: inset 0 0 0 1px var(--hairline);
    }
    .donut strong, .donut span { position: absolute; z-index: 1; left: 0; right: 0; text-align: center; }
    .donut strong { top: 37px; color: var(--primary); font-size: 26px; line-height: 1; font-family: var(--font-mono); font-weight: 700; }
    .donut span { top: 64px; color: var(--muted); font-size: 10px; font-weight: 600; }
    .legend { display: grid; gap: 7px; }
    .legend-row { display: grid; grid-template-columns: 10px 1fr auto; gap: 8px; align-items: center; font-size: 12px; font-weight: 500; color: var(--ink); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--item-color); }
    .rank { display: grid; gap: 10px; margin-top: 6px; }
    .rank-row { display: grid; gap: 5px; font-size: 12px; font-weight: 600; }
    .rank-top { display: flex; justify-content: space-between; gap: 10px; color: var(--ink); }
    .bar { height: 8px; border-radius: 99px; background: #eee8dc; overflow: hidden; }
    .bar span { display: block; height: 100%; width: var(--w); border-radius: inherit; background: var(--item-color); }
    .insights [data-insight-category] { transition: opacity .18s ease, filter .18s ease; }
    .insights.filtered [data-insight-category]:not(.active) { opacity: .28; filter: saturate(.55); }
    .insights.filtered [data-insight-category].active { opacity: 1; }
    .map-panel { display: grid; grid-template-rows: auto auto minmax(0, 1fr); overflow: hidden; }
    .map-head { display: flex; gap: 14px; align-items: flex-start; justify-content: space-between; padding: 14px 16px 10px; border-bottom: 1px solid var(--hairline); background: #f7f4ed; }
    .map-copy { min-width: 0; }
    .map-head h3 { margin-bottom: 3px; }
    .map-status { margin: 0; color: var(--muted); font-size: 11px; font-weight: 500; max-width: 560px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .map-actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
    .tabs { display: inline-flex; gap: 4px; padding: 3px; border-radius: 7px; background: #eee8dc; border: 1px solid var(--hairline); }
    .tabs button { border: 0; border-radius: 5px; padding: 6px 10px; color: var(--muted); background: transparent; font-size: 12px; font-weight: 600; }
    .tabs button.active { color: var(--ink-strong); background: var(--surface); }
    .searchbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .searchbar input {
      min-height: 46px;
      border: 1px solid var(--hairline);
      border-radius: 8px;
      padding: 0 14px;
      background: var(--surface);
      color: var(--ink);
      outline: 0;
      font-size: 14px;
      font-weight: 500;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.7);
    }
    .view { display: none; min-height: 480px; padding: 14px 16px 16px; }
    .view.active { display: block; }
    .graph-workspace {
      display: grid;
      grid-template-columns: minmax(520px, 1fr) minmax(260px, 320px);
      gap: 12px;
      min-height: 492px;
    }
    .graph-canvas {
      position: relative;
      width: 100%;
      min-height: 492px;
      border: 1px solid var(--hairline);
      border-radius: 8px;
      background: #faf8f3;
      overflow: hidden;
    }
    .graph-canvas svg { width: 100%; height: 492px; display: block; }
    .graph-results {
      min-width: 0;
      height: 492px;
      border: 1px solid var(--hairline);
      border-radius: 8px;
      background: #fffdfa;
      overflow: hidden;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }
    .graph-results-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 44px;
      padding: 10px 12px;
      border-bottom: 1px solid #e9e2d6;
      background: #f7f4ed;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }
    .graph-results-head span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .graph-results-head strong { color: var(--primary); font-family: var(--font-mono); font-size: 13px; font-weight: 700; white-space: nowrap; }
    .node { transition: opacity .18s ease, transform .18s ease; }
    .node { cursor: pointer; }
    .node circle { filter: drop-shadow(0 10px 18px rgba(54, 104, 99, .16)); }
    .node text { pointer-events: all; fill: var(--ink-strong); font-weight: 600; cursor: pointer; }
    .node.group text { font-weight: 600; font-size: 11px; }
    .node.group .graph-node-label { fill: var(--muted); font-size: 10px; }
    .node.group.active-scope circle { stroke-width: 5; }
    .edge { stroke: rgba(45, 35, 20, .18); stroke-width: 1.2; }
    .skill-card {
      border: 0;
      border-bottom: 1px solid #e9e2d6;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
    }
    .num {
      width: 32px;
      height: auto;
      border-radius: 0;
      display: grid;
      place-items: center;
      color: var(--muted);
      background: transparent;
      font-size: 11px;
      font-weight: 700;
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
    }
    .skill-card h4 { margin: 0; color: var(--ink-strong); letter-spacing: 0; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
    .skill-card h4 { font-size: 14px; font-weight: 700; }
    .skill-card p { margin: 3px 0 0; color: var(--muted); font-size: 12px; line-height: 1.35; font-weight: 500; }
    .pill { white-space: nowrap; border: 1px solid #d6cbbb; border-radius: 999px; padding: 5px 8px; color: #4d453a; background: #f5efe4; font-size: 11px; font-weight: 600; }
    .cards-frame {
      height: 492px;
      max-height: 492px;
      border: 1px solid var(--hairline);
      border-radius: 8px;
      background: #fffdfa;
      overflow: hidden;
      padding-bottom: 12px;
    }
    .cards-grid { display: grid; gap: 0; align-content: start; grid-auto-rows: minmax(62px, auto); height: 100%; max-height: 100%; overflow: auto; padding: 0; scroll-padding-bottom: 12px; background: transparent; }
    .graph-cards-grid { height: 100%; max-height: 100%; }
    .skill-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      min-height: 62px;
      padding: 10px 14px;
      text-align: left;
    }
    .skill-card p {
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .skill-card .path { display: none; }
    .skill-summary { min-width: 0; overflow: hidden; }
    .source-pill { white-space: nowrap; border: 1px solid #d6cbbb; border-radius: 999px; padding: 5px 8px; color: #4d453a; background: #f5efe4; font-size: 10px; font-weight: 600; }
    .source-pill.bound { border-color: #bdd1c1; background: #e8f2e6; color: var(--ok); }
    .source-pill.update { border-color: #e3c097; background: #fff2df; color: var(--warn); }
    .source-pill.unbound { border-color: #e0b6b4; background: #fff0ee; color: var(--danger); }
    .card-open {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      min-width: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      text-align: left;
    }
    .card-actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
    .update-button {
      border: 1px solid #cfc5b4;
      border-radius: 7px;
      padding: 7px 10px;
      background: var(--surface);
      color: var(--ink);
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }
    .update-button:disabled { cursor: default; opacity: .58; }
    .update-button:not(.ghost):not(.secondary) { border-color: var(--primary); background: var(--primary); color: var(--primary-ink); }
    .update-button.secondary, .update-button.ghost { background: var(--surface); color: var(--ink); }
    .update-button.danger { border-color: var(--danger); background: var(--danger); color: #fff8f6; }
    .update-button.card-update-button:not(.ghost):not(.secondary) {
      border-color: #e3c097;
      border-radius: 999px;
      padding: 5px 10px;
      background: #fffdfa;
      color: var(--warn);
      box-shadow: 0 1px 0 rgba(168, 100, 39, .08);
    }
    .notice {
      position: fixed;
      right: 22px;
      bottom: 18px;
      z-index: 20;
      max-width: min(420px, calc(100vw - 32px));
      border: 1px solid var(--hairline);
      border-radius: 8px;
      padding: 12px 14px;
      background: var(--surface);
      box-shadow: 0 18px 48px rgba(45, 35, 20, .16);
      color: var(--ink-strong);
      font-size: 13px;
      font-weight: 600;
      display: none;
    }
    .notice.show { display: block; }
    .empty { display: none; padding: 26px; color: var(--muted); text-align: center; }
    .modal {
      position: fixed;
      inset: 0;
      z-index: 10;
      display: none;
      place-items: center;
      padding: 24px;
      background: rgba(68, 58, 43, .34);
      backdrop-filter: blur(10px);
    }
    .modal.open { display: grid; }
    .dialog {
      width: min(560px, 100%);
      border: 1px solid var(--hairline);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: 0 30px 90px rgba(45, 35, 20, .18);
      padding: 20px;
      max-height: min(720px, calc(100vh - 48px));
      overflow: auto;
    }
    .dialog.import-dialog { width: min(760px, 100%); height: min(720px, calc(100vh - 48px)); overflow: hidden; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; gap: 14px; }
    .dialog.import-dialog .info-box { margin-top: 0; min-height: 0; }
    .dialog.confirm-dialog { width: min(480px, 100%); }
    .dialog-head { display: grid; grid-template-columns: minmax(0, 1fr) auto 34px; gap: 10px; align-items: start; }
    .dialog h3 { margin: 0; color: var(--ink-strong); font-size: 24px; letter-spacing: 0; overflow-wrap: anywhere; }
    .close { width: 32px; height: 32px; border: 1px solid var(--hairline); border-radius: 7px; background: #eee8dc; color: var(--ink); font-weight: 700; }
    .favorite-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-height: 32px;
      border: 1px solid #d8d0c0;
      border-radius: 7px;
      padding: 6px 9px;
      background: #fffdfa;
      color: #6b5420;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .favorite-button.active { border-color: #d9a441; background: #fff3c5; color: #533f15; }
    .favorite-star { font-size: 14px; line-height: 1; }
    .info-box { margin-top: 14px; border: 1px solid var(--hairline); border-radius: 8px; background: #faf8f3; padding: 13px; }
    .info-box h4 { margin: 0 0 8px; color: var(--muted); font-size: 13px; }
    .info-box p, .info-box code { color: var(--ink); font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
    .info-box code { display: block; }
    .confirm-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 14px; flex-wrap: wrap; }
    .copy-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .copy { border: 1px solid var(--primary); border-radius: 7px; padding: 9px 12px; min-width: 72px; background: var(--primary); color: var(--primary-ink); font-size: 12px; font-weight: 700; transition: background .16s ease, transform .16s ease; }
    .copy.copied { background: var(--ok); border-color: var(--ok); transform: translateY(-1px); }
    .copy.failed { background: var(--danger); border-color: var(--danger); }
    .import-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
    .import-form input {
      min-height: 38px;
      border: 1px solid var(--hairline);
      border-radius: 8px;
      padding: 9px 11px;
      background: var(--surface);
      color: var(--ink-strong);
      outline: 0;
      font-size: 12px;
      font-weight: 500;
    }
    .import-help { margin: 8px 0 0; color: var(--muted); font-size: 11px; font-weight: 700; }
    .import-bulk {
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 9px 0;
    }
    .import-bulk.show { display: flex; }
    .import-bulk span { color: var(--muted); font-size: 11px; font-weight: 500; }
    .import-results-box { display: flex; flex-direction: column; min-height: 0; }
    .import-list { display: grid; gap: 8px; min-height: 0; max-height: none; overflow: auto; padding: 0 3px 12px 0; scroll-padding-bottom: 12px; }
    .import-results-box .import-list { flex: 1; align-content: start; }
    .import-candidate {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr) auto;
      gap: 9px;
      align-items: center;
      border: 1px solid var(--hairline);
      border-radius: 8px;
      padding: 9px;
      background: #fffdfa;
    }
    .import-candidate h5 { margin: 0; color: var(--ink-strong); font-size: 13px; font-weight: 700; }
    .import-candidate p { margin: 2px 0 0; color: var(--muted); font-size: 11px; line-height: 1.35; font-weight: 700; }
    .import-candidate select { min-height: 30px; border: 1px solid var(--hairline); border-radius: 7px; color: var(--ink-strong); background: #fff; font-size: 11px; font-weight: 600; }
    .import-result { color: var(--muted); font-size: 12px; font-weight: 500; }
    .project-workspace { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 16px; margin-top: 16px; min-height: 560px; align-items: stretch; }
    .project-panel { padding: 18px; overflow: hidden; }
    .project-directory-panel { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); }
    .project-skill-panel { display: grid; grid-template-rows: auto auto auto auto minmax(0, 1fr); }
    .project-list, .project-skill-list { display: grid; gap: 9px; max-height: 560px; overflow: auto; padding: 0 4px 12px 0; scroll-padding-bottom: 12px; }
    .project-list { max-height: none; min-height: 0; align-content: start; }
    .project-skill-list { max-height: none; min-height: 0; align-content: start; }
    .project-item, .project-skill-item {
      width: 100%;
      border: 1px solid var(--hairline);
      border-radius: 8px;
      background: #fffdfa;
      padding: 11px;
      color: var(--ink-strong);
      text-align: left;
      box-shadow: none;
    }
    .project-item.active { border-color: var(--primary); background: #f8f3e8; }
    .project-item h4, .project-skill-item h4 { margin: 0; color: var(--ink-strong); font-size: 14px; font-weight: 700; overflow-wrap: anywhere; }
    .project-item p, .project-skill-item p { margin: 4px 0 0; color: var(--muted); font-size: 11px; line-height: 1.35; font-weight: 500; }
    .project-directory-tools { display: grid; grid-template-columns: minmax(0, 1fr) 116px auto; gap: 8px; margin: 12px 0; }
    .project-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) 180px; gap: 10px; margin: 12px 0; align-items: center; }
    .project-skill-tabs { display: inline-flex; gap: 4px; width: max-content; max-width: 100%; margin-top: 10px; padding: 3px; border-radius: 7px; background: #eee8dc; border: 1px solid var(--hairline); }
    .project-skill-tabs button { min-height: 30px; border: 0; border-radius: 5px; padding: 6px 10px; color: var(--muted); background: transparent; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .project-skill-tabs button.active { color: var(--ink); background: var(--surface); box-shadow: 0 4px 10px rgba(70, 52, 29, .06); }
    .project-directory-tools input,
    .project-directory-tools select,
    .project-toolbar input,
    .project-toolbar select {
      min-height: 36px;
      border: 1px solid var(--hairline);
      border-radius: 8px;
      padding: 8px 11px;
      background: var(--surface);
      color: var(--ink-strong);
      outline: 0;
      font-size: 12px;
      font-weight: 500;
    }
    .project-directory-tools select { min-width: 0; }
    .project-toolbar select { min-width: 0; }
    .project-skill-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
    .project-meta { margin: 0; color: var(--muted); font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
    footer { display: none; }
    @media (min-width: 1061px) and (min-height: 700px) {
      html, body { height: 100%; overflow: hidden; }
      .app { height: 100vh; min-height: 0; overflow: hidden; }
      .sidebar { height: 100vh; overflow: hidden; }
      .main {
        height: 100vh;
        display: grid;
        grid-template-rows: minmax(0, 1fr);
        overflow: hidden;
      }
      .section.active { display: grid; min-height: 0; height: 100%; }
      #skillsSection.section.active { grid-template-rows: auto auto auto minmax(0, 1fr); }
      #projectsSection.section.active { grid-template-rows: auto minmax(0, 1fr); row-gap: 16px; }
      .workspace, .project-workspace { min-height: 0; height: 100%; }
      .project-workspace { margin-top: 0; }
      .panel, .map-panel, .insights { min-height: 0; }
      .insights { overflow: auto; }
      .map-panel { height: 100%; }
      .view { min-height: 0; height: 100%; }
      .graph-workspace, .graph-results { min-height: 0; height: 100%; }
      .graph-canvas { min-height: 0; height: 100%; }
      .graph-canvas svg { height: 100%; min-height: 0; }
      .cards-frame { max-height: none; height: calc(100% - 2px); }
      .cards-grid { max-height: none; height: 100%; }
    }
    @media (min-width: 1061px) and (max-width: 1399px) {
      .app { grid-template-columns: 208px minmax(0, 1fr); }
      .sidebar { padding: 18px 14px; }
      .brand { margin-bottom: 20px; }
      .brand h1 { font-size: 20px; }
      .brand p { max-width: 126px; font-size: 10px; }
      .nav { gap: 8px; }
      .nav button { min-height: 38px; padding: 7px 9px; font-size: 11px; }
      .main { padding: 24px 20px 18px; }
      .title h2 { font-size: 25px; }
      .stats { gap: 9px; margin: 13px 0 12px; }
      .stat { min-height: 74px; padding: 12px 14px; }
      .stat strong { font-size: 28px; }
      .workspace { grid-template-columns: 300px minmax(0, 1fr); gap: 12px; }
      .insights { padding: 17px 14px; }
      .donut-row { grid-template-columns: 116px 1fr; gap: 12px; }
      .donut { width: 106px; height: 106px; }
      .donut strong { top: 37px; font-size: 26px; }
      .donut span { top: 64px; font-size: 10px; }
      .map-head { display: grid; grid-template-columns: minmax(0, 1fr); gap: 9px; }
      .map-actions { justify-content: flex-start; min-width: 0; }
      .searchbar { grid-template-columns: minmax(0, 1fr) auto; }
    }
    @media (max-width: 1060px) {
      .app { grid-template-columns: 1fr; }
      .sidebar { position: static; border-right: 0; border-bottom: 1px solid var(--hairline); }
      .nav { grid-template-columns: repeat(auto-fill, minmax(145px, 1fr)); }
      .workspace { grid-template-columns: 1fr; }
      .graph-workspace { grid-template-columns: 1fr; }
      .graph-results { height: 360px; }
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .commandbar { grid-template-columns: 1fr; }
      .map-actions { justify-content: flex-start; }
    }
    @media (max-width: 680px) {
      .app, .sidebar, .main, .section { width: 100vw; max-width: 100vw; overflow-x: hidden; }
      .main { padding: 18px 14px; }
      .sidebar { padding: 12px 14px 14px; }
      .sidebar .brand { display: none; }
      .nav { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .mode-nav { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .hero { grid-template-columns: 1fr; }
      .stats { grid-template-columns: 1fr; }
      .graph-canvas { min-height: 360px; }
      .graph-canvas svg { height: 360px; }
      .donut-row { grid-template-columns: 1fr; justify-items: center; }
      .searchbar { grid-template-columns: 1fr; }
      .commandbar .map-actions { display: grid; grid-template-columns: 1fr; }
      .commandbar .update-button { width: 100%; }
      .map-head { display: grid; grid-template-columns: 1fr; }
      .map-status { white-space: normal; }
      .title, .title p { width: calc(100vw - 28px); max-width: calc(100vw - 28px); min-width: 0; }
      .title p { white-space: normal; overflow-wrap: anywhere; word-break: break-all; }
      .cards-grid { grid-auto-rows: minmax(100px, auto); }
      .skill-card { grid-template-columns: 1fr; align-items: start; min-height: 100px; }
      .card-actions { justify-content: flex-start; flex-wrap: wrap; }
      .dialog-head { grid-template-columns: minmax(0, 1fr) auto; }
      .dialog-head .close { grid-column: 2; grid-row: 1; }
      .favorite-button { grid-column: 1 / -1; justify-self: start; }
      .project-skill-item { grid-template-columns: 1fr; align-items: start; }
      .project-directory-tools { grid-template-columns: 1fr; }
      .project-toolbar { grid-template-columns: 1fr; }
      .project-skill-tabs { width: 100%; }
      .project-skill-tabs button { flex: 1; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-kicker">Local Library</span>
        <h1>Skill<br>Sources</h1>
        <p>统一原件库，按项目启用。</p>
      </div>
      <nav class="mode-nav" id="sectionNav">
        <button type="button" class="active" data-section="skills">Skill 源库</button>
        <button type="button" data-section="projects">项目绑定</button>
      </nav>
      <nav class="nav" id="categoryNav">
        ${skillCategoryButtons.map((item) => `<button type="button" data-category="${escapeHtml(item.id)}" style="--item-color:${escapeHtml(item.color)}">
          <span class="rail"></span><span>${escapeHtml(item.label)}</span><span class="count"${item.id === 'Favorites' ? ' id="favoriteCount"' : ''}>${item.count}</span>
        </button>`).join('\n')}
      </nav>
    </aside>

    <main class="main">
      <section class="section active" id="skillsSection">
      <section class="commandbar">
        <div class="searchbar">
          <input id="q" type="search" placeholder="搜索 Skill 名称、中文说明、路径或来源..." />
        </div>
        <div class="map-actions">
          <button type="button" class="update-button ghost" id="openImport">添加 Skill</button>
          <button type="button" class="update-button" data-action="sync-active-scope" id="updateAll">同步全部 Skill</button>
        </div>
      </section>
      <section class="hero">
        <div class="title">
          <h2>本地 Skill 源库</h2>
          <p>按统一 Skill 原件库扫描，默认用列表完成搜索和同步。</p>
        </div>
        <div class="index-badge"><div><strong>${index.total}</strong><span>skills indexed</span></div></div>
      </section>

      <section class="stats">
        <div class="stat" style="--stat-bg:#fde8ef;--stat-color:#a06271"><span>总 Skill 数</span><strong>${index.total}</strong></div>
        <div class="stat" style="--stat-bg:#fff3df;--stat-color:#b67a25"><span>可更新来源</span><strong>${index.sourceStats.confirmed}</strong></div>
        <div class="stat" style="--stat-bg:#eaf1ff;--stat-color:#6d92d8"><span>未绑定来源</span><strong>${index.sourceStats.unconfirmed}</strong></div>
        <div class="stat" style="--stat-bg:#edf8ef;--stat-color:#76af82"><span>能力分类</span><strong>${categoryRows.length}</strong></div>
      </section>
      <section class="workspace">
        <aside class="panel insights">
          <h3>能力分类占比</h3>
          <div class="donut-row">
              <div class="donut"><strong id="donutValue">${categoryRows.length}</strong><span id="donutLabel">能力分组</span></div>
            <div class="legend">
              ${categoryRows.map((category) => `<div class="legend-row" data-insight-category="${escapeHtml(category.id)}"><span class="dot" style="--item-color:${escapeHtml(category.color)}"></span><span>${escapeHtml(category.label)}</span><span>${category.count}</span></div>`).join('\n')}
            </div>
          </div>
          <h3>分类数量排行</h3>
          <div class="rank">
            ${categoryRows.map((category) => `<div class="rank-row" data-insight-category="${escapeHtml(category.id)}">
              <div class="rank-top"><span>${escapeHtml(category.label)}</span><span>${category.count}</span></div>
              <div class="bar"><span style="--w:${Math.max(4, Math.round((category.count / maxCategoryCount) * 100))}%;--item-color:${escapeHtml(category.color)}"></span></div>
            </div>`).join('\n')}
          </div>
        </aside>

        <section class="panel map-panel">
          <div class="map-head">
            <div class="map-copy">
              <h3>Skill 列表</h3>
              <p class="map-status" id="updateStatusText">正在读取上次检测记录...</p>
            </div>
          </div>
          <div class="view" id="graphView">
            <div class="graph-workspace">
              <div class="graph-canvas" id="graphCanvas"></div>
              <div class="graph-results">
                <div class="graph-results-head">
                  <span id="graphScopeText">当前结构</span>
                  <strong id="graphResultCount">0 个</strong>
                </div>
                <div class="cards-grid graph-cards-grid" id="graphCardsGrid"></div>
              </div>
            </div>
          </div>
          <div class="view active" id="cardsView">
            <div class="cards-frame">
              <div class="cards-grid" id="cardsGrid"></div>
            </div>
          </div>
          <div class="empty" id="empty">没有匹配的 Skill。</div>
        </section>
      </section>
      </section>
      <section class="section" id="projectsSection">
        <section class="hero">
          <div class="title">
            <h2>项目 Skill 绑定</h2>
            <p>选择项目后启用或禁用 Skill；页面会通过本地服务创建项目内软链接并更新清单。</p>
          </div>
          <div class="index-badge"><div><strong id="projectCount">0</strong><span>projects</span></div></div>
        </section>
        <section class="project-workspace">
          <aside class="panel project-panel project-directory-panel">
            <h3>工作区项目</h3>
            <p class="project-meta" id="projectWorkspaceRoot">正在读取项目...</p>
            <div class="project-directory-tools">
              <input id="projectSearch" type="search" placeholder="搜索项目名称..." />
              <select id="projectGroupFilter" aria-label="筛选项目目录">
                <option value="All">全部目录</option>
              </select>
              <button type="button" class="update-button ghost" id="reloadProjects">刷新项目</button>
            </div>
            <div class="project-list" id="projectList"></div>
          </aside>
          <section class="panel project-panel project-skill-panel">
            <h3 id="projectTitle">选择一个项目</h3>
            <p class="project-meta" id="projectStatus">先从左侧选择项目，再给它启用需要的 Skill。</p>
            <div class="project-skill-tabs" id="projectSkillModeTabs">
              <button type="button" class="active" data-project-skill-mode="enabled">已接入（0）</button>
              <button type="button" data-project-skill-mode="all">全部可绑定（0）</button>
            </div>
            <div class="project-toolbar">
              <input id="projectSkillSearch" type="search" placeholder="搜索可绑定 Skill..." />
              <select id="projectCategoryFilter" aria-label="筛选 Skill 分类">
                ${projectCategoryOptions.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('\n')}
              </select>
            </div>
            <div class="project-skill-list" id="projectSkillList"></div>
          </section>
        </section>
      </section>
      <footer>Generated at ${escapeHtml(index.generatedAt)}. Data source: skills-index.json.</footer>
    </main>
  </div>

  <div class="modal" id="skillModal" aria-hidden="true">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="dialog-head">
        <div>
          <h3 id="modalTitle"></h3>
          <span class="pill" id="modalCategory" style="display:inline-block;margin-top:8px"></span>
        </div>
        <button type="button" class="favorite-button" id="modalFavorite" aria-pressed="false">
          <span class="favorite-star" aria-hidden="true">☆</span>
          <span class="favorite-label">收藏</span>
        </button>
        <button type="button" class="close" id="modalClose" aria-label="关闭">×</button>
      </div>
      <div class="info-box">
        <h4>用途说明</h4>
        <p id="modalDescription"></p>
      </div>
      <div class="info-box">
        <h4>来源更新</h4>
        <p id="modalSource"></p>
        <div style="margin-top:10px">
          <button type="button" class="update-button" data-action="update-skill" id="modalUpdate">更新这个 Skill</button>
        </div>
      </div>
      <div class="info-box">
        <h4>给 Agent 的指令</h4>
        <div class="copy-row">
          <p id="modalCommand">接下来请优先使用这个 Skill。先阅读并遵循该 Skill 的规则，再根据我的具体需求完成任务。</p>
          <button type="button" class="copy" id="copyCommand" aria-live="polite">复制指令</button>
        </div>
      </div>
      <div class="info-box">
        <h4>文件路径</h4>
        <code id="modalPath"></code>
        <div style="margin-top:12px">
          <button type="button" class="update-button danger" id="modalRemove">移除这个 Skill</button>
        </div>
      </div>
    </div>
  </div>
  <div class="modal" id="removeConfirmModal" aria-hidden="true">
    <div class="dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="removeConfirmTitle">
      <div class="dialog-head">
        <div>
          <h3 id="removeConfirmTitle">移除这个 Skill？</h3>
          <span class="pill" style="display:inline-block;margin-top:8px">源库操作</span>
        </div>
        <button type="button" class="close" id="removeConfirmClose" aria-label="关闭">×</button>
      </div>
      <div class="info-box">
        <h4>即将移除</h4>
        <p><strong id="removeConfirmName"></strong></p>
        <p>会先备份到 <code style="display:inline">_backups/</code>，然后从源库和工作台索引中移除。项目里已有的链接可能会变成失效链接，需要按需检查。</p>
      </div>
      <div class="confirm-actions">
        <button type="button" class="update-button ghost" id="removeConfirmCancel">取消</button>
        <button type="button" class="update-button danger" id="removeConfirmSubmit">确认移除</button>
      </div>
    </div>
  </div>
  <div class="modal" id="importModal" aria-hidden="true">
    <div class="dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="importTitle">
      <div class="dialog-head">
        <div>
          <h3 id="importTitle">添加 Skill</h3>
          <span class="pill" style="display:inline-block;margin-top:8px">从 GitHub 导入</span>
        </div>
        <button type="button" class="close" id="importClose" aria-label="关闭">×</button>
      </div>
      <div class="info-box">
        <h4>来源</h4>
        <div class="import-form">
          <input id="importSourceInput" type="text" placeholder="GitHub 地址、owner/repo，或 npx -y skills add ..." />
          <button type="button" class="update-button" id="scanImport">扫描来源</button>
        </div>
        <p class="import-help">多 Skill 仓库默认不勾选；--all 只扫描，不自动全装。</p>
      </div>
      <div class="info-box import-results-box">
        <h4>扫描结果</h4>
        <p class="import-result" id="importResult">输入来源后点击扫描。</p>
        <div class="import-bulk" id="importBulkActions">
          <span id="importBulkStatus">可批量选择待安装项。</span>
          <button type="button" class="update-button ghost" id="toggleImportSelection">全选</button>
        </div>
        <div class="import-list" id="importCandidates"></div>
      </div>
      <div class="info-box">
        <div class="copy-row">
          <p class="import-result" id="importInstallSummary">只安装你勾选的 Skill。</p>
          <button type="button" class="update-button" id="installImport" disabled>安装选中的 Skill</button>
        </div>
      </div>
    </div>
  </div>
  <div class="notice" id="notice"></div>

  <script id="skill-data" type="application/json">${graphDataJson}</script>
  <script>
    const data = JSON.parse(document.getElementById('skill-data').textContent);
    const sectionNav = document.getElementById('sectionNav');
    const skillsSection = document.getElementById('skillsSection');
    const projectsSection = document.getElementById('projectsSection');
    const q = document.getElementById('q');
    const categoryNav = document.getElementById('categoryNav');
    const favoriteCount = document.getElementById('favoriteCount');
    const insights = document.querySelector('.insights');
    const donutValue = document.getElementById('donutValue');
    const donutLabel = document.getElementById('donutLabel');
    const graphCanvas = document.getElementById('graphCanvas');
    const graphCardsGrid = document.getElementById('graphCardsGrid');
    const graphScopeText = document.getElementById('graphScopeText');
    const graphResultCount = document.getElementById('graphResultCount');
    const cardsGrid = document.getElementById('cardsGrid');
    const empty = document.getElementById('empty');
    const modal = document.getElementById('skillModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalCategory = document.getElementById('modalCategory');
    const modalDescription = document.getElementById('modalDescription');
    const modalSource = document.getElementById('modalSource');
    const modalFavorite = document.getElementById('modalFavorite');
    const modalUpdate = document.getElementById('modalUpdate');
    const modalRemove = document.getElementById('modalRemove');
    const modalCommand = document.getElementById('modalCommand');
    const copyCommand = document.getElementById('copyCommand');
    const modalPath = document.getElementById('modalPath');
    const removeConfirmModal = document.getElementById('removeConfirmModal');
    const removeConfirmClose = document.getElementById('removeConfirmClose');
    const removeConfirmName = document.getElementById('removeConfirmName');
    const removeConfirmCancel = document.getElementById('removeConfirmCancel');
    const removeConfirmSubmit = document.getElementById('removeConfirmSubmit');
    const notice = document.getElementById('notice');
    const updateStatusText = document.getElementById('updateStatusText');
    const updateAll = document.getElementById('updateAll');
    const openImport = document.getElementById('openImport');
    const importModal = document.getElementById('importModal');
    const importClose = document.getElementById('importClose');
    const importSourceInput = document.getElementById('importSourceInput');
    const scanImport = document.getElementById('scanImport');
    const installImport = document.getElementById('installImport');
    const importResult = document.getElementById('importResult');
    const importCandidates = document.getElementById('importCandidates');
    const importInstallSummary = document.getElementById('importInstallSummary');
    const importBulkActions = document.getElementById('importBulkActions');
    const importBulkStatus = document.getElementById('importBulkStatus');
    const importSelectionToggle = document.getElementById('toggleImportSelection');
    const projectCount = document.getElementById('projectCount');
    const projectWorkspaceRoot = document.getElementById('projectWorkspaceRoot');
    const projectSearch = document.getElementById('projectSearch');
    const projectGroupFilter = document.getElementById('projectGroupFilter');
    const projectList = document.getElementById('projectList');
    const projectTitle = document.getElementById('projectTitle');
    const projectStatus = document.getElementById('projectStatus');
    const projectSkillModeTabs = document.getElementById('projectSkillModeTabs');
    const projectSkillSearch = document.getElementById('projectSkillSearch');
    const projectCategoryFilter = document.getElementById('projectCategoryFilter');
    const projectSkillList = document.getElementById('projectSkillList');
    const reloadProjects = document.getElementById('reloadProjects');
    const favoriteStorageKey = 'skillSources:favorites:v1';
    const knownSkillSlugs = new Set(data.skills.map((skill) => skill.slug));

    function loadFavoriteSlugs() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(favoriteStorageKey) || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((slug, index) => typeof slug === 'string' && knownSkillSlugs.has(slug) && parsed.indexOf(slug) === index);
      } catch {
        return [];
      }
    }

    const state = {
      section: 'skills',
      category: 'All',
      query: '',
      view: 'cards',
      graphScope: null,
      favoriteSlugs: loadFavoriteSlugs(),
      selectedCommand: '',
      updateStatus: { summary: { needsUpdate: 0 }, skills: {} },
      importSource: null,
      importCandidates: [],
      projects: [],
      projectQuery: '',
      projectGroup: 'All',
      activeProjectId: '',
      activeProject: null,
      projectSkillMode: 'enabled',
      projectCategory: 'All',
      projectSkillQuery: '',
    };

    function getCurrentCategoryLabel() {
      if (state.category === 'All') return '全部 Skill';
      if (state.category === 'Favorites') return '已收藏';
      return data.categories.find((category) => category.id === state.category)?.label || '当前分类';
    }

    function isRealCategory(category) {
      return data.categories.some((item) => item.id === category);
    }

    function currentSyncScope() {
      const visibleSkills = syncableVisibleSkills();
      if (shouldSyncVisibleSelection()) return { type: 'selection', label: visibleSyncLabel(), count: visibleSkills.length, slugs: visibleSkills.map((skill) => skill.slug) };
      if (isRealCategory(state.category)) {
        const currentCategoryCount = visibleSkills.length;
        return { type: 'category', category: state.category, label: getCurrentCategoryLabel(), count: currentCategoryCount };
      }
      return { type: 'all', label: '全部 Skill', count: visibleSkills.length };
    }

    function updateSyncButtonLabel() {
      const syncScope = currentSyncScope();
      updateAll.disabled = syncScope.type === 'selection' && syncScope.slugs.length === 0;
      if (syncScope.count === 0) {
        updateAll.textContent = '暂无可同步结果';
        return;
      }
      updateAll.textContent = '同步当前结果：' + syncScope.label + '（' + syncScope.count + ' 个）';
    }

    function escapeText(value) {
      return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function setSection(section) {
      state.section = section;
      skillsSection.classList.toggle('active', section === 'skills');
      projectsSection.classList.toggle('active', section === 'projects');
      categoryNav.hidden = section !== 'skills';
      for (const button of sectionNav.querySelectorAll('[data-section]')) {
        button.classList.toggle('active', button.dataset.section === section);
      }
      if (section === 'projects' && !state.projects.length) loadProjects();
    }

    function graphScopeLabel(scope) {
      if (!scope) return '全部结构';
      if (scope.type === 'updates') return '有远端更新';
      if (scope.type === 'unbound') return '未绑定来源';
      if (scope.type === 'source-rest') return '其他来源';
      if (scope.type === 'source') return '来源：' + scope.label;
      return scope.label || '当前结构';
    }

    function skillMatchesGraphScope(skill, scope) {
      if (!scope) return true;
      if (scope.type === 'updates') return Boolean(skillUpdateStatus(skill)?.needsUpdate);
      if (scope.type === 'unbound') return !skill.source?.repoUrl;
      if (scope.type === 'source') return skill.source?.repoKey === scope.value;
      if (scope.type === 'source-rest') return scope.values?.includes(skill.source?.repoKey);
      return true;
    }

    function isFavorite(slug) {
      return state.favoriteSlugs.includes(slug);
    }

    function saveFavoriteSlugs() {
      try {
        window.localStorage.setItem(favoriteStorageKey, JSON.stringify(state.favoriteSlugs));
      } catch {
        showNotice('浏览器没有允许保存收藏，本次只能临时显示。');
      }
    }

    function syncFavoriteCount() {
      favoriteCount.textContent = String(state.favoriteSlugs.length);
      updateSyncButtonLabel();
    }

    function renderFavoriteButton(button, slug) {
      const active = isFavorite(slug);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.querySelector('.favorite-star').textContent = active ? '★' : '☆';
      button.querySelector('.favorite-label').textContent = active ? '已收藏' : '收藏';
      button.title = active ? '取消收藏' : '收藏这个 Skill';
    }

    function toggleFavorite(slug) {
      if (!slug) return;
      const skill = data.skills.find((item) => item.slug === slug);
      if (!skill) return;
      state.favoriteSlugs = isFavorite(slug)
        ? state.favoriteSlugs.filter((item) => item !== slug)
        : [...state.favoriteSlugs, slug];
      saveFavoriteSlugs();
      syncFavoriteCount();
      renderFavoriteButton(modalFavorite, slug);
      render();
      showNotice((isFavorite(slug) ? '已收藏 ' : '已取消收藏 ') + (skill.name || skill.slug) + '。');
    }

    function filteredSkills(options = {}) {
      const includeGraphScope = options.includeGraphScope !== false;
      const needle = state.query.toLowerCase();
      return data.skills.filter((skill) => {
        const categoryOk = state.category === 'All' || (state.category === 'Favorites' ? isFavorite(skill.slug) : skill.category === state.category);
        const scopeOk = !includeGraphScope || skillMatchesGraphScope(skill, state.graphScope);
        const haystack = [skill.slug, skill.name, skill.description, skill.zhDescription, skill.path, skill.categoryLabel].join(' ').toLowerCase();
        return categoryOk && scopeOk && (!needle || haystack.includes(needle));
      });
    }

    function syncableVisibleSkills() {
      return filteredSkills().filter((skill) => skill.source?.repoUrl);
    }

    function shouldSyncVisibleSelection() {
      return Boolean(state.query || state.graphScope || state.category === 'Favorites');
    }

    function visibleSyncLabel() {
      if (state.graphScope) return graphScopeLabel(state.graphScope);
      if (state.category === 'Favorites') return '已收藏';
      if (state.query) return '搜索结果';
      return getCurrentCategoryLabel();
    }

    function projectStatusLabel(project) {
      if (!project.initialized) return '未接入';
      if (project.brokenLinks?.length) return '有断链';
      return '已接入';
    }

    function projectGroupLabel(group) {
      if (group === 'skill-sources') return 'Skill 源库';
      return group === 'All' ? '全部目录' : group;
    }

    function projectIdentityLabel(project) {
      return project?.isSourceRoot ? 'Skill 管理项目 / 当前源库' : projectGroupLabel(project?.group);
    }

    function projectListStatus(project) {
      const status = projectStatusLabel(project) + ' · ' + project.enabledCount + ' 个 Skill' + (project.brokenLinks?.length ? ' · ' + project.brokenLinks.length + ' 个断链' : '');
      return project?.isSourceRoot ? projectIdentityLabel(project) + ' · ' + status : status;
    }

    function projectDetailStatus(project, enabled, broken) {
      const identity = project?.isSourceRoot ? ' · ' + projectIdentityLabel(project) : '';
      return project.path + identity + ' · 已启用 ' + enabled + ' 个 Skill' + (broken ? ' · ' + broken + ' 个断链' : '');
    }

    function renderProjectGroupFilter() {
      const groups = [...new Set(state.projects.map((project) => project.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      projectGroupFilter.innerHTML = '<option value="All">全部目录</option>' + groups.map((group) =>
        '<option value="' + escapeText(group) + '">' + escapeText(projectGroupLabel(group)) + '</option>'
      ).join('');
      projectGroupFilter.value = groups.includes(state.projectGroup) ? state.projectGroup : 'All';
      state.projectGroup = projectGroupFilter.value;
    }

    function filteredProjects() {
      const needle = state.projectQuery.toLowerCase();
      return state.projects.filter((project) => {
        const groupOk = state.projectGroup === 'All' || project.group === state.projectGroup;
        const haystack = [project.name, project.id, project.path, project.group, projectIdentityLabel(project)].join(' ').toLowerCase();
        return groupOk && (!needle || haystack.includes(needle));
      });
    }

    function renderProjects() {
      const projects = filteredProjects();
      projectCount.textContent = String(projects.length);
      if (!state.projects.length) {
        projectList.innerHTML = '<p class="project-meta">没有发现工作区项目。</p>';
        return;
      }
      if (!projects.length) {
        projectList.innerHTML = '<p class="project-meta">没有匹配的项目。</p>';
        return;
      }
      projectList.innerHTML = projects.map((project) => '<button type="button" class="project-item' + (project.id === state.activeProjectId ? ' active' : '') + '" data-project-id="' + escapeText(project.id) + '">' +
        '<h4>' + escapeText(project.name) + '</h4>' +
        '<p>' + escapeText(project.id) + '</p>' +
        '<p>' + escapeText(projectListStatus(project)) + '</p>' +
      '</button>').join('');
    }

    function enabledProjectSkills() {
      if (!state.activeProject) return [];
      const availableBySlug = new Map((state.activeProject.availableSkills || []).map((skill) => [skill.slug, skill]));
      return (state.activeProject.enabledSkills || []).map((skill) => {
        const sourceSkill = availableBySlug.get(skill.slug) || {};
        return {
          ...sourceSkill,
          ...skill,
          name: sourceSkill.name || skill.name || skill.slug,
          category: sourceSkill.category || skill.category || 'Other',
          categoryLabel: sourceSkill.categoryLabel || skill.categoryLabel || '通用能力',
          description: sourceSkill.description || skill.description || '还没有说明。',
          zhDescription: sourceSkill.zhDescription || skill.zhDescription || '',
          sourceDescription: sourceSkill.sourceDescription || skill.sourceDescription || '',
          enabled: true,
        };
      });
    }

    function renderProjectSkillModeTabs() {
      const enabledCount = enabledProjectSkills().length;
      const availableCount = state.activeProject?.availableSkills?.length || 0;
      projectSkillModeTabs.querySelector('[data-project-skill-mode="enabled"]').textContent = '已接入（' + enabledCount + '）';
      projectSkillModeTabs.querySelector('[data-project-skill-mode="all"]').textContent = '全部可绑定（' + availableCount + '）';
      for (const button of projectSkillModeTabs.querySelectorAll('[data-project-skill-mode]')) {
        button.classList.toggle('active', button.dataset.projectSkillMode === state.projectSkillMode);
      }
    }

    function setProjectSkillMode(mode) {
      state.projectSkillMode = mode === 'all' ? 'all' : 'enabled';
      renderProjectSkillList();
    }

    function renderProjectSkillList() {
      if (!state.activeProject) {
        renderProjectSkillModeTabs();
        projectSkillList.innerHTML = '<p class="project-meta">选择项目后显示可绑定 Skill。</p>';
        return;
      }
      renderProjectSkillModeTabs();
      const needle = state.projectSkillQuery.toLowerCase();
      const sourceSkills = state.projectSkillMode === 'enabled' ? enabledProjectSkills() : (state.activeProject.availableSkills || []);
      const skills = sourceSkills.filter((skill) => {
        const projectCategoryOk = state.projectCategory === 'All' || skill.category === state.projectCategory;
        if (!projectCategoryOk) return false;
        const haystack = [skill.slug, skill.name, skill.zhDescription, skill.description, skill.categoryLabel].join(' ').toLowerCase();
        return !needle || haystack.includes(needle);
      });
      if (!skills.length && state.projectSkillMode === 'enabled') {
        projectSkillList.innerHTML = '<article class="project-skill-item"><span><h4>这个项目还没有接入 Skill。</h4><p>切到全部可绑定，给项目启用需要的 Skill。</p></span><button type="button" class="update-button" data-project-skill-mode-empty="all">去启用</button></article>';
        return;
      }
      projectSkillList.innerHTML = skills.map((skill) => {
        const action = skill.enabled ? 'disable' : 'enable';
        const buttonText = skill.enabled ? '禁用' : '启用';
        return '<article class="project-skill-item">' +
          '<span><h4>' + escapeText(skill.name || skill.slug) + '</h4>' +
          '<p>' + escapeText(skill.zhDescription || skill.description || '还没有说明。') + '</p>' +
          '<p>' + escapeText(skill.categoryLabel || '通用能力') + ' · ' + (skill.enabled ? '已启用' : '未启用') + '</p></span>' +
          '<button type="button" class="update-button' + (skill.enabled ? ' ghost' : '') + '" data-project-skill="' + escapeText(skill.slug) + '" data-project-action="' + action + '">' + buttonText + '</button>' +
        '</article>';
      }).join('') || '<p class="project-meta">没有匹配的 Skill。</p>';
    }

    async function loadProjects() {
      projectWorkspaceRoot.textContent = '正在读取工作区项目...';
      try {
        const response = await fetch('/api/projects');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || '读取项目失败');
        state.projects = payload.projects || [];
        projectWorkspaceRoot.textContent = payload.workspaceRoot || '工作区';
        renderProjectGroupFilter();
        if (!state.activeProjectId && state.projects[0]) {
          await openProject(state.projects[0].id);
        } else {
          renderProjects();
        }
      } catch (error) {
        projectWorkspaceRoot.textContent = '静态页面不能操作项目；请用 node scripts/skill-workbench.mjs serve 启动本地服务。';
        projectList.innerHTML = '<p class="project-meta">读取失败：' + escapeText(error.message || '未知错误') + '</p>';
      }
    }

    async function openProject(projectId) {
      state.activeProjectId = projectId;
      state.projectSkillMode = 'enabled';
      const project = state.projects.find((item) => item.id === projectId);
      projectTitle.textContent = project ? project.name : projectId;
      projectStatus.textContent = '正在读取项目 Skill 状态...';
      renderProjects();
      try {
        const response = await fetch('/api/projects/' + encodeURIComponent(projectId) + '/skills');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || '读取项目 Skill 状态失败');
        state.activeProject = payload.project;
        const enabled = state.activeProject.enabledSkills?.length || 0;
        const broken = state.activeProject.report?.brokenLinks?.length || 0;
        projectStatus.textContent = projectDetailStatus(state.activeProject, enabled, broken);
        renderProjectSkillList();
      } catch (error) {
        state.activeProject = null;
        projectStatus.textContent = '读取失败：' + (error.message || '未知错误');
        renderProjectSkillList();
      }
    }

    async function setProjectSkill(slug, action, button) {
      if (!state.activeProjectId) return;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = action === 'enable' ? '启用中...' : '禁用中...';
      try {
        const response = await fetch('/api/projects/' + encodeURIComponent(state.activeProjectId) + '/skills/' + encodeURIComponent(slug) + '/' + action, { method: 'POST' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || '项目 Skill 操作失败');
        state.activeProject = payload.project;
        projectStatus.textContent = projectDetailStatus(payload.project, payload.project.enabledSkills.length, payload.project.report.brokenLinks.length);
        state.projects = state.projects.map((project) => project.id === state.activeProjectId
          ? { ...project, initialized: true, enabledCount: payload.project.enabledSkills.length, brokenLinks: payload.project.report.brokenLinks, nonSymlinkEntries: payload.project.report.nonSymlinkEntries, totalLinks: payload.project.report.totalLinks, isSourceRoot: payload.project.isSourceRoot }
          : project);
        renderProjects();
        renderProjectSkillList();
        showNotice((action === 'enable' ? '已启用 ' : '已禁用 ') + slug + '。');
      } catch (error) {
        showNotice('项目 Skill 操作失败：' + (error.message || '未知错误'));
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    }

    function showNotice(message) {
      notice.textContent = message;
      notice.classList.add('show');
      window.clearTimeout(showNotice.timer);
      showNotice.timer = window.setTimeout(() => notice.classList.remove('show'), 5200);
    }

    function skillUpdateStatus(skill) {
      return state.updateStatus.skills?.[skill.slug] || null;
    }

    function formatUpdateTime(value) {
      if (!value) return '未知时间';
      try {
        return new Date(value).toLocaleString('zh-CN', { hour12: false });
      } catch {
        return value;
      }
    }

    function setUpdateSummary(status) {
      state.updateStatus = status || { summary: { needsUpdate: 0 }, skills: {} };
      const summary = state.updateStatus.summary || {};
      const count = summary.needsUpdate || 0;
      if (!state.updateStatus.cached) {
        updateStatusText.textContent = '还没有检测记录，点击“同步全部 Skill”会检测 GitHub 来源并自动更新有变化的 Skill。';
      } else {
        const detectedAt = formatUpdateTime(state.updateStatus.generatedAt);
        updateStatusText.textContent = count
          ? '上次检测：' + detectedAt + '，发现 ' + count + ' 个 Skill 有远端更新。点击“同步全部 Skill”会重新检测并自动更新。'
          : '上次检测：' + detectedAt + '，所有已绑定来源的 Skill 都是最新。';
      }
      updateAll.hidden = false;
      updateSyncButtonLabel();
      render();
    }

    async function loadUpdateStatus() {
      try {
        const response = await fetch('/api/update-status');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || '读取缓存失败');
        setUpdateSummary(payload);
      } catch (error) {
        updateStatusText.textContent = '静态页面不能读取更新缓存；请用 node scripts/skill-workbench.mjs serve 启动本地服务。';
        updateAll.hidden = true;
      }
    }

    async function updateSkill(slug, button) {
      const skill = data.skills.find((item) => item.slug === slug);
      if (!skill?.source?.repoUrl) {
        showNotice('这个 Skill 还没有确认 GitHub 来源，先放在未绑定来源里。');
        return;
      }
      const original = button?.textContent || '更新';
      if (button) {
        button.disabled = true;
        button.textContent = '更新中...';
      }
      try {
        const response = await fetch('/api/skills/' + encodeURIComponent(slug) + '/update', { method: 'POST' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || '更新失败');
        await loadUpdateStatus();
        showNotice('已更新 ' + slug + '，页面数据也已重新生成。');
      } catch (error) {
        showNotice('无法直接更新：请用 node scripts/skill-workbench.mjs serve 启动本地服务后再点按钮。' + (error.message ? '（' + error.message + '）' : ''));
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = original;
        }
      }
    }

    function openRemoveConfirm(slug) {
      if (!slug) return;
      state.pendingRemoveSlug = slug;
      removeConfirmName.textContent = slug;
      removeConfirmSubmit.disabled = false;
      removeConfirmSubmit.textContent = '确认移除';
      removeConfirmModal.classList.add('open');
      removeConfirmModal.setAttribute('aria-hidden', 'false');
      window.setTimeout(() => removeConfirmCancel.focus(), 0);
    }

    function closeRemoveConfirm() {
      removeConfirmModal.classList.remove('open');
      removeConfirmModal.setAttribute('aria-hidden', 'true');
      state.pendingRemoveSlug = null;
    }

    async function removeSkill(slug, button) {
      if (!slug) return;
      const original = button?.textContent || '确认移除';
      if (button) {
        button.disabled = true;
        button.textContent = '移除中...';
      }
      try {
        const response = await fetch('/api/skills/' + encodeURIComponent(slug) + '/remove', { method: 'POST' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || '移除失败');
        showNotice('已移除 ' + slug + '，源目录已备份。页面将刷新。');
        closeRemoveConfirm();
        window.setTimeout(() => window.location.reload(), 600);
      } catch (error) {
        showNotice('无法直接移除：请用 node scripts/skill-workbench.mjs serve 启动本地服务后再点按钮。' + (error.message ? '（' + error.message + '）' : ''));
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = original;
        }
      }
    }

    function setCategory(category) {
      state.category = category;
      state.graphScope = null;
      for (const button of categoryNav.querySelectorAll('button')) {
        button.classList.toggle('active', button.dataset.category === category);
      }
      updateInsightSelection();
      updateSyncButtonLabel();
      render();
    }

    function setGraphScope(scope) {
      state.graphScope = scope;
      render();
    }

    function updateInsightSelection() {
      const activeCategory = data.categories.find((category) => category.id === state.category);
      insights.classList.toggle('filtered', Boolean(activeCategory));
      for (const node of insights.querySelectorAll('[data-insight-category]')) {
        node.classList.toggle('active', node.dataset.insightCategory === state.category);
      }
      donutValue.textContent = state.category === 'Favorites' ? String(state.favoriteSlugs.length) : (activeCategory ? String(activeCategory.count) : String(data.categories.length));
      donutLabel.textContent = state.category === 'Favorites' ? '已收藏' : (activeCategory ? activeCategory.short : '能力分组');
    }

    function setView(view) {
      state.view = view;
      document.getElementById('graphView').classList.toggle('active', view === 'graph');
      document.getElementById('cardsView').classList.toggle('active', view === 'cards');
      render();
    }

    function openSkill(skill) {
      modalTitle.textContent = skill.name || skill.slug;
      modalCategory.textContent = skill.categoryLabel;
      modalCategory.style.background = skill.categoryColor + '24';
      modalDescription.textContent = skill.zhDescription || '还没有中文说明。';
      const status = skillUpdateStatus(skill);
      modalSource.textContent = skill.source?.repoUrl ? ('GitHub 来源：' + skill.source.repoKey + ' · 路径：' + skill.source.sourcePath + ' · 状态：' + (status?.status || '未检测')) : '还没有确认 GitHub 来源，暂不提供自动更新。';
      modalUpdate.dataset.slug = skill.slug;
      modalUpdate.hidden = !status?.needsUpdate;
      modalRemove.dataset.slug = skill.slug;
      modalFavorite.dataset.slug = skill.slug;
      renderFavoriteButton(modalFavorite, skill.slug);
      modalCommand.textContent = skill.command;
      copyCommand.textContent = '复制指令';
      copyCommand.classList.remove('copied', 'failed');
      modalPath.textContent = skill.skillFile || skill.path;
      state.selectedCommand = skill.command;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeSkill() {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }

    function openImportModal() {
      importModal.classList.add('open');
      importModal.setAttribute('aria-hidden', 'false');
      window.setTimeout(() => importSourceInput.focus(), 0);
    }

    function closeImportModal() {
      importModal.classList.remove('open');
      importModal.setAttribute('aria-hidden', 'true');
    }

    function importConflictText(candidate) {
      if (!candidate.existsLocally) return '新 Skill';
      if (candidate.conflictType === 'same-source') return '本地已存在，来源一致';
      if (candidate.conflictType === 'different-source') return '本地已存在，来源不同';
      return '本地已存在，未绑定来源';
    }

    function importSelectableCandidates() {
      return state.importCandidates.filter((candidate) => candidate.action !== 'skip');
    }

    function syncImportSelectionToggle() {
      const selectable = importSelectableCandidates();
      importBulkActions.classList.toggle('show', state.importCandidates.length > 0);
      importSelectionToggle.disabled = selectable.length === 0;
      const selectedCount = selectable.filter((candidate) => candidate.selected).length;
      const shouldSelect = selectable.some((candidate) => !candidate.selected);
      importSelectionToggle.textContent = shouldSelect ? '全选' : '取消全选';
      importBulkStatus.textContent = selectable.length
        ? '可安装 ' + selectable.length + ' 个，已选择 ' + selectedCount + ' 个。'
        : '当前没有可安装的候选项。';
    }

    function toggleImportSelection() {
      const selectable = importSelectableCandidates();
      const shouldSelect = selectable.some((candidate) => !candidate.selected);
      selectable.forEach((candidate) => { candidate.selected = shouldSelect; });
      renderImportCandidates();
    }

    function renderImportCandidates() {
      const selectedCount = state.importCandidates.filter((candidate) => candidate.selected && candidate.action !== 'skip').length;
      installImport.disabled = selectedCount === 0;
      importInstallSummary.textContent = selectedCount
        ? '已选择 ' + selectedCount + ' 个 Skill，安装后会写入本地原件库并绑定来源。'
        : '只安装你勾选的 Skill。';
      if (!state.importCandidates.length) {
        importCandidates.innerHTML = '';
        syncImportSelectionToggle();
        return;
      }
      importCandidates.innerHTML = state.importCandidates.map((candidate, index) => {
        const actionOptions = candidate.existsLocally
          ? '<option value="skip"' + (candidate.action === 'skip' ? ' selected' : '') + '>跳过</option><option value="overwrite"' + (candidate.action === 'overwrite' ? ' selected' : '') + '>覆盖并备份</option>'
          : '<option value="install" selected>安装</option>';
        return '<label class="import-candidate">' +
          '<input type="checkbox" data-import-select="' + index + '"' + (candidate.selected ? ' checked' : '') + ' />' +
          '<span><h5>' + escapeText(candidate.name || candidate.slug) + '</h5>' +
          '<p>' + escapeText(importConflictText(candidate)) + ' · ' + escapeText(candidate.sourcePath) + '</p>' +
          '<p>' + escapeText(candidate.description || '还没有说明。') + '</p></span>' +
          '<select data-import-action="' + index + '">' + actionOptions + '</select>' +
        '</label>';
      }).join('');
      syncImportSelectionToggle();
    }

    function formatImportInstallError(payload) {
      if (payload?.error) return payload.error;
      const failures = (payload?.results || []).filter((item) => item.status === 'failed');
      if (failures.length) {
        return '部分 Skill 安装失败：' + failures.map((item) => item.slug + ': ' + (item.error || '未知错误')).join('；');
      }
      return '安装失败';
    }

    async function scanImportSourceFromUi() {
      const input = importSourceInput.value.trim();
      if (!input) {
        importResult.textContent = '先输入 GitHub 地址、owner/repo，或 npx skills add 命令。';
        return;
      }
      scanImport.disabled = true;
      installImport.disabled = true;
      scanImport.textContent = '扫描中...';
      importResult.textContent = '正在读取 GitHub 来源并扫描 SKILL.md...';
      importCandidates.innerHTML = '';
      state.importSource = null;
      state.importCandidates = [];
      try {
        const response = await fetch('/api/import/scan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || '扫描失败');
        state.importSource = payload.source;
        state.importCandidates = (payload.candidates || []).map((candidate) => ({
          ...candidate,
          source: payload.source,
          selected: false,
          action: candidate.existsLocally ? 'skip' : 'install',
        }));
        importResult.textContent = state.importCandidates.length
          ? '找到 ' + state.importCandidates.length + ' 个 Skill。请勾选要安装的项。'
          : '没有在这个来源里找到 SKILL.md。';
        renderImportCandidates();
      } catch (error) {
        importResult.textContent = '扫描失败：' + (error.message || '未知错误');
        showNotice('扫描失败：' + (error.message || '未知错误'));
      } finally {
        scanImport.disabled = false;
        scanImport.textContent = '扫描来源';
      }
    }

    function openNewSkillsFromSync(groups) {
      const candidates = (groups || []).flatMap((group) => (group.candidates || []).map((candidate) => ({
        ...candidate,
        source: group.source,
        selected: false,
        action: candidate.existsLocally ? 'skip' : 'install',
      }))).filter((candidate) => !candidate.existsLocally);
      if (!candidates.length) return;
      const sourceLabels = [...new Set(candidates.map((candidate) => candidate.source?.repoKey).filter(Boolean))];
      state.importSource = candidates.length ? candidates[0].source : null;
      state.importCandidates = candidates;
      importSourceInput.value = sourceLabels.join(', ');
      importResult.textContent = '同步发现 ' + candidates.length + ' 个新增 Skill。请勾选要添加的项。';
      openImportModal();
      renderImportCandidates();
    }

    async function installSelectedImports() {
      const selectedCandidates = state.importCandidates.filter((candidate) => candidate.selected && candidate.action !== 'skip');
      const groups = new Map();
      for (const candidate of selectedCandidates) {
        const source = candidate.source || state.importSource;
        if (!source?.repoKey) continue;
        if (!groups.has(source.repoKey)) groups.set(source.repoKey, { source, items: [] });
        const group = groups.get(source.repoKey);
        group.items.push({ slug: candidate.slug, sourcePath: candidate.sourcePath, action: candidate.action });
      }
      if (!groups.size) {
        importInstallSummary.textContent = '先扫描来源并勾选要安装的 Skill。';
        return;
      }
      installImport.disabled = true;
      scanImport.disabled = true;
      installImport.textContent = '安装中...';
      importInstallSummary.textContent = '正在复制 Skill、写入来源规则并重建页面...';
      try {
        let installed = 0;
        for (const group of groups.values()) {
          const response = await fetch('/api/import/install', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ source: group.source, items: group.items, skipGitRefresh: true }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || payload.summary?.failed) throw new Error(formatImportInstallError(payload));
          const summary = payload.summary || {};
          installed += (summary.installed || 0) + (summary.overwritten || 0);
        }
        if (!installed) throw new Error('没有安装任何 Skill，请检查候选项是否已选择。');
        importInstallSummary.textContent = '已安装 ' + installed + ' 个 Skill，页面即将刷新。';
        showNotice('已安装 ' + installed + ' 个 Skill，并已更新来源绑定。');
        window.setTimeout(() => window.location.reload(), 900);
      } catch (error) {
        importInstallSummary.textContent = '安装失败：' + (error.message || '未知错误');
        showNotice('安装失败：' + (error.message || '未知错误'));
        installImport.disabled = false;
      } finally {
        scanImport.disabled = false;
        installImport.textContent = '安装选中的 Skill';
      }
    }

    function renderOverviewGraph(skills, width, height, cx, cy, activeCategories) {
      const radius = Math.min(178, Math.max(110, 74 + activeCategories.length * 12));
      const categoryNodes = activeCategories.map((category, index) => {
        const angle = (-90 + index * (360 / Math.max(1, activeCategories.length))) * Math.PI / 180;
        return { ...category, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
      });
      const lines = categoryNodes.map((node) => '<line class="edge" x1="' + cx + '" y1="' + cy + '" x2="' + node.x + '" y2="' + node.y + '"></line>').join('');
      const categorySvg = categoryNodes.map((node) => {
        const count = skills.filter((skill) => skill.category === node.id).length;
        return '<g class="node category" data-category="' + escapeText(node.id) + '" transform="translate(' + node.x + ' ' + node.y + ')">' +
          '<circle r="39" fill="' + node.color + '" fill-opacity=".78" stroke="rgba(255,255,255,.72)" stroke-width="3"></circle>' +
          '<text text-anchor="middle" y="-4" font-size="12">' + escapeText(node.short) + '</text>' +
          '<text text-anchor="middle" y="13" font-size="12">' + count + ' 展开</text>' +
        '</g>';
      }).join('');
      graphCanvas.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Skill 知识图谱">' +
        '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="rgba(255,255,255,.22)"></rect>' +
        lines +
        '<g class="node root" data-category="All" transform="translate(' + cx + ' ' + cy + ')"><circle r="42" fill="#4f7f75" fill-opacity=".72" stroke="rgba(255,255,255,.8)" stroke-width="3"></circle><text text-anchor="middle" y="-4" font-size="14">全部 Skill</text><text text-anchor="middle" y="14" font-size="13">' + skills.length + ' 个</text></g>' +
        categorySvg +
      '</svg>';
    }

    function shortSourceLabel(value) {
      const text = String(value || 'GitHub 来源');
      if (text.startsWith('https://github.com/')) return text.slice('https://github.com/'.length);
      if (text.startsWith('github.com/')) return text.slice('github.com/'.length);
      return text;
    }

    function graphNodeLabel(value, maxLength = 16) {
      const text = String(value || '').trim();
      if (text.length <= maxLength) return text;
      return text.slice(0, Math.max(0, maxLength - 3)) + '...';
    }

    function selectedCategoryGraphGroups(skills) {
      const groups = [];
      const updateCount = skills.filter((skill) => skillUpdateStatus(skill)?.needsUpdate).length;
      const unboundCount = skills.filter((skill) => !skill.source?.repoUrl).length;
      const sources = new Map();

      skills.forEach((skill) => {
        if (!skill.source?.repoUrl || !skill.source?.repoKey) return;
        const key = skill.source.repoKey;
        if (!sources.has(key)) {
          sources.set(key, {
            key: 'source:' + key,
            type: 'source',
            value: key,
            label: shortSourceLabel(skill.source.label || key),
            color: skill.categoryColor,
            count: 0,
          });
        }
        sources.get(key).count += 1;
      });

      if (updateCount) groups.push({ key: 'status:updates', type: 'updates', label: '有远端更新', color: '#a86427', count: updateCount });
      if (unboundCount) groups.push({ key: 'source:unbound', type: 'unbound', label: '未绑定来源', color: '#c7b9a4', count: unboundCount });

      const sourceGroups = [...sources.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      const visibleSources = sourceGroups.slice(0, 5);
      const hiddenSources = sourceGroups.slice(5);
      groups.push(...visibleSources);
      if (hiddenSources.length) {
        groups.push({
          key: 'source:rest',
          type: 'source-rest',
          values: hiddenSources.map((group) => group.value),
          label: '其他来源',
          color: '#8fb7ff',
          count: hiddenSources.reduce((sum, group) => sum + group.count, 0),
        });
      }
      if (!groups.length) groups.push({ key: 'scope:all', type: 'all', label: '当前列表', color: '#4f7f75', count: skills.length });
      return groups;
    }

    function selectedCategoryGroupNodes(groups, categoryNode) {
      const columnCount = groups.length > 5 ? 2 : 1;
      const rowsPerColumn = Math.ceil(groups.length / columnCount);
      const columnGap = 142;
      const rowGap = Math.min(92, Math.max(58, 340 / Math.max(1, rowsPerColumn - 1)));
      const startX = categoryNode.x + 138;
      const startY = categoryNode.y - ((rowsPerColumn - 1) * rowGap) / 2;
      return groups.map((group, index) => {
        const column = Math.floor(index / rowsPerColumn);
        const row = index % rowsPerColumn;
        return {
          ...group,
          x: startX + column * columnGap,
          y: startY + row * rowGap,
        };
      });
    }

    function renderSelectedCategoryGraph(skills, category, width, height, cx, cy, groups) {
      const root = { x: 86, y: cy };
      const categoryNode = { x: 246, y: cy };
      const groupNodes = selectedCategoryGroupNodes(groups, categoryNode);
      const groupLines = groupNodes.map((node) => '<line class="edge" x1="' + categoryNode.x + '" y1="' + categoryNode.y + '" x2="' + node.x + '" y2="' + node.y + '"></line>').join('');
      const groupSvg = groupNodes.map((group) => {
        const isActive = state.graphScope?.key === group.key;
        return '<g class="node group' + (isActive ? ' active-scope' : '') + '" data-graph-scope="' + escapeText(group.key) + '" transform="translate(' + group.x + ' ' + group.y + ')">' +
          '<circle r="34" fill="rgba(255,255,255,.84)" stroke="' + group.color + '" stroke-width="3.5"></circle>' +
          '<text text-anchor="middle" y="-4" font-size="13">' + escapeText(String(group.count)) + '</text>' +
          '<text text-anchor="middle" y="14" font-size="10">' + escapeText(group.type === 'source' ? '来源' : '状态') + '</text>' +
          '<text class="graph-node-label" text-anchor="middle" y="50">' + escapeText(graphNodeLabel(group.label)) + '</text>' +
          '<title>' + escapeText(graphScopeLabel(group)) + '</title>' +
        '</g>';
      }).join('');
      graphCanvas.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Skill 知识图谱">' +
        '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="rgba(255,255,255,.22)"></rect>' +
        '<line class="edge" x1="' + root.x + '" y1="' + root.y + '" x2="' + categoryNode.x + '" y2="' + categoryNode.y + '"></line>' +
        groupLines +
        '<g class="node root" data-category="All" transform="translate(' + root.x + ' ' + root.y + ')"><circle r="44" fill="#4f7f75" fill-opacity=".78" stroke="rgba(255,255,255,.8)" stroke-width="3"></circle><text text-anchor="middle" y="4" font-size="14">全部 Skill</text></g>' +
        '<g class="node category" data-category="' + escapeText(category.id) + '" transform="translate(' + categoryNode.x + ' ' + categoryNode.y + ')">' +
          '<circle r="48" fill="' + category.color + '" fill-opacity=".72" stroke="rgba(233,154,170,.72)" stroke-width="5"></circle>' +
          '<text text-anchor="middle" y="-4" font-size="12">' + escapeText(category.short) + '</text>' +
          '<text text-anchor="middle" y="13" font-size="12">' + skills.length + ' 个</text>' +
        '</g>' +
        groupSvg +
      '</svg>';
    }

    function renderGraph(skills) {
      const showCategoryDetail = isRealCategory(state.category);
      const width = showCategoryDetail ? 640 : 860;
      const height = 474;
      const cx = width / 2;
      const cy = height / 2;
      const activeCategories = data.categories.filter((category) => showCategoryDetail ? category.id === state.category : skills.some((skill) => skill.category === category.id));
      let graphGroups = [];
      if (showCategoryDetail && activeCategories[0]) {
        graphGroups = selectedCategoryGraphGroups(skills);
        renderSelectedCategoryGraph(skills, activeCategories[0], width, height, cx, cy, graphGroups);
      } else {
        renderOverviewGraph(skills, width, height, cx, cy, activeCategories);
      }
      graphCanvas.querySelectorAll('[data-category]').forEach((node) => node.addEventListener('click', () => {
        if (state.graphScope && node.dataset.category === state.category) {
          setGraphScope(null);
          return;
        }
        const nextCategory = node.dataset.category === 'All' || state.category === node.dataset.category ? 'All' : node.dataset.category;
        setCategory(nextCategory);
      }));
      graphCanvas.querySelectorAll('[data-graph-scope]').forEach((node) => node.addEventListener('click', () => {
        const group = graphGroups.find((item) => item.key === node.dataset.graphScope);
        if (!group) return;
        setGraphScope(state.graphScope?.key === group.key ? null : group);
      }));
    }

    function bindSkillCards(container) {
      container.querySelectorAll('[data-skill]').forEach((node) => node.addEventListener('click', () => {
        const skill = data.skills.find((item) => item.slug === node.dataset.skill);
        if (skill) openSkill(skill);
      }));
      container.querySelectorAll('[data-action="update-skill"]').forEach((node) => node.addEventListener('click', (event) => {
        event.stopPropagation();
        updateSkill(node.dataset.updateSlug, node);
      }));
    }

    function renderRows(skills) {
      const cards = skills.map((skill, index) => {
        const status = skillUpdateStatus(skill);
        const sourceClass = status?.needsUpdate ? ' update' : (skill.source?.repoUrl ? ' bound' : ' unbound');
        const sourceText = status?.needsUpdate ? '有更新' : (skill.source?.repoUrl ? '已绑定来源' : '未绑定来源');
        return '<article class="skill-card">' +
        '<button type="button" class="card-open" data-skill="' + escapeText(skill.slug) + '">' +
          '<span class="num">' + String(index + 1).padStart(2, '0') + '</span>' +
          '<span class="skill-summary"><h4>' + escapeText(skill.name || skill.slug) + '</h4><p>' + escapeText(skill.zhDescription || '还没有中文说明。') + '</p><span class="path">' + escapeText(skill.path) + '</span></span>' +
        '</button>' +
        '<div class="card-actions">' +
          '<span class="source-pill' + sourceClass + '">' + sourceText + '</span>' +
          (status?.needsUpdate ? '<button type="button" class="update-button card-update-button" data-action="update-skill" data-update-slug="' + escapeText(skill.slug) + '">更新</button>' : '') +
        '</div>' +
      '</article>';
      }).join('');
      cardsGrid.innerHTML = cards;
      graphCardsGrid.innerHTML = cards;
      graphScopeText.textContent = state.category === 'All'
        ? '全部 Skill'
        : (state.graphScope ? graphScopeLabel(state.graphScope) : getCurrentCategoryLabel());
      graphResultCount.textContent = skills.length + ' 个';
      bindSkillCards(cardsGrid);
      bindSkillCards(graphCardsGrid);
    }

    function applyFilters() {
      state.query = q.value.trim();
      render();
    }

    function render() {
      const skills = filteredSkills();
      const graphSkills = filteredSkills({ includeGraphScope: false });
      empty.style.display = skills.length ? 'none' : 'block';
      renderGraph(graphSkills);
      renderRows(skills);
      updateSyncButtonLabel();
    }

    q.addEventListener('input', applyFilters);
    sectionNav.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-section]');
      if (button) setSection(button.dataset.section);
    });
    categoryNav.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-category]');
      if (button) setCategory(button.dataset.category);
    });
    projectList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-project-id]');
      if (button) openProject(button.dataset.projectId);
    });
    projectSearch.addEventListener('input', () => {
      state.projectQuery = projectSearch.value.trim();
      renderProjects();
    });
    projectGroupFilter.addEventListener('change', () => {
      state.projectGroup = projectGroupFilter.value;
      renderProjects();
    });
    projectSkillModeTabs.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-project-skill-mode]');
      if (button) setProjectSkillMode(button.dataset.projectSkillMode);
    });
    projectSkillSearch.addEventListener('input', () => {
      state.projectSkillQuery = projectSkillSearch.value.trim();
      renderProjectSkillList();
    });
    projectCategoryFilter.addEventListener('change', () => {
      state.projectCategory = projectCategoryFilter.value;
      renderProjectSkillList();
    });
    projectSkillList.addEventListener('click', (event) => {
      const modeButton = event.target.closest('button[data-project-skill-mode-empty]');
      if (modeButton) {
        setProjectSkillMode(modeButton.dataset.projectSkillModeEmpty);
        return;
      }
      const button = event.target.closest('button[data-project-skill]');
      if (button) setProjectSkill(button.dataset.projectSkill, button.dataset.projectAction, button);
    });
    reloadProjects.addEventListener('click', loadProjects);
    document.getElementById('modalClose').addEventListener('click', closeSkill);
    modal.addEventListener('click', (event) => { if (event.target === modal) closeSkill(); });
    async function copyText(text) {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(text);
          return;
        } catch {}
      }
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(modalCommand);
      selection.removeAllRanges();
      selection.addRange(range);
      const copied = document.execCommand('copy');
      if (copied) selection.removeAllRanges();
      if (!copied) throw new Error('copy command failed');
    }

    copyCommand.addEventListener('click', async () => {
      const original = '复制指令';
      copyCommand.disabled = true;
      copyCommand.classList.remove('copied', 'failed');
      try {
        await copyText(state.selectedCommand);
        copyCommand.textContent = '已复制';
        copyCommand.classList.add('copied');
        showNotice('已复制给 Agent 的指令，可以直接粘贴使用。');
      } catch {
        copyCommand.textContent = '复制失败';
        copyCommand.classList.add('failed');
        showNotice('复制失败：已帮你选中这段指令，可以按 Cmd+C 手动复制。');
      } finally {
        window.setTimeout(() => {
          copyCommand.disabled = false;
          copyCommand.textContent = original;
          copyCommand.classList.remove('copied', 'failed');
        }, 1600);
      }
    });
    modalUpdate.addEventListener('click', () => updateSkill(modalUpdate.dataset.slug, modalUpdate));
    modalFavorite.addEventListener('click', () => toggleFavorite(modalFavorite.dataset.slug));
    modalRemove.addEventListener('click', () => openRemoveConfirm(modalRemove.dataset.slug));
    removeConfirmClose.addEventListener('click', closeRemoveConfirm);
    removeConfirmCancel.addEventListener('click', closeRemoveConfirm);
    removeConfirmModal.addEventListener('click', (event) => { if (event.target === removeConfirmModal) closeRemoveConfirm(); });
    removeConfirmSubmit.addEventListener('click', () => removeSkill(state.pendingRemoveSlug, removeConfirmSubmit));
    openImport.addEventListener('click', openImportModal);
    importClose.addEventListener('click', closeImportModal);
    importModal.addEventListener('click', (event) => { if (event.target === importModal) closeImportModal(); });
    scanImport.addEventListener('click', scanImportSourceFromUi);
    installImport.addEventListener('click', installSelectedImports);
    importSelectionToggle.addEventListener('click', toggleImportSelection);
    importSourceInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') scanImportSourceFromUi();
    });
    importCandidates.addEventListener('change', (event) => {
      const selectIndex = event.target.dataset.importSelect;
      const actionIndex = event.target.dataset.importAction;
      if (selectIndex !== undefined) {
        state.importCandidates[Number(selectIndex)].selected = event.target.checked;
      }
      if (actionIndex !== undefined) {
        state.importCandidates[Number(actionIndex)].action = event.target.value;
      }
      renderImportCandidates();
    });
    async function syncSkills() {
      const syncScope = currentSyncScope();
      if (syncScope.type === 'selection' && syncScope.slugs.length === 0) {
        showNotice('当前结果里没有可同步的 Skill。');
        return;
      }
      const scope = syncScope.type;
      const button = updateAll;
      const original = button.textContent;
      let statusRefreshed = false;
      const syncTimeoutMs = 180000;
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), syncTimeoutMs);
      const categoryQuery = syncScope.type === 'category' ? '?category=' + encodeURIComponent(syncScope.category) : '';
      const syncPath = syncScope.type === 'selection' ? '/api/skills/update-selected' : '/api/skills/update-all' + categoryQuery;
      const requestBody = syncScope.type === 'selection' ? { slugs: syncScope.slugs } : null;
      updateAll.disabled = true;
      button.textContent = scope === 'selection' ? '同步当前结果中...' : (scope === 'category' ? '同步当前分类中...' : '检测并同步中...');
      if (scope === 'category') {
        updateStatusText.textContent = '正在检测并同步当前分类：' + syncScope.label + '...';
      } else if (scope === 'selection') {
        updateStatusText.textContent = '正在检测并同步当前结果：' + syncScope.label + '（' + syncScope.slugs.length + ' 个 Skill）...';
      } else {
        updateStatusText.textContent = '正在检测并同步所有已绑定来源的 Skill...';
      }
      try {
        const response = await fetch(syncPath, {
          method: 'POST',
          headers: requestBody ? { 'content-type': 'application/json' } : undefined,
          body: requestBody ? JSON.stringify(requestBody) : undefined,
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || '一键同步失败');
        if (scope === 'selection' && payload.scope !== 'slugs') throw new Error('本地服务版本较旧，请重启 Skill 源库服务后再同步当前结果。');
        await loadUpdateStatus();
        updateSyncButtonLabel();
        statusRefreshed = true;
        const scopeLabel = syncScope.label || (scope === 'category' ? '当前分类' : '全部 Skill');
        if (scope !== 'selection' && payload.newSkillCount) openNewSkillsFromSync(payload.newSkillGroups || []);
        showNotice(payload.newSkillCount
          ? '已同步 ' + scopeLabel + '，并发现 ' + payload.newSkillCount + ' 个新增 Skill。'
          : (payload.count ? '已同步 ' + scopeLabel + ' 中的 ' + payload.count + ' 个 Skill。' : '已检测完毕，' + scopeLabel + ' 都是最新。'));
      } catch (error) {
        const message = error.name === 'AbortError'
          ? '同步超时：已停止等待。请稍后再试，或先同步更小的分类。'
          : (error.message || '未知错误');
        showNotice('一键同步失败：' + message);
        updateStatusText.textContent = '同步没有完成：' + message;
      } finally {
        window.clearTimeout(timeoutId);
        updateAll.disabled = false;
        updateSyncButtonLabel();
        if (!statusRefreshed) button.textContent = original;
      }
    }
    updateAll.addEventListener('click', () => syncSkills());
    syncFavoriteCount();
    setCategory('All');
    loadUpdateStatus();
  </script>
</body>
</html>`;
  const output = path.join(sourceRoot, 'dashboard.html');
  fs.writeFileSync(output, html);
  return { indexPath: path.join(sourceRoot, 'skills-index.json'), dashboardPath: output, index };
}

function jsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function importInstallErrorMessage(result) {
  const failures = (result.results || []).filter((item) => item.status === 'failed');
  if (!failures.length) return null;
  return '部分 Skill 安装失败：' + failures
    .map((item) => `${item.slug}: ${item.error || '未知错误'}`)
    .join('；');
}

function sendFile(response, filePath, contentType) {
  response.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  response.end(fs.readFileSync(filePath));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('请求 JSON 格式无效。'));
      }
    });
    request.on('error', reject);
  });
}

function runGit(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: gitCommandTimeoutMs,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    });
  } catch (error) {
    if (error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT') {
      throw new Error(`Git 命令超时：git ${args.join(' ')}`);
    }
    const stderr = String(error.stderr || '').trim();
    throw new Error(stderr || error.message || `Git 命令失败：git ${args.join(' ')}`);
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function ensureSourceRepo(sourceRoot, source) {
  const reposRoot = path.join(sourceRoot, '_repos');
  ensureDir(reposRoot);
  const repoDir = path.join(reposRoot, source.repoDirName);
  if (fs.existsSync(path.join(repoDir, '.git'))) {
    runGit(['-C', repoDir, 'pull', '--ff-only']);
  } else {
    runGit(['clone', source.repoUrl, repoDir]);
  }
  return repoDir;
}

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function findSkillDirectories(rootDir) {
  const found = [];
  if (!fs.existsSync(rootDir)) return found;
  function walk(current) {
    if (path.basename(current) === '.git') return;
    if (fs.existsSync(path.join(current, 'SKILL.md'))) {
      found.push(current);
      return;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name === '.git') continue;
      walk(path.join(current, entry.name));
    }
  }
  walk(rootDir);
  return found;
}

function importSourceObject(parsed, sourcePath = null) {
  return {
    homepage: sourcePath
      ? `https://github.com/${parsed.repoKey}/tree/main/${sourcePath}`
      : `https://github.com/${parsed.repoKey}`,
    repoUrl: parsed.repoUrl,
    repoKey: parsed.repoKey,
    repoDirName: parsed.repoDirName,
    sourcePath: sourcePath || '.',
  };
}

function scanImportSourceFromSource(sourceRoot, source, options = {}) {
  const repoDir = options.skipGitRefresh
    ? path.join(sourceRoot, '_repos', source.repoDirName)
    : ensureSourceRepo(sourceRoot, source);
  if (!fs.existsSync(repoDir)) throw new Error(`仓库缓存不存在：${source.repoKey}`);

  const scanRoot = source.requestedPath ? path.resolve(repoDir, source.requestedPath) : repoDir;
  if (!isInside(repoDir, scanRoot)) throw new Error('来源路径不在仓库内部。');
  if (!fs.existsSync(scanRoot)) throw new Error(`来源路径不存在：${source.requestedPath || '.'}`);

  const index = buildSourceIndex(sourceRoot);
  const localBySlug = new Map(index.skills.map((skill) => [skill.slug, skill]));
  const skillDirs = findSkillDirectories(scanRoot)
    .sort((a, b) => posixRelative(repoDir, a).localeCompare(posixRelative(repoDir, b)));
  if (!skillDirs.length) throw new Error('没有发现包含 SKILL.md 的 Skill 目录。');

  const candidates = skillDirs.map((dir) => {
    const parsed = parseSkillFile(path.join(dir, 'SKILL.md'));
    const sourcePath = posixRelative(repoDir, dir) || '.';
    const slug = sourcePath === '.'
      ? inferImportSlug(parsed, path.basename(source.repoKey))
      : parsed.slug;
    const local = localBySlug.get(slug) || null;
    let conflictType = 'new';
    if (local?.source?.repoUrl === source.repoUrl && local.source.sourcePath === sourcePath) {
      conflictType = 'same-source';
    } else if (local?.source?.repoUrl) {
      conflictType = 'different-source';
    } else if (local) {
      conflictType = 'exists-unbound';
    }
    return {
      slug,
      name: parsed.name,
      description: parsed.description,
      repoUrl: source.repoUrl,
      repoKey: source.repoKey,
      repoDirName: source.repoDirName,
      sourcePath,
      existsLocally: Boolean(local),
      currentSource: local?.source || null,
      conflictType,
    };
  });

  return {
    ok: true,
    source: {
      ...source,
      requestedPath: source.requestedPath || null,
    },
    candidates,
  };
}

export function scanImportSource(sourceRoot = defaultSourceRoot, input, options = {}) {
  return scanImportSourceFromSource(sourceRoot, parseImportInput(input), options);
}

function detectNewSkillGroups(sourceRoot = defaultSourceRoot, options = {}) {
  const { category = null } = options;
  const index = buildSourceIndex(sourceRoot);
  const sources = new Map();
  for (const skill of index.skills) {
    if (!skill.source?.repoUrl) continue;
    if (category && category !== 'All' && skill.category !== category) continue;
    if (!sources.has(skill.source.repoUrl)) sources.set(skill.source.repoUrl, skill.source);
  }

  const groups = [];
  for (const source of [...sources.values()].sort((a, b) => a.repoKey.localeCompare(b.repoKey))) {
    try {
      const scan = scanImportSourceFromSource(sourceRoot, { ...source, requestedPath: null }, { skipGitRefresh: true });
      const candidates = scan.candidates.filter((candidate) => !candidate.existsLocally);
      if (candidates.length) groups.push({ source: scan.source, candidates });
    } catch {
      // A malformed source should not block regular update checks for existing Skills.
    }
  }
  return groups;
}

function hashDirectory(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  walk(dir);
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const relative = path.relative(dir, file).split(path.sep).join('/');
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function copyDirectoryExcludingGit(sourceDir, targetDir) {
  ensureDir(targetDir);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryExcludingGit(from, to);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(to));
      fs.copyFileSync(from, to);
    } else if (entry.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(from), to);
    }
  }
}

function slugRuleId(repoKey, slug) {
  return `${repoKey}-${slug}`.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function removeSlugFromRules(rules, slug) {
  const kept = [];
  for (const rule of rules) {
    if (!rule?.match?.exact) {
      kept.push(rule);
      continue;
    }
    const exact = Array.isArray(rule.match.exact) ? rule.match.exact : [rule.match.exact];
    const nextExact = exact.filter((item) => item !== slug);
    if (!nextExact.length) continue;
    kept.push({
      ...rule,
      match: {
        ...rule.match,
        exact: Array.isArray(rule.match.exact) ? nextExact : nextExact[0],
      },
    });
  }
  return kept;
}

function writeSourceRules(sourceRoot, rules) {
  const file = path.join(sourceRoot, sourceRulesFile);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify({ rules }, null, 2)}\n`);
}

function upsertImportSourceRules(sourceRoot, source, installedItems) {
  if (!installedItems.length) return;
  let rules = loadSourceRules(sourceRoot);
  for (const item of installedItems) rules = removeSlugFromRules(rules, item.slug);

  const standardItems = installedItems.filter((item) => item.sourcePath === `skills/${item.slug}`);
  const nonStandardItems = installedItems.filter((item) => item.sourcePath !== `skills/${item.slug}`);
  const newRules = [];

  if (standardItems.length > 1) {
    newRules.push({
      id: slugRuleId(source.repoKey, 'skills'),
      label: source.repoKey,
      repoUrl: source.repoUrl,
      homepage: `https://github.com/${source.repoKey}`,
      match: { exact: standardItems.map((item) => item.slug).sort((a, b) => a.localeCompare(b)) },
      sourcePathTemplate: 'skills/{slug}',
    });
  } else {
    nonStandardItems.push(...standardItems);
  }

  for (const item of nonStandardItems) {
    newRules.push({
      id: slugRuleId(source.repoKey, item.slug),
      label: source.repoKey,
      repoUrl: source.repoUrl,
      homepage: `https://github.com/${source.repoKey}/tree/main/${item.sourcePath}`,
      match: { exact: item.slug },
      sourcePathTemplate: item.sourcePath,
    });
  }

  writeSourceRules(sourceRoot, [...newRules, ...rules]);
}

function emptyImportSummary() {
  return { installed: 0, skipped: 0, overwritten: 0, failed: 0 };
}

function normalizeImportInstallItem(repoDir, source, item = {}) {
  let sourcePath = String(item.sourcePath || '').trim();
  if (!sourcePath && fs.existsSync(path.join(repoDir, 'SKILL.md'))) {
    sourcePath = '.';
  }
  if (sourcePath === '') sourcePath = '.';
  const sourceDir = path.resolve(repoDir, sourcePath);
  const parsed = fs.existsSync(path.join(sourceDir, 'SKILL.md'))
    ? parseSkillFile(path.join(sourceDir, 'SKILL.md'))
    : null;
  let slug = safeSkillSlug(item.slug);
  if (parsed && (!slug || (sourcePath === '.' && slug === source.repoDirName))) {
    slug = inferImportSlug(parsed, path.basename(source.repoKey));
  }
  return {
    slug,
    action: item.action || 'skip',
    sourcePath,
  };
}

export function installImportedSkills(sourceRoot = defaultSourceRoot, payload = {}, options = {}) {
  const source = payload.source?.repoUrl ? payload.source : parseImportInput(payload.source || payload.input || '');
  const repoDir = options.skipGitRefresh
    ? path.join(sourceRoot, '_repos', source.repoDirName)
    : ensureSourceRepo(sourceRoot, source);
  if (!fs.existsSync(repoDir)) throw new Error(`仓库缓存不存在：${source.repoKey}`);

  const items = Array.isArray(payload.items) ? payload.items : [];
  const summary = emptyImportSummary();
  const results = [];
  const installedForRules = [];

  for (const item of items) {
    const { slug, action, sourcePath } = normalizeImportInstallItem(repoDir, source, item);
    if (!slug || !sourcePath) {
      summary.failed += 1;
      results.push({ slug: slug || '(unknown)', action, status: 'failed', error: '缺少 slug 或 sourcePath。' });
      continue;
    }
    if (action === 'skip') {
      summary.skipped += 1;
      results.push({ slug, action, status: 'skipped' });
      continue;
    }

    try {
      const sourceDir = path.resolve(repoDir, sourcePath);
      if (!isInside(repoDir, sourceDir)) throw new Error('来源路径不在仓库内部。');
      if (!fs.existsSync(path.join(sourceDir, 'SKILL.md'))) throw new Error('来源目录没有 SKILL.md。');

      const targetDir = path.join(sourceRoot, 'skills', slug);
      const exists = fs.existsSync(targetDir);
      if (exists && !fs.statSync(targetDir).isDirectory()) throw new Error(`目标路径不是目录：${targetDir}`);
      if (exists && action !== 'overwrite') throw new Error('本地已存在，请选择覆盖或跳过。');

      let backupPath = null;
      if (exists) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        backupPath = path.join(sourceRoot, '_backups', `${slug}-${stamp}`);
        ensureDir(path.dirname(backupPath));
        fs.cpSync(targetDir, backupPath, { recursive: true });
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      copyDirectoryExcludingGit(sourceDir, targetDir);
      installedForRules.push({ slug, sourcePath });
      if (exists) {
        summary.overwritten += 1;
        results.push({ slug, action, status: 'overwritten', backupPath, sourcePath });
      } else {
        summary.installed += 1;
        results.push({ slug, action, status: 'installed', sourcePath });
      }
    } catch (error) {
      summary.failed += 1;
      results.push({ slug, action, status: 'failed', error: error.message });
    }
  }

  upsertImportSourceRules(sourceRoot, source, installedForRules);
  if (installedForRules.length) {
    const cacheFile = path.join(sourceRoot, updateStatusCacheFile);
    fs.rmSync(cacheFile, { force: true });
    const dashboard = rebuildSourceDashboard(sourceRoot);
    return { ok: summary.failed === 0, summary, results, index: dashboard.index };
  }
  return { ok: summary.failed === 0, summary, results };
}

export function removeSourceSkills(sourceRoot = defaultSourceRoot, requestedSlugs = []) {
  const absoluteSourceRoot = path.resolve(sourceRoot);
  if (!requestedSlugs.length) throw new Error('请提供要移除的 Skill。');

  const index = buildSourceIndex(absoluteSourceRoot);
  const skillsRoot = path.join(absoluteSourceRoot, 'skills');
  const removed = [];
  let rules = loadSourceRules(absoluteSourceRoot);

  for (const requestedSlug of requestedSlugs) {
    const slug = safeSkillSlug(requestedSlug);
    if (!slug) throw new Error(`Skill 名称无效：${requestedSlug}`);
    const skill = findSkill(index, slug);
    if (!isInside(skillsRoot, skill.path)) throw new Error(`拒绝移除 skills/ 之外的路径：${skill.path}`);
    if (!fs.existsSync(skill.path) || !fs.statSync(skill.path).isDirectory()) {
      throw new Error(`Skill 目录不存在：${slug}`);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(absoluteSourceRoot, '_backups', `${skill.slug}-${stamp}`);
    ensureDir(path.dirname(backupPath));
    fs.cpSync(skill.path, backupPath, { recursive: true });
    fs.rmSync(skill.path, { recursive: true, force: true });
    rules = removeSlugFromRules(rules, skill.slug);
    removed.push({
      slug: skill.slug,
      name: skill.name,
      skillPath: skill.path,
      backupPath,
    });
  }

  writeSourceRules(absoluteSourceRoot, rules);
  fs.rmSync(path.join(absoluteSourceRoot, updateStatusCacheFile), { force: true });
  const dashboard = rebuildSourceDashboard(absoluteSourceRoot);
  return {
    ok: true,
    removed,
    index: dashboard.index,
  };
}

function refreshSourceRepos(sourceRoot, skills) {
  const seen = new Set();
  for (const skill of skills) {
    if (!skill.source?.repoUrl || seen.has(skill.source.repoUrl)) continue;
    ensureSourceRepo(sourceRoot, skill.source);
    seen.add(skill.source.repoUrl);
  }
}

export function buildUpdateStatus(sourceRoot = defaultSourceRoot, options = {}) {
  const { refresh = true, category = null } = options;
  const slugs = safeSkillSlugList(options.slugs);
  const slugSet = slugs ? new Set(slugs) : null;
  const index = buildSourceIndex(sourceRoot);
  const sourceBoundSkills = index.skills
    .filter((skill) => skill.source?.repoUrl)
    .filter((skill) => !slugSet || slugSet.has(skill.slug))
    .filter((skill) => !category || category === 'All' || skill.category === category);
  if (refresh) refreshSourceRepos(sourceRoot, sourceBoundSkills);

  const skills = {};
  let needsUpdate = 0;
  let current = 0;
  let missing = 0;
  for (const skill of sourceBoundSkills) {
    const repoDir = path.join(sourceRoot, '_repos', skill.source.repoDirName);
    const sourceDir = path.resolve(repoDir, skill.source.sourcePath);
    const localHash = hashDirectory(skill.path);
    const remoteHash = isInside(repoDir, sourceDir) ? hashDirectory(sourceDir) : null;
    let status = 'current';
    if (!remoteHash) {
      status = 'source-missing';
      missing += 1;
    } else if (localHash !== remoteHash) {
      status = 'changed';
      needsUpdate += 1;
    } else {
      current += 1;
    }
    skills[skill.slug] = {
      slug: skill.slug,
      status,
      needsUpdate: status === 'changed',
      localHash,
      remoteHash,
      repo: skill.source.repoKey,
      repoUrl: skill.source.repoUrl,
      sourcePath: skill.source.sourcePath,
      ruleId: skill.source.ruleId || null,
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalSourceBound: sourceBoundSkills.length,
      current,
      needsUpdate,
      sourceMissing: missing,
      unconfirmed: index.skills.filter((skill) => !skill.source?.repoUrl && (!slugSet || slugSet.has(skill.slug)) && (!category || category === 'All' || skill.category === category)).length,
    },
    skills,
  };
}

export function readUpdateStatusCache(sourceRoot = defaultSourceRoot) {
  const file = path.join(sourceRoot, updateStatusCacheFile);
  if (!fs.existsSync(file)) {
    const index = buildSourceIndex(sourceRoot);
    return {
      cached: false,
      generatedAt: null,
      summary: {
        totalSourceBound: index.sourceStats.confirmed,
        current: 0,
        needsUpdate: 0,
        sourceMissing: 0,
        unconfirmed: index.sourceStats.unconfirmed,
      },
      skills: {},
    };
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...parsed, cached: true };
}

export function writeUpdateStatusCache(sourceRoot = defaultSourceRoot, status) {
  const file = path.join(sourceRoot, updateStatusCacheFile);
  ensureDir(path.dirname(file));
  const payload = { ...status, cached: true };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

export function updateSkillFromSource(sourceRoot = defaultSourceRoot, slug, options = {}) {
  const { refresh = true } = options;
  const index = buildSourceIndex(sourceRoot);
  const skill = index.skills.find((item) => item.slug === slug);
  if (!skill) throw new Error(`Skill not found: ${slug}`);
  if (!skill.source?.repoUrl) throw new Error(`Skill has no confirmed GitHub source: ${slug}`);

  const repoDir = refresh
    ? ensureSourceRepo(sourceRoot, skill.source)
    : path.join(sourceRoot, '_repos', skill.source.repoDirName);
  const sourceDir = path.resolve(repoDir, skill.source.sourcePath);
  if (!isInside(repoDir, sourceDir)) throw new Error(`Invalid source path for ${slug}`);
  if (!fs.existsSync(path.join(sourceDir, 'SKILL.md'))) {
    throw new Error(`Source repo does not contain SKILL.md at ${skill.source.sourcePath}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = path.join(sourceRoot, '_backups');
  const tempRoot = path.join(sourceRoot, '_tmp');
  ensureDir(backupRoot);
  ensureDir(tempRoot);
  const backupDir = path.join(backupRoot, `${slug}-${stamp}`);
  const tempDir = path.join(tempRoot, `${slug}-${stamp}`);

  fs.cpSync(skill.path, backupDir, { recursive: true });
  copyDirectoryExcludingGit(sourceDir, tempDir);
  fs.rmSync(skill.path, { recursive: true, force: true });
  fs.renameSync(tempDir, skill.path);
  rebuildSourceDashboard(sourceRoot);

  return {
    slug,
    repo: skill.source.repoKey,
    sourcePath: skill.source.sourcePath,
    backupPath: backupDir,
    skillPath: skill.path,
  };
}

export function updateChangedSkills(sourceRoot = defaultSourceRoot, options = {}) {
  const { category = null, refresh = true } = options;
  const slugs = safeSkillSlugList(options.slugs);
  const status = buildUpdateStatus(sourceRoot, { refresh, category, slugs });
  const changedSlugs = Object.values(status.skills)
    .filter((item) => item.needsUpdate)
    .map((item) => item.slug)
    .sort((a, b) => a.localeCompare(b));
  const updated = changedSlugs.map((slug) => updateSkillFromSource(sourceRoot, slug, { refresh: false }));
  const finalStatus = buildUpdateStatus(sourceRoot, { refresh: false });
  const newSkillGroups = slugs ? [] : detectNewSkillGroups(sourceRoot, { category });
  const newSkillCount = newSkillGroups.reduce((total, group) => total + group.candidates.length, 0);
  writeUpdateStatusCache(sourceRoot, finalStatus);
  return {
    updated,
    count: updated.length,
    status: finalStatus,
    scope: slugs ? 'slugs' : (category ? 'category' : 'all'),
    category,
    slugs: slugs || [],
    newSkillGroups,
    newSkillCount,
  };
}

function loadPublicExportConfig(sourceRoot = defaultSourceRoot) {
  const file = path.join(sourceRoot, publicExportFile);
  if (!fs.existsSync(file)) throw new Error(`Missing public export config: ${file}`);
  const config = readJsonFile(file);
  if (!Array.isArray(config.copy)) throw new Error('public-export.json must include a copy array.');
  return config;
}

function isPathInside(parentDir, childPath) {
  const relativePath = path.relative(parentDir, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function assertSafePublicExportDestination(sourceRoot, destinationRoot) {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  if (destination === source) throw new Error('Refusing to export into the source repository.');
  if (isPathInside(source, destination)) throw new Error('Refusing to export into a directory inside the source repository.');
}

function ensureCleanGitDestination(destinationRoot, force) {
  if (!fs.existsSync(path.join(destinationRoot, '.git'))) return;
  const status = execFileSync('git', ['-C', destinationRoot, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (status && !force) {
    throw new Error('Destination git repository has uncommitted changes. Commit them first or rerun with --force.');
  }
}

function emptyDirectoryPreservingGit(destinationRoot) {
  ensureDir(destinationRoot);
  for (const entry of fs.readdirSync(destinationRoot, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    fs.rmSync(path.join(destinationRoot, entry.name), { recursive: true, force: true });
  }
}

function copyPublicExportEntry(sourceRoot, destinationRoot, entry) {
  const from = entry.from ? path.join(sourceRoot, entry.from) : null;
  const to = entry.to ? path.join(destinationRoot, entry.to) : null;
  if (!from || !to) throw new Error('Each public export copy entry needs from and to.');
  if (!fs.existsSync(from)) throw new Error(`Missing public export source: ${from}`);
  ensureDir(path.dirname(to));
  fs.cpSync(from, to, { recursive: true, dereference: true });
}

function writePublicExportJson(destinationRoot, entry) {
  if (!entry.to) throw new Error('Each public export json entry needs to.');
  const file = path.join(destinationRoot, entry.to);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(entry.value ?? {}, null, 2)}\n`);
}

function writePublicExportText(destinationRoot, entry) {
  if (!entry.to) throw new Error('Each public export text entry needs to.');
  const file = path.join(destinationRoot, entry.to);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, String(entry.value ?? ''));
}

function validatePublicExport(destinationRoot, sourceRoot, config) {
  const denied = config.denyPaths || [];
  const presentDenied = denied.filter((deniedPath) => fs.existsSync(path.join(destinationRoot, deniedPath)));
  if (presentDenied.length) throw new Error(`Public export contains denied paths: ${presentDenied.join(', ')}`);

  const exportedText = JSON.stringify({
    index: fs.existsSync(path.join(destinationRoot, 'skills-index.json'))
      ? readJsonFile(path.join(destinationRoot, 'skills-index.json'))
      : {},
    dashboard: fs.existsSync(path.join(destinationRoot, 'dashboard.html'))
      ? fs.readFileSync(path.join(destinationRoot, 'dashboard.html'), 'utf8')
      : '',
  });
  const sourceMarkers = [path.resolve(sourceRoot), path.dirname(path.resolve(sourceRoot))].filter(Boolean);
  for (const marker of sourceMarkers) {
    if (exportedText.includes(marker)) throw new Error(`Public export leaked local path marker: ${marker}`);
  }
}

export function exportPublicRepository(sourceRoot = defaultSourceRoot, destinationRoot, options = {}) {
  if (!destinationRoot) throw new Error('Missing destination directory for public export.');
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  const config = loadPublicExportConfig(source);
  assertSafePublicExportDestination(source, destination);
  ensureCleanGitDestination(destination, Boolean(options.force));
  emptyDirectoryPreservingGit(destination);

  for (const entry of config.copy) copyPublicExportEntry(source, destination, entry);
  for (const entry of config.json || []) writePublicExportJson(destination, entry);
  for (const entry of config.text || []) writePublicExportText(destination, entry);

  const result = rebuildSourceDashboard(destination);
  validatePublicExport(destination, source, config);

  return {
    destination,
    repoName: config.repoName || path.basename(destination),
    description: config.description || '',
    copied: config.copy.length,
    skills: result.index.total,
    dashboardPath: result.dashboardPath,
    indexPath: result.indexPath,
  };
}

export function createSourceDashboardServer(sourceRoot = defaultSourceRoot) {
  rebuildSourceDashboard(sourceRoot);
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard.html')) {
        sendFile(response, path.join(sourceRoot, 'dashboard.html'), 'text/html; charset=utf-8');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/skills-index.json') {
        sendFile(response, path.join(sourceRoot, 'skills-index.json'), 'application/json; charset=utf-8');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/favicon.svg') {
        sendFile(response, path.join(sourceRoot, 'favicon.svg'), 'image/svg+xml; charset=utf-8');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/status') {
        const index = buildSourceIndex(sourceRoot);
        jsonResponse(response, 200, {
          service: true,
          total: index.total,
          confirmedSources: index.sourceStats.confirmed,
          unconfirmedSources: index.sourceStats.unconfirmed,
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/update-status') {
        jsonResponse(response, 200, { ok: true, ...readUpdateStatusCache(sourceRoot) });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/projects') {
        jsonResponse(response, 200, { ok: true, workspaceRoot: defaultWorkspaceRoot(sourceRoot), projects: listWorkspaceProjects(sourceRoot) });
        return;
      }
      const projectStateMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/skills$/);
      if (request.method === 'GET' && projectStateMatch) {
        const id = decodeURIComponent(projectStateMatch[1]);
        const projectDir = resolveWorkspaceProject(id, sourceRoot);
        jsonResponse(response, 200, { ok: true, project: { id, isSourceRoot: path.resolve(projectDir) === path.resolve(sourceRoot), ...getProjectSkillState(projectDir, sourceRoot) } });
        return;
      }
      const projectSkillMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/skills\/([^/]+)\/(enable|disable)$/);
      if (request.method === 'POST' && projectSkillMatch) {
        const id = decodeURIComponent(projectSkillMatch[1]);
        const slug = decodeURIComponent(projectSkillMatch[2]);
        const action = projectSkillMatch[3];
        const projectDir = resolveWorkspaceProject(id, sourceRoot);
        if (action === 'enable') {
          enableSkills(projectDir, sourceRoot, [slug]);
        } else {
          disableSkills(projectDir, [slug]);
        }
        jsonResponse(response, 200, { ok: true, action, slug, project: { id, isSourceRoot: path.resolve(projectDir) === path.resolve(sourceRoot), ...getProjectSkillState(projectDir, sourceRoot) } });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/import/scan') {
        const body = await readJsonBody(request);
        const result = scanImportSource(sourceRoot, body.input, { skipGitRefresh: Boolean(body.skipGitRefresh) });
        jsonResponse(response, 200, result);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/import/install') {
        const body = await readJsonBody(request);
        const result = installImportedSkills(sourceRoot, body, { skipGitRefresh: Boolean(body.skipGitRefresh) });
        const installError = importInstallErrorMessage(result);
        if (installError) {
          const { index, ...failureResult } = result;
          jsonResponse(response, 409, { ...failureResult, ok: false, error: installError });
        } else {
          jsonResponse(response, 200, result);
        }
        return;
      }
      const updateMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/update$/);
      if (request.method === 'POST' && updateMatch) {
        const result = updateSkillFromSource(sourceRoot, decodeURIComponent(updateMatch[1]));
        const status = buildUpdateStatus(sourceRoot, { refresh: false });
        writeUpdateStatusCache(sourceRoot, status);
        jsonResponse(response, 200, { ok: true, ...result, status });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/skills/update-selected') {
        const body = await readJsonBody(request);
        const result = updateChangedSkills(sourceRoot, { slugs: body.slugs, refresh: !Boolean(body.skipGitRefresh) });
        jsonResponse(response, 200, { ok: true, ...result });
        return;
      }
      const removeMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/remove$/);
      if (request.method === 'POST' && removeMatch) {
        const result = removeSourceSkills(sourceRoot, [decodeURIComponent(removeMatch[1])]);
        jsonResponse(response, 200, result);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/skills/update-all') {
        const category = url.searchParams.get('category') || null;
        const result = updateChangedSkills(sourceRoot, { category });
        jsonResponse(response, 200, { ok: true, ...result });
        return;
      }
      jsonResponse(response, 404, { error: 'Not found' });
    } catch (error) {
      jsonResponse(response, 500, { error: error.message });
    }
  });
}

export function serveSourceDashboard(sourceRoot = defaultSourceRoot, preferredPort = 37821) {
  const server = createSourceDashboardServer(sourceRoot);
  let port = preferredPort;
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && port < preferredPort + 20) {
      port += 1;
      server.listen(port, '127.0.0.1');
      return;
    }
    throw error;
  });
  server.on('listening', () => {
    const address = server.address();
    console.log(`url=http://127.0.0.1:${address.port}/dashboard.html`);
    console.log(`sourceRoot=${sourceRoot}`);
  });
  server.listen(port, '127.0.0.1');
  return server;
}

function printHelp() {
  console.log(`Usage:
  node scripts/skill-workbench.mjs rebuild-source [sourceRoot]
  node scripts/skill-workbench.mjs export-public <destinationDir> [--source-root <sourceRoot>] [--force]
  node scripts/skill-workbench.mjs list-missing-zh [sourceRoot]
  node scripts/skill-workbench.mjs remove-skill <skill...> [--source-root <sourceRoot>]
  node scripts/skill-workbench.mjs serve [sourceRoot] [--port 37821]
  node scripts/skill-workbench.mjs init-project <projectDir>
  node scripts/skill-workbench.mjs enable <projectDir> <skill...>
  node scripts/skill-workbench.mjs disable <projectDir> <skill...>
  node scripts/skill-workbench.mjs list <projectDir>
  node scripts/skill-workbench.mjs check <projectDir>
  node scripts/skill-workbench.mjs dashboard <projectDir>
`);
}

function main(argv) {
  const [command, ...args] = argv;
  try {
    if (!command || command === 'help' || command === '--help') {
      printHelp();
      return;
    }
    if (command === 'list-missing-zh') {
      const sourceRoot = args[0] ? path.resolve(args[0]) : defaultSourceRoot;
      const missing = listMissingZhDescriptions(sourceRoot);
      console.log(`missing=${missing.length}`);
      for (const skill of missing) {
        console.log(`- ${skill.slug}`);
        console.log(`  file=${skill.skillFile}`);
        console.log(`  description=${skill.description}`);
      }
      return;
    }
    if (command === 'rebuild-source') {
      const result = rebuildSourceDashboard(args[0] ? path.resolve(args[0]) : defaultSourceRoot);
      console.log(`skills=${result.index.total}`);
      console.log(`confirmedSources=${result.index.sourceStats.confirmed}`);
      console.log(`unconfirmedSources=${result.index.sourceStats.unconfirmed}`);
      console.log(`json=${result.indexPath}`);
      console.log(`html=${result.dashboardPath}`);
      return;
    }
    if (command === 'export-public') {
      let sourceRoot = defaultSourceRoot;
      let destination = null;
      let force = false;
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '--source-root') {
          sourceRoot = path.resolve(args[i + 1] || defaultSourceRoot);
          i += 1;
        } else if (args[i] === '--force') {
          force = true;
        } else if (!destination) {
          destination = path.resolve(args[i]);
        } else {
          throw new Error(`Unexpected argument: ${args[i]}`);
        }
      }
      const result = exportPublicRepository(sourceRoot, destination, { force });
      console.log(`destination=${result.destination}`);
      console.log(`repoName=${result.repoName}`);
      console.log(`copied=${result.copied}`);
      console.log(`skills=${result.skills}`);
      console.log(`json=${result.indexPath}`);
      console.log(`html=${result.dashboardPath}`);
      return;
    }
    if (command === 'remove-skill') {
      let sourceRoot = defaultSourceRoot;
      const slugs = [];
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '--source-root') {
          sourceRoot = path.resolve(args[i + 1] || defaultSourceRoot);
          i += 1;
        } else {
          slugs.push(args[i]);
        }
      }
      const result = removeSourceSkills(sourceRoot, slugs);
      console.log(`removed=${result.removed.map((skill) => skill.slug).join(',')}`);
      for (const skill of result.removed) console.log(`backup=${skill.backupPath}`);
      return;
    }
    if (command === 'serve') {
      let sourceRootArg = null;
      let port = 37821;
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '--port') {
          port = Number(args[i + 1] || port);
          i += 1;
        } else if (!sourceRootArg) {
          sourceRootArg = args[i];
        }
      }
      serveSourceDashboard(sourceRootArg ? path.resolve(sourceRootArg) : defaultSourceRoot, port);
      return;
    }
    if (command === 'init-project') {
      if (!args[0]) throw new Error('Missing projectDir');
      const result = initProject(args[0]);
      generateProjectDashboard(result.projectDir);
      console.log(`project=${result.projectDir}`);
      return;
    }
    if (command === 'enable') {
      if (args.length < 2) throw new Error('Usage: enable <projectDir> <skill...>');
      const enabled = enableSkills(args[0], defaultSourceRoot, args.slice(1));
      console.log(`enabled=${enabled.map((skill) => skill.slug).join(',')}`);
      return;
    }
    if (command === 'disable') {
      if (args.length < 2) throw new Error('Usage: disable <projectDir> <skill...>');
      const kept = disableSkills(args[0], args.slice(1));
      console.log(`remaining=${kept.length}`);
      return;
    }
    if (command === 'list') {
      if (!args[0]) throw new Error('Missing projectDir');
      for (const skill of readProjectSkills(args[0]).skills) console.log(`${skill.slug}\t${skill.group}\t${skill.source}`);
      return;
    }
    if (command === 'check') {
      if (!args[0]) throw new Error('Missing projectDir');
      const report = checkProject(args[0]);
      console.log(JSON.stringify(report, null, 2));
      if (report.brokenLinks.length || report.nonSymlinkEntries.length) process.exitCode = 1;
      return;
    }
    if (command === 'dashboard') {
      if (!args[0]) throw new Error('Missing projectDir');
      console.log(generateProjectDashboard(args[0]));
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
