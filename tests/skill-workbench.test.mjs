import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildSourceIndex,
  buildUpdateStatus,
  checkProject,
  createSourceDashboardServer,
  enableSkills,
  exportPublicRepository,
  initProject,
  installImportedSkills,
  listMissingZhDescriptions,
  parseImportInput,
  readUpdateStatusCache,
  readProjectSkills,
  rebuildSourceDashboard,
  removeSourceSkills,
  scanImportSource,
  updateChangedSkills,
  writeUpdateStatusCache,
} from '../scripts/skill-workbench.mjs';

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-workbench-'));
  const sourceRoot = path.join(root, 'skill-sources');
  const comicSkill = path.join(sourceRoot, 'skills', 'baoyu-comic');
  const dbsSkill = path.join(sourceRoot, 'skills', 'dbs');
  fs.mkdirSync(comicSkill, { recursive: true });
  fs.mkdirSync(dbsSkill, { recursive: true });
  fs.writeFileSync(
    path.join(comicSkill, 'SKILL.md'),
    '---\nname: baoyu-comic\ndescription: Make Chinese knowledge comics.\n---\n',
  );
  fs.writeFileSync(
    path.join(dbsSkill, 'SKILL.md'),
    '---\nname: dbs\ndescription: Diagnose business problems.\n---\n',
  );
  return { root, sourceRoot };
}

function writeRepoSkill(sourceRoot, repoDirName, skillPath, content) {
  const dir = path.join(sourceRoot, '_repos', repoDirName, skillPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  return dir;
}

function writePublicExportFixture(sourceRoot) {
  fs.mkdirSync(path.join(sourceRoot, 'public-export', 'skills', 'example-skill'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '_manifests'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'public-export', 'README.md'), '# Public Skill Workbench\n');
  fs.writeFileSync(path.join(sourceRoot, 'public-export', 'AGENTS.md'), '# Public rules\n');
  fs.writeFileSync(path.join(sourceRoot, 'public-export', '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(
    path.join(sourceRoot, 'public-export', 'skills', 'example-skill', 'SKILL.md'),
    '---\nname: example-skill\ndescription: Demonstrates the public Skill Workbench export.\n---\n',
  );
  fs.writeFileSync(path.join(sourceRoot, 'scripts', 'skill-workbench.mjs'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(sourceRoot, 'tests', 'skill-workbench.test.mjs'), 'import test from "node:test";\n');
  fs.writeFileSync(path.join(sourceRoot, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n');
  fs.writeFileSync(
    path.join(sourceRoot, '_manifests', 'public-export.json'),
    JSON.stringify({
      repoName: 'skill-workbench',
      description: 'Public export fixture.',
      copy: [
        { from: 'public-export/README.md', to: 'README.md' },
        { from: 'public-export/AGENTS.md', to: 'AGENTS.md' },
        { from: 'public-export/.gitignore', to: '.gitignore' },
        { from: 'public-export/skills/example-skill', to: 'skills/example-skill' },
        { from: 'scripts/skill-workbench.mjs', to: 'scripts/skill-workbench.mjs' },
        { from: 'tests/skill-workbench.test.mjs', to: 'tests/skill-workbench.test.mjs' },
        { from: 'favicon.svg', to: 'favicon.svg' },
      ],
      json: [
        { to: '_manifests/source-rules.json', value: { rules: [] } },
        {
          to: '_manifests/zh-descriptions.json',
          value: {
            version: 1,
            descriptions: {
              'example-skill': '用于演示公开版 Skill Workbench 的示例 Skill。',
            },
          },
        },
      ],
      denyPaths: ['_backups', '_legacy', '_logs', '_repos', '_tmp', 'output', '.agents', '.claude'],
    }, null, 2),
  );
}

async function withServer(sourceRoot, fn) {
  const server = createSourceDashboardServer(sourceRoot);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('buildSourceIndex reads a unified skills pool', () => {
  const { sourceRoot } = makeFixture();
  const index = buildSourceIndex(sourceRoot);
  assert.equal(index.total, 2);
  assert.deepEqual(
    index.skills.map((skill) => `${skill.group}:${skill.slug}`).sort(),
    ['skills:baoyu-comic', 'skills:dbs'],
  );
});

test('buildSourceIndex reads multiline skill descriptions', () => {
  const { sourceRoot } = makeFixture();
  const skillDir = path.join(sourceRoot, 'skills', 'multiline-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: multiline-skill\ndescription: |\n  First line.\n  Second line.\n---\n',
  );

  const index = buildSourceIndex(sourceRoot);
  const skill = index.skills.find((item) => item.slug === 'multiline-skill');
  assert.equal(skill.description, 'First line. Second line.');
});

test('buildSourceIndex marks only confirmed GitHub skill sources as updateable', () => {
  const { sourceRoot } = makeFixture();
  fs.writeFileSync(
    path.join(sourceRoot, 'skills', 'baoyu-comic', 'SKILL.md'),
    '---\nname: baoyu-comic\ndescription: Make Chinese knowledge comics.\nmetadata:\n  openclaw:\n    homepage: https://github.com/JimLiu/baoyu-skills#baoyu-comic\n---\n',
  );
  const referenceOnlySkill = path.join(sourceRoot, 'skills', 'reference-only');
  const canonicalSkill = path.join(sourceRoot, 'skills', 'canonical-skill');
  fs.mkdirSync(referenceOnlySkill, { recursive: true });
  fs.mkdirSync(canonicalSkill, { recursive: true });
  fs.writeFileSync(
    path.join(referenceOnlySkill, 'SKILL.md'),
    '---\nname: reference-only\ndescription: Uses a library.\n---\n\n参考实现 https://github.com/example/library\n',
  );
  fs.writeFileSync(
    path.join(canonicalSkill, 'SKILL.md'),
    '---\nname: canonical-skill\ndescription: 中文说明。\n---\n\n<!-- provenance: canonical: https://github.com/example/canonical-skill -->\n',
  );

  const index = buildSourceIndex(sourceRoot);
  const comic = index.skills.find((skill) => skill.slug === 'baoyu-comic');
  const referenceOnly = index.skills.find((skill) => skill.slug === 'reference-only');
  const canonical = index.skills.find((skill) => skill.slug === 'canonical-skill');

  assert.equal(index.sourceStats.confirmed, 2);
  assert.equal(index.sourceStats.unconfirmed, 2);
  assert.equal(comic.source.repoUrl, 'https://github.com/JimLiu/baoyu-skills.git');
  assert.equal(comic.source.sourcePath, 'skills/baoyu-comic');
  assert.equal(referenceOnly.source, null);
  assert.equal(canonical.source.repoUrl, 'https://github.com/example/canonical-skill.git');
  assert.equal(canonical.source.sourcePath, '.');
});

test('buildSourceIndex uses cached Chinese descriptions and flags untranslated English descriptions', () => {
  const { sourceRoot } = makeFixture();
  const mixedSkill = path.join(sourceRoot, 'skills', 'mixed-trigger-skill');
  fs.mkdirSync(mixedSkill, { recursive: true });
  fs.writeFileSync(
    path.join(mixedSkill, 'SKILL.md'),
    '---\nname: mixed-trigger-skill\ndescription: Generates image cards for social media. Use when user mentions "小红书图片", "小红书种草", "微信图文", "微信贴图", "图片卡片", or wants social media infographic series.\n---\n',
  );
  fs.mkdirSync(path.join(sourceRoot, '_manifests'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, '_manifests', 'zh-descriptions.json'),
    JSON.stringify({
      version: 1,
      descriptions: {
        'baoyu-comic': '用于把知识内容整理成中文漫画，适合需要图文分镜表达的场景。',
        'mixed-trigger-skill': '用于生成适合社交媒体传播的图片卡片系列，适合小红书、微信图文和信息卡片场景。',
      },
    }),
  );

  const index = buildSourceIndex(sourceRoot);
  const comic = index.skills.find((skill) => skill.slug === 'baoyu-comic');
  const dbs = index.skills.find((skill) => skill.slug === 'dbs');
  const mixed = index.skills.find((skill) => skill.slug === 'mixed-trigger-skill');

  assert.equal(comic.zhDescription, '用于把知识内容整理成中文漫画，适合需要图文分镜表达的场景。');
  assert.equal(comic.zhDescriptionStatus, 'cached');
  assert.equal(mixed.zhDescription, '用于生成适合社交媒体传播的图片卡片系列，适合小红书、微信图文和信息卡片场景。');
  assert.equal(mixed.zhDescriptionStatus, 'cached');
  assert.match(dbs.zhDescription, /^待翻译：Diagnose business problems/);
  assert.equal(dbs.zhDescriptionStatus, 'missing');
  assert.equal(dbs.zhDescription.includes('聚焦'), false);
});

test('rebuildSourceDashboard exposes Chinese descriptions as public descriptions', () => {
  const { sourceRoot } = makeFixture();
  fs.mkdirSync(path.join(sourceRoot, '_manifests'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, '_manifests', 'zh-descriptions.json'),
    JSON.stringify({
      version: 1,
      descriptions: {
        'baoyu-comic': '用于把知识内容整理成中文漫画，适合需要图文分镜表达的场景。',
      },
    }),
  );

  const { indexPath } = rebuildSourceDashboard(sourceRoot);
  const publicIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const comic = publicIndex.skills.find((skill) => skill.slug === 'baoyu-comic');

  assert.equal(comic.description, '用于把知识内容整理成中文漫画，适合需要图文分镜表达的场景。');
  assert.equal(comic.sourceDescription, 'Make Chinese knowledge comics.');
});

test('listMissingZhDescriptions lists English skills without cached Chinese descriptions', () => {
  const { sourceRoot } = makeFixture();
  const mixedSkill = path.join(sourceRoot, 'skills', 'mixed-trigger-skill');
  const bilingualSkill = path.join(sourceRoot, 'skills', 'bilingual-source-skill');
  const chineseSkill = path.join(sourceRoot, 'skills', 'chinese-skill');
  fs.mkdirSync(mixedSkill, { recursive: true });
  fs.mkdirSync(bilingualSkill, { recursive: true });
  fs.mkdirSync(chineseSkill, { recursive: true });
  fs.writeFileSync(
    path.join(mixedSkill, 'SKILL.md'),
    '---\nname: mixed-trigger-skill\ndescription: Generates image cards for social media. Use when user mentions "小红书图片", "小红书种草", "微信图文", "微信贴图", "图片卡片", or wants social media infographic series.\n---\n',
  );
  fs.writeFileSync(
    path.join(bilingualSkill, 'SKILL.md'),
    '---\nname: bilingual-source-skill\ndescription: dontbesilent 中文说明主体在前但品牌名是英文，用于验证中文主体不会被误标为待翻译。 English explanation follows for compatibility.\n---\n',
  );
  fs.writeFileSync(
    path.join(chineseSkill, 'SKILL.md'),
    '---\nname: chinese-skill\ndescription: 这是一个已经有中文说明的 Skill，用于验证不会进入待翻译列表。\n---\n',
  );
  fs.mkdirSync(path.join(sourceRoot, '_manifests'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, '_manifests', 'zh-descriptions.json'),
    JSON.stringify({
      version: 1,
      descriptions: {
        dbs: '用于诊断业务问题，帮助用户找到关键瓶颈。',
      },
    }),
  );

  const missing = listMissingZhDescriptions(sourceRoot);
  const index = buildSourceIndex(sourceRoot);
  const bilingual = index.skills.find((skill) => skill.slug === 'bilingual-source-skill');

  assert.deepEqual(missing.map((skill) => skill.slug), ['baoyu-comic', 'mixed-trigger-skill']);
  assert.equal(missing[0].description, 'Make Chinese knowledge comics.');
  assert.match(missing[1].description, /^Generates image cards/);
  assert.equal(bilingual.zhDescriptionStatus, 'source');
  assert.equal(bilingual.zhDescription.includes('English explanation'), false);
});

test('parseImportInput accepts GitHub repository shorthands and URLs', () => {
  assert.deepEqual(parseImportInput('dontbesilent2025/dbskill'), {
    repoUrl: 'https://github.com/dontbesilent2025/dbskill.git',
    repoKey: 'dontbesilent2025/dbskill',
    repoDirName: 'dontbesilent2025__dbskill',
    requestedPath: null,
    scanAll: false,
    originalInput: 'dontbesilent2025/dbskill',
  });

  assert.deepEqual(parseImportInput('https://github.com/dontbesilent2025/dbskill'), {
    repoUrl: 'https://github.com/dontbesilent2025/dbskill.git',
    repoKey: 'dontbesilent2025/dbskill',
    repoDirName: 'dontbesilent2025__dbskill',
    requestedPath: null,
    scanAll: false,
    originalInput: 'https://github.com/dontbesilent2025/dbskill',
  });
});

test('parseImportInput extracts GitHub tree paths and skills CLI commands', () => {
  assert.deepEqual(parseImportInput('https://github.com/owner/repo/tree/main/skills/example-skill'), {
    repoUrl: 'https://github.com/owner/repo.git',
    repoKey: 'owner/repo',
    repoDirName: 'owner__repo',
    requestedPath: 'skills/example-skill',
    scanAll: false,
    originalInput: 'https://github.com/owner/repo/tree/main/skills/example-skill',
  });

  assert.deepEqual(parseImportInput('npx -y skills add dontbesilent2025/dbskill -g --all'), {
    repoUrl: 'https://github.com/dontbesilent2025/dbskill.git',
    repoKey: 'dontbesilent2025/dbskill',
    repoDirName: 'dontbesilent2025__dbskill',
    requestedPath: null,
    scanAll: true,
    originalInput: 'npx -y skills add dontbesilent2025/dbskill -g --all',
  });

  assert.throws(() => parseImportInput('https://example.com/not-github'), /只支持 GitHub/);
});

test('scanImportSource discovers skill candidates from a cached repository', () => {
  const { sourceRoot } = makeFixture();
  writeRepoSkill(
    sourceRoot,
    'owner__repo',
    'skills/alpha',
    '---\nname: alpha\ndescription: Alpha skill.\n---\n',
  );
  writeRepoSkill(
    sourceRoot,
    'owner__repo',
    'nested/beta',
    '---\nname: beta\ndescription: Beta skill.\n---\n',
  );

  const result = scanImportSource(sourceRoot, 'owner/repo', { skipGitRefresh: true });

  assert.equal(result.source.repoKey, 'owner/repo');
  assert.deepEqual(
    result.candidates.map((candidate) => ({
      slug: candidate.slug,
      sourcePath: candidate.sourcePath,
      existsLocally: candidate.existsLocally,
      conflictType: candidate.conflictType,
    })),
    [
      { slug: 'beta', sourcePath: 'nested/beta', existsLocally: false, conflictType: 'new' },
      { slug: 'alpha', sourcePath: 'skills/alpha', existsLocally: false, conflictType: 'new' },
    ],
  );
});

test('scanImportSource limits GitHub tree URL scans to the requested path', () => {
  const { sourceRoot } = makeFixture();
  writeRepoSkill(sourceRoot, 'owner__repo', 'skills/alpha', '---\nname: alpha\ndescription: Alpha.\n---\n');
  writeRepoSkill(sourceRoot, 'owner__repo', 'skills/beta', '---\nname: beta\ndescription: Beta.\n---\n');

  const result = scanImportSource(sourceRoot, 'https://github.com/owner/repo/tree/main/skills/beta', { skipGitRefresh: true });

  assert.deepEqual(result.candidates.map((candidate) => candidate.slug), ['beta']);
  assert.equal(result.candidates[0].sourcePath, 'skills/beta');
});

test('scanImportSource treats a repository-root SKILL.md as a root skill', () => {
  const { sourceRoot } = makeFixture();
  writeRepoSkill(
    sourceRoot,
    'eze-is__web-access',
    '.',
    '---\nname: web-access\ndescription: web-access Skill\n---\n',
  );

  const result = scanImportSource(sourceRoot, 'https://github.com/eze-is/web-access', { skipGitRefresh: true });

  assert.deepEqual(
    result.candidates.map((candidate) => ({
      slug: candidate.slug,
      name: candidate.name,
      sourcePath: candidate.sourcePath,
      conflictType: candidate.conflictType,
    })),
    [
      {
        slug: 'web-access',
        name: 'web-access',
        sourcePath: '.',
        conflictType: 'new',
      },
    ],
  );
});

test('installImportedSkills installs a new skill and binds an exact non-standard source rule', () => {
  const { sourceRoot } = makeFixture();
  writeRepoSkill(
    sourceRoot,
    'owner__repo',
    'packages/gamma',
    '---\nname: gamma\ndescription: Gamma skill.\n---\n',
  );

  const result = installImportedSkills(sourceRoot, {
    source: parseImportInput('owner/repo'),
    items: [{ slug: 'gamma', sourcePath: 'packages/gamma', action: 'install' }],
  }, { skipGitRefresh: true });

  const installedSkill = path.join(sourceRoot, 'skills', 'gamma', 'SKILL.md');
  const installedText = fs.readFileSync(installedSkill, 'utf8');
  const rules = JSON.parse(fs.readFileSync(path.join(sourceRoot, '_manifests', 'source-rules.json'), 'utf8')).rules;
  const gammaRule = rules.find((rule) => rule.match?.exact === 'gamma');
  const index = buildSourceIndex(sourceRoot);
  const gamma = index.skills.find((skill) => skill.slug === 'gamma');

  assert.equal(result.summary.installed, 1);
  assert.equal(result.summary.failed, 0);
  assert.equal(installedText, '---\nname: gamma\ndescription: Gamma skill.\n---\n');
  assert.equal(installedText.includes('source_repo'), false);
  assert.equal(gammaRule.repoUrl, 'https://github.com/owner/repo.git');
  assert.equal(gammaRule.sourcePathTemplate, 'packages/gamma');
  assert.equal(gamma.source.sourcePath, 'packages/gamma');
});

test('installImportedSkills infers missing root skill fields from SKILL.md', () => {
  const { sourceRoot } = makeFixture();
  writeRepoSkill(
    sourceRoot,
    'eze-is__web-access',
    '.',
    '---\nname: web-access\ndescription: web-access Skill\n---\n',
  );

  const result = installImportedSkills(sourceRoot, {
    source: parseImportInput('https://github.com/eze-is/web-access'),
    items: [{ action: 'install' }],
  }, { skipGitRefresh: true });

  assert.equal(result.summary.installed, 1);
  assert.equal(result.summary.failed, 0);
  assert.equal(fs.existsSync(path.join(sourceRoot, 'skills', 'web-access', 'SKILL.md')), true);
  const index = buildSourceIndex(sourceRoot);
  const imported = index.skills.find((skill) => skill.slug === 'web-access');
  assert.equal(imported.source.repoKey, 'eze-is/web-access');
  assert.equal(imported.source.sourcePath, '.');
});

test('installImportedSkills skips an existing skill without changing local files', () => {
  const { sourceRoot } = makeFixture();
  const original = fs.readFileSync(path.join(sourceRoot, 'skills', 'dbs', 'SKILL.md'), 'utf8');
  writeRepoSkill(sourceRoot, 'owner__repo', 'skills/dbs', '---\nname: dbs\ndescription: Remote dbs.\n---\n');

  const result = installImportedSkills(sourceRoot, {
    source: parseImportInput('owner/repo'),
    items: [{ slug: 'dbs', sourcePath: 'skills/dbs', action: 'skip' }],
  }, { skipGitRefresh: true });

  assert.equal(result.summary.skipped, 1);
  assert.equal(fs.readFileSync(path.join(sourceRoot, 'skills', 'dbs', 'SKILL.md'), 'utf8'), original);
});

test('installImportedSkills backs up and overwrites an existing skill when requested', () => {
  const { sourceRoot } = makeFixture();
  writeRepoSkill(sourceRoot, 'owner__repo', 'skills/dbs', '---\nname: dbs\ndescription: Remote dbs.\n---\n');

  const result = installImportedSkills(sourceRoot, {
    source: parseImportInput('owner/repo'),
    items: [{ slug: 'dbs', sourcePath: 'skills/dbs', action: 'overwrite' }],
  }, { skipGitRefresh: true });

  const overwrittenText = fs.readFileSync(path.join(sourceRoot, 'skills', 'dbs', 'SKILL.md'), 'utf8');
  const overwriteResult = result.results.find((item) => item.slug === 'dbs');
  const backupText = fs.readFileSync(path.join(overwriteResult.backupPath, 'SKILL.md'), 'utf8');

  assert.equal(result.summary.overwritten, 1);
  assert.equal(overwrittenText, '---\nname: dbs\ndescription: Remote dbs.\n---\n');
  assert.match(backupText, /Diagnose business problems/);
});

test('removeSourceSkills backs up source skills, clears source metadata, and rebuilds public index', () => {
  const { sourceRoot } = makeFixture();
  fs.mkdirSync(path.join(sourceRoot, '_manifests'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, '_manifests', 'source-rules.json'),
    JSON.stringify({
      rules: [
        {
          id: 'owner-repo-skills',
          label: 'owner/repo',
          repoUrl: 'https://github.com/owner/repo.git',
          match: { exact: ['baoyu-comic', 'dbs'] },
          sourcePathTemplate: 'skills/{slug}',
        },
      ],
    }),
  );
  writeUpdateStatusCache(sourceRoot, {
    generatedAt: '2026-07-01T00:00:00.000Z',
    summary: { totalSourceBound: 2, current: 2, needsUpdate: 0, sourceMissing: 0, unconfirmed: 0 },
    skills: {
      'baoyu-comic': { slug: 'baoyu-comic', status: 'current', needsUpdate: false },
      dbs: { slug: 'dbs', status: 'current', needsUpdate: false },
    },
  });
  rebuildSourceDashboard(sourceRoot);

  const result = removeSourceSkills(sourceRoot, ['baoyu-comic']);
  const publicIndex = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'skills-index.json'), 'utf8'));
  const rules = JSON.parse(fs.readFileSync(path.join(sourceRoot, '_manifests', 'source-rules.json'), 'utf8')).rules;
  const backupText = fs.readFileSync(path.join(result.removed[0].backupPath, 'SKILL.md'), 'utf8');

  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].slug, 'baoyu-comic');
  assert.equal(fs.existsSync(path.join(sourceRoot, 'skills', 'baoyu-comic')), false);
  assert.match(backupText, /Make Chinese knowledge comics/);
  assert.deepEqual(rules[0].match.exact, ['dbs']);
  assert.equal(fs.existsSync(path.join(sourceRoot, '_manifests', 'update-status.json')), false);
  assert.deepEqual(publicIndex.skills.map((skill) => skill.slug).sort(), ['dbs']);
  assert.equal(fs.readFileSync(path.join(sourceRoot, 'dashboard.html'), 'utf8').includes('baoyu-comic'), false);
});

test('dashboard service scans and installs imported skills through local APIs', async () => {
  const { sourceRoot } = makeFixture();
  writeRepoSkill(sourceRoot, 'owner__repo', 'skills/alpha', '---\nname: alpha\ndescription: Alpha skill.\n---\n');

  await withServer(sourceRoot, async (baseUrl) => {
    const scanResponse = await fetch(`${baseUrl}/api/import/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'owner/repo', skipGitRefresh: true }),
    });
    const scanPayload = await scanResponse.json();

    assert.equal(scanResponse.status, 200);
    assert.equal(scanPayload.ok, true);
    assert.deepEqual(scanPayload.candidates.map((candidate) => candidate.slug), ['alpha']);

    const installResponse = await fetch(`${baseUrl}/api/import/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: scanPayload.source,
        skipGitRefresh: true,
        items: [{ slug: 'alpha', sourcePath: 'skills/alpha', action: 'install' }],
      }),
    });
    const installPayload = await installResponse.json();

    assert.equal(installResponse.status, 200);
    assert.equal(installPayload.ok, true);
    assert.equal(installPayload.summary.installed, 1);
    assert.equal(fs.existsSync(path.join(sourceRoot, 'skills', 'alpha', 'SKILL.md')), true);
  });
});

test('dashboard service removes source skills through local APIs', async () => {
  const { sourceRoot } = makeFixture();

  await withServer(sourceRoot, async (baseUrl) => {
    const removeResponse = await fetch(`${baseUrl}/api/skills/${encodeURIComponent('baoyu-comic')}/remove`, {
      method: 'POST',
    });
    const removePayload = await removeResponse.json();
    const indexResponse = await fetch(`${baseUrl}/skills-index.json`);
    const publicIndex = await indexResponse.json();

    assert.equal(removeResponse.status, 200);
    assert.equal(removePayload.ok, true);
    assert.equal(removePayload.removed[0].slug, 'baoyu-comic');
    assert.equal(fs.existsSync(path.join(sourceRoot, 'skills', 'baoyu-comic')), false);
    assert.deepEqual(publicIndex.skills.map((skill) => skill.slug), ['dbs']);
  });
});

test('dashboard service updates only selected skills through a dedicated API', async () => {
  const { sourceRoot } = makeFixture();
  fs.mkdirSync(path.join(sourceRoot, '_manifests'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, '_manifests', 'source-rules.json'),
    JSON.stringify({
      rules: [
        {
          id: 'fixture-skills',
          label: 'Fixture Skills',
          repoUrl: 'https://github.com/owner/repo.git',
          match: { exact: ['baoyu-comic', 'dbs'] },
          sourcePathTemplate: 'skills/{slug}',
        },
      ],
    }),
  );
  writeRepoSkill(sourceRoot, 'owner__repo', 'skills/dbs', '---\nname: dbs\ndescription: Remote dbs copy.\n---\n');
  writeRepoSkill(sourceRoot, 'owner__repo', 'skills/baoyu-comic', '---\nname: baoyu-comic\ndescription: Remote comic copy.\n---\n');

  await withServer(sourceRoot, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/skills/update-selected`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slugs: ['dbs'], skipGitRefresh: true }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.scope, 'slugs');
    assert.deepEqual(payload.slugs, ['dbs']);
    assert.deepEqual(payload.updated.map((item) => item.slug), ['dbs']);
    assert.equal(fs.readFileSync(path.join(sourceRoot, 'skills', 'dbs', 'SKILL.md'), 'utf8').includes('Remote dbs copy'), true);
    assert.equal(fs.readFileSync(path.join(sourceRoot, 'skills', 'baoyu-comic', 'SKILL.md'), 'utf8').includes('Remote comic copy'), false);
  });
});

test('dashboard service lists workspace projects with project skill state', async () => {
  const { root, sourceRoot } = makeFixture();
  const imageProject = path.join(root, 'projects', '贴图');
  const productProject = path.join(root, 'products', '小红书虚拟资料');
  const webProject = path.join(root, 'web', 'local-document-reader');
  fs.mkdirSync(imageProject, { recursive: true });
  fs.mkdirSync(productProject, { recursive: true });
  fs.mkdirSync(webProject, { recursive: true });
  enableSkills(imageProject, sourceRoot, ['baoyu-comic']);

  await withServer(sourceRoot, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.deepEqual(
      payload.projects.map((project) => ({
        id: project.id,
        group: project.group,
        enabledCount: project.enabledCount,
        initialized: project.initialized,
        isSourceRoot: project.isSourceRoot,
      })),
      [
        { id: 'products/小红书虚拟资料', group: 'products', enabledCount: 0, initialized: false, isSourceRoot: false },
        { id: 'projects/贴图', group: 'projects', enabledCount: 1, initialized: true, isSourceRoot: false },
        { id: 'skill-sources', group: 'skill-sources', enabledCount: 0, initialized: false, isSourceRoot: true },
        { id: 'web/local-document-reader', group: 'web', enabledCount: 0, initialized: false, isSourceRoot: false },
      ],
    );
  });
});

test('dashboard service enables and disables project skill links through local APIs', async () => {
  const { root, sourceRoot } = makeFixture();
  const projectDir = path.join(root, 'projects', '贴图');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '_manifests'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, '_manifests', 'zh-descriptions.json'),
    JSON.stringify({
      version: 1,
      descriptions: {
        'baoyu-comic': '用于把知识内容整理成中文漫画，适合需要图文分镜表达的场景。',
      },
    }),
  );

  await withServer(sourceRoot, async (baseUrl) => {
    const stateResponse = await fetch(`${baseUrl}/api/projects/${encodeURIComponent('projects/贴图')}/skills`);
    const statePayload = await stateResponse.json();
    const comicSkill = statePayload.project.availableSkills.find((skill) => skill.slug === 'baoyu-comic');

    assert.equal(stateResponse.status, 200);
    assert.equal(comicSkill.category, 'Visual / Image');
    assert.equal(comicSkill.categoryLabel, '图像/视频能力');
    assert.equal(comicSkill.description, '用于把知识内容整理成中文漫画，适合需要图文分镜表达的场景。');
    assert.equal(comicSkill.sourceDescription, 'Make Chinese knowledge comics.');

    const enableResponse = await fetch(`${baseUrl}/api/projects/${encodeURIComponent('projects/贴图')}/skills/baoyu-comic/enable`, {
      method: 'POST',
    });
    const enablePayload = await enableResponse.json();

    assert.equal(enableResponse.status, 200);
    assert.equal(enablePayload.ok, true);
    assert.deepEqual(enablePayload.project.enabledSkills.map((skill) => skill.slug), ['baoyu-comic']);
    assert.equal(fs.lstatSync(path.join(projectDir, '.agents', 'skills', 'baoyu-comic')).isSymbolicLink(), true);

    const disableResponse = await fetch(`${baseUrl}/api/projects/${encodeURIComponent('projects/贴图')}/skills/baoyu-comic/disable`, {
      method: 'POST',
    });
    const disablePayload = await disableResponse.json();

    assert.equal(disableResponse.status, 200);
    assert.equal(disablePayload.ok, true);
    assert.deepEqual(disablePayload.project.enabledSkills, []);
    assert.equal(fs.existsSync(path.join(projectDir, '.agents', 'skills', 'baoyu-comic')), false);
  });
});

test('dashboard service returns install failure details for failed import items', async () => {
  const { sourceRoot } = makeFixture();
  writeRepoSkill(sourceRoot, 'owner__repo', 'skills/alpha', '---\nname: alpha\ndescription: Alpha skill.\n---\n');

  await withServer(sourceRoot, async (baseUrl) => {
    const installResponse = await fetch(`${baseUrl}/api/import/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: parseImportInput('owner/repo'),
        skipGitRefresh: true,
        items: [{ slug: 'alpha', sourcePath: 'skills/missing-alpha', action: 'install' }],
      }),
    });
    const installPayload = await installResponse.json();

    assert.equal(installResponse.status, 409);
    assert.equal(installPayload.ok, false);
    assert.equal(installPayload.summary.failed, 1);
    assert.match(installPayload.error, /alpha/);
    assert.match(installPayload.error, /没有 SKILL\.md|不存在/);
    assert.equal(Object.hasOwn(installPayload, 'index'), false);
    assert.equal(fs.existsSync(path.join(sourceRoot, 'skills', 'alpha')), false);
  });
});

test('dashboard shows update success only after refreshing update status', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  const singleRefresh = html.indexOf("await loadUpdateStatus();\n        showNotice('已更新 ' + slug");
  const batchLoad = html.indexOf("await loadUpdateStatus();", html.indexOf('async function syncSkills'));
  const batchRefreshDone = html.indexOf('statusRefreshed = true;', batchLoad);
  const batchNotice = html.indexOf('showNotice(payload.newSkillCount', batchLoad);
  const oldSingleOrder = html.indexOf("showNotice('已更新 ' + slug + '，页面数据也已重新生成。');\n        await loadUpdateStatus();");
  const oldBatchOrder = html.indexOf("showNotice(payload.count ? '已同步 ' + payload.count + ' 个 Skill。' : '已检测完毕，全部 Skill 都是最新。');\n        await loadUpdateStatus();");

  assert.notEqual(singleRefresh, -1);
  assert.notEqual(batchLoad, -1);
  assert.notEqual(batchRefreshDone, -1);
  assert.notEqual(batchNotice, -1);
  assert.ok(batchLoad < batchNotice);
  assert.ok(batchRefreshDone < batchNotice);
  assert.equal(oldSingleOrder, -1);
  assert.equal(oldBatchOrder, -1);
});

test('dashboard favicon is self-contained for already-running local servers', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml;base64,/);
  assert.equal(html.includes('href="./favicon.svg"'), false);
});

test('dashboard makes sync scope explicit for global and current-category actions', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /<button type="button" class="update-button" data-action="sync-active-scope" id="updateAll">同步全部 Skill<\/button>/);
  assert.equal(html.includes('id="updateCurrentCategory"'), false);
  assert.equal(html.includes('id="categorySelect"'), false);
  assert.equal(html.includes('categorySelect.addEventListener'), false);
  assert.equal(html.includes('全部同步固定检测全库'), false);
  assert.equal(html.includes('id="updateAll" hidden'), false);
  assert.match(html, /updateAll\.hidden = false;/);
  assert.match(html, /function updateSyncButtonLabel\(\)/);
  assert.match(html, /function getCurrentCategoryLabel\(\)/);
  assert.match(html, /function syncableVisibleSkills\(\)/);
  assert.match(html, /function shouldSyncVisibleSelection\(\)/);
  assert.match(html, /updateAll\.textContent = '同步当前结果：' \+ syncScope\.label \+ '（' \+ syncScope\.count \+ ' 个）';/);
  assert.match(html, /正在检测并同步所有已绑定来源的 Skill/);
  assert.match(html, /正在检测并同步当前分类：/);
  assert.match(html, /showNotice\(payload\.newSkillCount/);
  assert.match(html, /'已同步 ' \+ scopeLabel \+ '，并发现 ' \+ payload\.newSkillCount \+ ' 个新增 Skill。'/);
  assert.match(html, /payload\.count \? '已同步 ' \+ scopeLabel/);
});

test('dashboard current-category sync calls the scoped update endpoint', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /syncSkills\(\)/);
  assert.match(html, /const syncScope = currentSyncScope\(\);/);
  assert.equal(html.includes("const categoryQuery = syncScope.type === 'category' ? '?category=' + encodeURIComponent(syncScope.category) : '';"), true);
  assert.equal(html.includes("const syncPath = syncScope.type === 'selection' ? '/api/skills/update-selected' : '/api/skills/update-all' + categoryQuery;"), true);
  assert.equal(html.includes("fetch(syncPath, {"), true);
  assert.match(html, /signal: controller\.signal/);
});

test('dashboard visible-result sync posts only currently displayed skill slugs', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /function currentSyncScope\(\)/);
  assert.match(html, /const visibleSkills = syncableVisibleSkills\(\);/);
  assert.match(html, /if \(shouldSyncVisibleSelection\(\)\) return \{ type: 'selection', label: visibleSyncLabel\(\), count: visibleSkills\.length, slugs: visibleSkills\.map\(\(skill\) => skill\.slug\) \};/);
  assert.match(html, /return Boolean\(state\.query \|\| state\.graphScope \|\| state\.category === 'Favorites'\);/);
  assert.match(html, /updateAll\.disabled = syncScope\.type === 'selection' && syncScope\.slugs\.length === 0;/);
  assert.match(html, /const syncPath = syncScope\.type === 'selection' \? '\/api\/skills\/update-selected' : '\/api\/skills\/update-all' \+ categoryQuery;/);
  assert.match(html, /const requestBody = syncScope\.type === 'selection' \? \{ slugs: syncScope\.slugs \} : null;/);
  assert.match(html, /body: requestBody \? JSON\.stringify\(requestBody\) : undefined/);
  assert.match(html, /if \(scope === 'selection' && payload\.scope !== 'slugs'\) throw new Error\('本地服务版本较旧，请重启 Skill 源库服务后再同步当前结果。'\);/);
  assert.match(html, /if \(scope !== 'selection' && payload\.newSkillCount\) openNewSkillsFromSync\(payload\.newSkillGroups \|\| \[\]\);/);
});

test('dashboard sync request has a timeout and restores stuck button state', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /const syncTimeoutMs = 180000;/);
  assert.match(html, /new AbortController\(\)/);
  assert.match(html, /window\.setTimeout\(\(\) => controller\.abort\(\), syncTimeoutMs\)/);
  assert.match(html, /signal: controller\.signal/);
  assert.match(html, /error\.name === 'AbortError'/);
  assert.match(html, /同步超时/);
  assert.match(html, /button\.textContent = original;/);
});

test('dashboard restores current-category sync label after successful refresh', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');
  const refreshIndex = html.indexOf('await loadUpdateStatus();');
  const restoreIndex = html.indexOf('updateSyncButtonLabel();', refreshIndex);
  const successIndex = html.indexOf('statusRefreshed = true;', refreshIndex);

  assert.notEqual(refreshIndex, -1);
  assert.notEqual(restoreIndex, -1);
  assert.ok(restoreIndex < successIndex);
});

test('dashboard opens install confirmation when sync finds new skills', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /function openNewSkillsFromSync\(groups\)/);
  assert.match(html, /payload\.newSkillCount/);
  assert.match(html, /openNewSkillsFromSync\(payload\.newSkillGroups \|\| \[\]\)/);
  assert.match(html, /发现 ' \+ payload\.newSkillCount \+ ' 个新增 Skill/);
  assert.match(html, /const groups = new Map\(\)/);
  assert.match(html, /const source = candidate\.source \|\| state\.importSource;/);
  assert.match(html, /groups\.set\(source\.repoKey, \{ source, items: \[\] \}\)/);
  assert.match(html, /source: group\.source/);
});

test('dashboard renders a Projects view for project skill link operations', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /data-section="skills"/);
  assert.match(html, /data-section="projects"/);
  assert.match(html, /项目绑定/);
  assert.match(html, /id="projectsSection"/);
  assert.match(html, /id="projectList"/);
  assert.match(html, /class="panel project-panel project-directory-panel"/);
  assert.match(html, /id="projectSearch"/);
  assert.match(html, /id="projectGroupFilter"/);
  const directoryTools = html.match(/<div class="project-directory-tools">([\s\S]*?)<\/div>/)?.[1] || '';
  const projectToolbar = html.match(/<div class="project-toolbar">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.match(directoryTools, /id="reloadProjects"/);
  assert.equal(projectToolbar.includes('id="reloadProjects"'), false);
  assert.match(html, /function projectIdentityLabel\(project\)/);
  assert.match(html, /Skill 管理项目 \/ 当前源库/);
  assert.match(html, /function filteredProjects\(\)/);
  assert.match(html, /projectGroupFilter\.addEventListener/);
  assert.match(html, /\.project-workspace \{[^}]*align-items: stretch;/);
  assert.match(html, /#projectsSection\.section\.active \{ grid-template-rows: auto minmax\(0, 1fr\); row-gap: 16px; \}/);
  assert.match(html, /\.workspace, \.project-workspace \{ min-height: 0; height: 100%; \}/);
  assert.match(html, /\.project-workspace \{ margin-top: 0; \}/);
  assert.equal(html.includes('calc(100vh - 191px)'), false);
  assert.match(html, /\.project-directory-panel \{ display: grid; grid-template-rows: auto auto auto minmax\(0, 1fr\); \}/);
  assert.match(html, /\.project-skill-panel \{ display: grid; grid-template-rows: auto auto auto auto minmax\(0, 1fr\); \}/);
  assert.match(html, /class="panel project-panel project-skill-panel"/);
  assert.match(html, /id="projectSkillModeTabs"/);
  assert.match(html, /data-project-skill-mode="enabled"/);
  assert.match(html, /data-project-skill-mode="all"/);
  assert.match(html, /id="projectSkillList"/);
  assert.match(html, /\.nav\[hidden\] \{ display: none; \}/);
  assert.match(html, /id="projectCategoryFilter"/);
  assert.match(html, /projectCategoryFilter\.addEventListener/);
  assert.match(html, /projectCategoryOk/);
  assert.match(html, /\.project-toolbar \{ grid-template-columns: 1fr; \}/);
  assert.match(html, /function loadProjects\(\)/);
  assert.match(html, /function openProject\(projectId\)/);
  assert.match(html, /state\.projectSkillMode = 'enabled';/);
  assert.match(html, /function enabledProjectSkills\(\)/);
  assert.match(html, /function renderProjectSkillModeTabs\(\)/);
  assert.match(html, /state\.projectSkillMode === 'enabled' \? enabledProjectSkills\(\) : \(state\.activeProject\.availableSkills \|\| \[\]\)/);
  assert.match(html, /这个项目还没有接入 Skill。/);
  assert.match(html, /data-project-skill-mode-empty="all"/);
  assert.match(html, /projectSkillModeTabs\.addEventListener/);
  assert.match(html, /function setProjectSkill\(slug, action, button\)/);
  assert.match(html, /function projectDetailStatus\(project, enabled, broken\)/);
  assert.match(html, /projectStatus\.textContent = projectDetailStatus\(payload\.project, payload\.project\.enabledSkills\.length, payload\.project\.report\.brokenLinks\.length\)/);
  assert.equal(html.includes("fetch('/api/projects')"), true);
  assert.equal(html.includes("fetch('/api/projects/' + encodeURIComponent(projectId) + '/skills')"), true);
  assert.equal(html.includes("'/api/projects/' + encodeURIComponent(state.activeProjectId) + '/skills/' + encodeURIComponent(slug) + '/' + action"), true);
});

test('source update git commands are bounded and non-interactive', () => {
  const script = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'scripts', 'skill-workbench.mjs'), 'utf8');

  assert.match(script, /const gitCommandTimeoutMs = 120000;/);
  assert.match(script, /timeout: gitCommandTimeoutMs/);
  assert.match(script, /GIT_TERMINAL_PROMPT: '0'/);
  assert.match(script, /updateSkillFromSource\(sourceRoot, slug, \{ refresh: false \}\)/);
});

test('dashboard renders a skill import wizard with unchecked candidate defaults', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /添加 Skill/);
  assert.match(html, /id="importModal"/);
  assert.match(html, /id="importSourceInput"/);
  assert.match(html, /id="scanImport"/);
  assert.match(html, /id="installImport"/);
  assert.equal(html.includes("fetch('/api/import/scan'"), true);
  assert.equal(html.includes("fetch('/api/import/install'"), true);
  assert.match(html, /selected: false/);
  assert.match(html, /安装选中的 Skill/);
  assert.match(html, /formatImportInstallError/);
  assert.match(html, /payload\.summary\?\.failed/);
  assert.match(html, /没有安装任何 Skill/);
});

test('dashboard import wizard can select and clear all installable candidates', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /id="toggleImportSelection"/);
  assert.match(html, /function importSelectableCandidates\(\)/);
  assert.match(html, /function syncImportSelectionToggle\(\)/);
  assert.match(html, /function toggleImportSelection\(\)/);
  assert.match(html, /candidate\.action !== 'skip'/);
  assert.match(html, /selectable\.some\(\(candidate\) => !candidate\.selected\)/);
  assert.match(html, /candidate\.selected = shouldSelect/);
  assert.match(html, /importSelectionToggle\.addEventListener\('click', toggleImportSelection\)/);
});

test('dashboard import dialog keeps the outer modal fixed while the candidate list scrolls', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /\.dialog\.import-dialog \{ width: min\(760px, 100%\); height: min\(720px, calc\(100vh - 48px\)\); overflow: hidden; display: grid;/);
  assert.match(html, /grid-template-rows: auto auto minmax\(0, 1fr\) auto;/);
  assert.match(html, /class="info-box import-results-box"/);
  assert.match(html, /\.import-results-box \{ display: flex; flex-direction: column; min-height: 0; \}/);
  assert.match(html, /\.import-list \{ display: grid; gap: 8px; min-height: 0; max-height: none; overflow: auto; padding: 0 3px 12px 0; scroll-padding-bottom: 12px; \}/);
});

test('dashboard shows graph navigation beside a synchronized result list', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /class="graph-workspace"/);
  assert.match(html, /id="graphScopeText"/);
  assert.match(html, /id="graphResultCount"/);
  assert.match(html, /class="cards-grid graph-cards-grid" id="graphCardsGrid"/);
  assert.match(html, /class="cards-frame"[\s\S]*class="cards-grid" id="cardsGrid"/);
  assert.match(html, /\.cards-frame \{[\s\S]*padding-bottom: 12px;[\s\S]*\}/);
  assert.match(html, /\.cards-grid \{ display: grid; gap: 0; align-content: start; grid-auto-rows: minmax\(62px, auto\); height: 100%; max-height: 100%; overflow: auto; padding: 0; scroll-padding-bottom: 12px;/);
  assert.equal(html.includes("graphCanvas.insertAdjacentHTML('beforeend'"), false);
  assert.equal(html.includes('class="card-list"'), false);
  assert.equal(html.includes('class="skill-row"'), false);
  assert.equal(html.includes("graphCanvas.querySelectorAll('[data-skill]')"), false);
  assert.match(html, /graphCanvas\.querySelectorAll\('\[data-graph-scope\]'\)[\s\S]*setGraphScope/);
  assert.match(html, /function bindSkillCards\(container\)[\s\S]*if \(skill\) openSkill\(skill\);/);
  assert.match(html, /bindSkillCards\(cardsGrid\);/);
  assert.match(html, /bindSkillCards\(graphCardsGrid\);/);
  assert.match(html, /@media \(min-width: 1061px\) and \(min-height: 700px\) \{/);
  assert.match(html, /\.section\.active \{ display: grid; min-height: 0; height: 100%; \}/);
  assert.match(html, /#skillsSection\.section\.active \{ grid-template-rows: auto auto auto minmax\(0, 1fr\); \}/);
  assert.match(html, /\.workspace, \.project-workspace \{ min-height: 0; height: 100%; \}/);
  assert.equal(html.includes('calc(100vh - 276px)'), false);
  assert.match(html, /\.insights \{ overflow: auto; \}/);
  assert.match(html, /\.cards-frame \{ max-height: none; height: calc\(100% - 2px\); \}/);
  assert.match(html, /\.cards-grid \{ max-height: none; height: 100%; \}/);
  assert.match(html, /\.project-list, \.project-skill-list \{ display: grid; gap: 9px; max-height: 560px; overflow: auto; padding: 0 4px 12px 0; scroll-padding-bottom: 12px; \}/);
});

test('dashboard hides graph switch and defaults to list view', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /view: 'cards'/);
  assert.equal(html.includes('data-view="graph"'), false);
  assert.equal(html.includes('data-view="cards"'), false);
  assert.equal(html.includes('[data-view]'), false);
  assert.equal(html.includes('>图谱<'), false);
  assert.match(html, /<h3>Skill 列表<\/h3>/);
  assert.match(html, /<div class="view" id="graphView">/);
  assert.match(html, /<div class="view active" id="cardsView">/);
  assert.match(html, /data-insight-category="DBS"/);
  assert.match(html, /function setCategory\(category\)/);
  assert.match(html, /state\.graphScope = null;/);
  assert.match(html, /updateInsightSelection\(\);/);
  assert.match(html, /function updateInsightSelection\(\)/);
  assert.match(html, /insights\.classList\.toggle\('filtered', Boolean\(activeCategory\)\);/);
  assert.match(html, /data-category="All"/);
  assert.match(html, /node\.dataset\.category === 'All' \|\| state\.category === node\.dataset\.category \? 'All' : node\.dataset\.category/);
  assert.match(html, /展开/);
  assert.match(html, /function renderSelectedCategoryGraph\(skills, category, width, height, cx, cy, groups\)/);
  assert.match(html, /renderSelectedCategoryGraph\(skills, activeCategories\[0\], width, height, cx, cy, graphGroups\);/);
  assert.match(html, /data-graph-scope="' \+ escapeText\(group\.key\)/);
  assert.match(html, /\.node text \{ pointer-events: all;/);
});

test('dashboard groups selected category graph by source and status', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /\.graph-workspace \{[\s\S]*grid-template-columns: minmax\(520px, 1fr\) minmax\(260px, 320px\);/);
  assert.match(html, /function selectedCategoryGraphGroups\(skills\)/);
  assert.match(html, /const updateCount = skills\.filter\(\(skill\) => skillUpdateStatus\(skill\)\?\.needsUpdate\)\.length;/);
  assert.match(html, /const unboundCount = skills\.filter\(\(skill\) => !skill\.source\?\.repoUrl\)\.length;/);
  assert.match(html, /const visibleSources = sourceGroups\.slice\(0, 5\);/);
  assert.match(html, /const hiddenSources = sourceGroups\.slice\(5\);/);
  assert.match(html, /function selectedCategoryGroupNodes\(groups, categoryNode\)/);
  assert.match(html, /const columnCount = groups\.length > 5 \? 2 : 1;/);
  assert.match(html, /const root = \{ x: 86, y: cy \};/);
  assert.match(html, /const categoryNode = \{ x: 246, y: cy \};/);
  assert.match(html, /function graphNodeLabel\(value, maxLength = 16\)/);
  assert.match(html, /graphNodeLabel\(group\.label\)/);
  assert.match(html, /<text class="graph-node-label" text-anchor="middle" y="50"/);
  assert.equal(html.includes('<text text-anchor="start" x="48" y="4">'), false);
  assert.match(html, /const width = showCategoryDetail \? 640 : 860;/);
  assert.equal(html.includes('skills.slice(0, 18)'), false);
});

test('dashboard graph result cards keep skill titles to one ellipsized line', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /\.skill-card h4 \{[\s\S]*white-space: nowrap;[\s\S]*text-overflow: ellipsis;[\s\S]*overflow: hidden;/);
  assert.match(html, /\.skill-summary \{ min-width: 0; overflow: hidden; \}/);
  assert.match(html, /\.card-open \{[\s\S]*grid-template-columns: 34px minmax\(0, 1fr\);/);
});

test('dashboard graph uses aggregate navigation instead of duplicating the skill list', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /graphScope: null/);
  assert.match(html, /function graphScopeLabel\(scope\)/);
  assert.match(html, /function selectedCategoryGraphGroups\(skills\)/);
  assert.match(html, /data-graph-scope="' \+ escapeText\(group\.key\)/);
  assert.match(html, /function skillMatchesGraphScope\(skill, scope\)/);
  assert.match(html, /graphCanvas\.querySelectorAll\('\[data-graph-scope\]'\)/);
  assert.equal(html.includes("graphCanvas.querySelectorAll('[data-skill]')"), false);
});

test('dashboard source label helper avoids slash-sensitive regex in generated html', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /text\.startsWith\('https:\/\/github\.com\/'\)/);
  assert.match(html, /return text\.slice\('https:\/\/github\.com\/'\.length\);/);
  assert.equal(html.includes('replace(/^https://github.com//'), false);
});

test('dashboard does not restore stale sync button text after a successful status refresh', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /let statusRefreshed = false;/);
  assert.match(html, /statusRefreshed = true;/);
  assert.match(html, /if \(!statusRefreshed\) button\.textContent = original;/);
  assert.equal(html.includes('updateAll.disabled = false;\n        updateAll.textContent = original;'), false);
});

test('source dashboard generated files do not expose local absolute paths', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath, indexPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');
  const publicIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  assert.equal(publicIndex.root, '.');
  assert.equal(html.includes(sourceRoot), false);
  assert.equal(JSON.stringify(publicIndex).includes(sourceRoot), false);
  assert.match(publicIndex.skills[0].path, /^skills\//);
  assert.match(publicIndex.skills[0].skillFile, /^skills\/.+\/SKILL\.md$/);
});

test('update status cache reads without refreshing remote sources', () => {
  const { sourceRoot } = makeFixture();
  const emptyCache = readUpdateStatusCache(sourceRoot);

  assert.equal(emptyCache.cached, false);
  assert.equal(emptyCache.summary.totalSourceBound, 0);
  assert.equal(emptyCache.summary.needsUpdate, 0);
  assert.deepEqual(emptyCache.skills, {});

  const detectedStatus = {
    generatedAt: '2026-06-28T08:00:00.000Z',
    summary: {
      totalSourceBound: 1,
      current: 0,
      needsUpdate: 1,
      sourceMissing: 0,
      unconfirmed: 1,
    },
    skills: {
      dbs: {
        slug: 'dbs',
        status: 'changed',
        needsUpdate: true,
      },
    },
  };
  writeUpdateStatusCache(sourceRoot, detectedStatus);

  const cachedStatus = readUpdateStatusCache(sourceRoot);
  assert.equal(cachedStatus.cached, true);
  assert.equal(cachedStatus.generatedAt, '2026-06-28T08:00:00.000Z');
  assert.equal(cachedStatus.summary.needsUpdate, 1);
  assert.equal(cachedStatus.skills.dbs.needsUpdate, true);
});

test('dashboard loads cached update status instead of auto-detecting GitHub on page load', () => {
  const { sourceRoot } = makeFixture();
  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(html, /正在读取上次检测记录/);
  assert.match(html, /还没有检测记录，点击“同步全部 Skill”会检测 GitHub 来源并自动更新有变化的 Skill。/);
  assert.match(html, /上次检测：/);
  assert.equal(html.includes('正在检测 GitHub 来源是否有更新'), false);
});

test('buildSourceIndex applies source rules for repo-backed skill groups', () => {
  const { sourceRoot } = makeFixture();
  fs.mkdirSync(path.join(sourceRoot, '_manifests'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, '_manifests', 'source-rules.json'),
    JSON.stringify({
      rules: [
        {
          id: 'dbskill',
          label: 'DBS Skill project',
          repoUrl: 'https://github.com/dontbesilent2025/dbskill.git',
          match: { prefix: 'dbs' },
          sourcePathTemplate: 'skills/{slug}',
        },
      ],
    }),
  );

  const index = buildSourceIndex(sourceRoot);
  const dbs = index.skills.find((skill) => skill.slug === 'dbs');

  assert.equal(index.sourceStats.confirmed, 1);
  assert.equal(index.sourceStats.unconfirmed, 1);
  assert.equal(dbs.source.repoKey, 'dontbesilent2025/dbskill');
  assert.equal(dbs.source.sourcePath, 'skills/dbs');
  assert.equal(dbs.source.ruleId, 'dbskill');
});

test('buildUpdateStatus marks only changed repo-backed skills as needing update', () => {
  const { sourceRoot } = makeFixture();
  fs.mkdirSync(path.join(sourceRoot, '_manifests'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, '_manifests', 'source-rules.json'),
    JSON.stringify({
      rules: [
        {
          id: 'dbskill',
          label: 'DBS Skill project',
          repoUrl: 'https://github.com/dontbesilent2025/dbskill.git',
          match: { prefix: 'dbs' },
          sourcePathTemplate: 'skills/{slug}',
        },
      ],
    }),
  );
  const repoSkill = path.join(sourceRoot, '_repos', 'dontbesilent2025__dbskill', 'skills', 'dbs');
  fs.mkdirSync(repoSkill, { recursive: true });
  fs.writeFileSync(
    path.join(repoSkill, 'SKILL.md'),
    '---\nname: dbs\ndescription: Changed upstream copy.\n---\n',
  );

  const status = buildUpdateStatus(sourceRoot, { refresh: false });

  assert.equal(status.summary.totalSourceBound, 1);
  assert.equal(status.summary.needsUpdate, 1);
  assert.equal(status.skills.dbs.needsUpdate, true);
  assert.equal(status.skills.dbs.status, 'changed');
  assert.equal(status.skills['baoyu-comic'], undefined);

  fs.copyFileSync(
    path.join(repoSkill, 'SKILL.md'),
    path.join(sourceRoot, 'skills', 'dbs', 'SKILL.md'),
  );

  const updatedStatus = buildUpdateStatus(sourceRoot, { refresh: false });
  assert.equal(updatedStatus.summary.needsUpdate, 0);
  assert.equal(updatedStatus.skills.dbs.needsUpdate, false);
  assert.equal(updatedStatus.skills.dbs.status, 'current');
});

test('updateChangedSkills reports new upstream skills without installing them', () => {
  const { sourceRoot } = makeFixture();
  fs.mkdirSync(path.join(sourceRoot, '_manifests'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, '_manifests', 'source-rules.json'),
    JSON.stringify({
      rules: [
        {
          id: 'dbskill',
          label: 'DBS Skill project',
          repoUrl: 'https://github.com/dontbesilent2025/dbskill.git',
          match: { prefix: 'dbs' },
          sourcePathTemplate: 'skills/{slug}',
        },
      ],
    }),
  );
  writeRepoSkill(
    sourceRoot,
    'dontbesilent2025__dbskill',
    'skills/dbs',
    '---\nname: dbs\ndescription: Diagnose business problems.\n---\n',
  );
  writeRepoSkill(
    sourceRoot,
    'dontbesilent2025__dbskill',
    'skills/dbs-new',
    '---\nname: dbs-new\ndescription: New DBS upstream skill.\n---\n',
  );

  const result = updateChangedSkills(sourceRoot, { category: 'DBS', refresh: false });

  assert.equal(result.count, 0);
  assert.equal(result.newSkillCount, 1);
  assert.equal(result.newSkillGroups.length, 1);
  assert.equal(result.newSkillGroups[0].source.repoKey, 'dontbesilent2025/dbskill');
  assert.deepEqual(result.newSkillGroups[0].candidates.map((candidate) => candidate.slug), ['dbs-new']);
  assert.equal(fs.existsSync(path.join(sourceRoot, 'skills', 'dbs-new')), false);
});

test('updateChangedSkills can limit updates to explicit skill slugs', () => {
  const { sourceRoot } = makeFixture();
  fs.mkdirSync(path.join(sourceRoot, '_manifests'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, '_manifests', 'source-rules.json'),
    JSON.stringify({
      rules: [
        {
          id: 'fixture-skills',
          label: 'Fixture Skills',
          repoUrl: 'https://github.com/owner/repo.git',
          match: { exact: ['baoyu-comic', 'dbs'] },
          sourcePathTemplate: 'skills/{slug}',
        },
      ],
    }),
  );
  writeRepoSkill(
    sourceRoot,
    'owner__repo',
    'skills/dbs',
    '---\nname: dbs\ndescription: Remote dbs copy.\n---\n',
  );
  writeRepoSkill(
    sourceRoot,
    'owner__repo',
    'skills/baoyu-comic',
    '---\nname: baoyu-comic\ndescription: Remote comic copy.\n---\n',
  );

  const result = updateChangedSkills(sourceRoot, { slugs: ['dbs'], refresh: false });

  assert.equal(result.scope, 'slugs');
  assert.deepEqual(result.slugs, ['dbs']);
  assert.deepEqual(result.updated.map((item) => item.slug), ['dbs']);
  assert.equal(fs.readFileSync(path.join(sourceRoot, 'skills', 'dbs', 'SKILL.md'), 'utf8').includes('Remote dbs copy'), true);
  assert.equal(fs.readFileSync(path.join(sourceRoot, 'skills', 'baoyu-comic', 'SKILL.md'), 'utf8').includes('Remote comic copy'), false);
  assert.equal(result.newSkillCount, 0);
  assert.deepEqual(result.newSkillGroups, []);
});

test('initProject creates the project skill workspace without overwriting existing files', () => {
  const { root } = makeFixture();
  const projectDir = path.join(root, 'weibo-topic-lab');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'AGENTS.md'), '# Existing Rules\n');

  initProject(projectDir);
  initProject(projectDir);

  assert.equal(fs.readFileSync(path.join(projectDir, 'AGENTS.md'), 'utf8'), '# Existing Rules\n');
  assert.ok(fs.existsSync(path.join(projectDir, '.agents', 'skills')));
  assert.ok(fs.lstatSync(path.join(projectDir, '.claude', 'skills')).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(projectDir, '.agents', 'skills.yml')));
});

test('enableSkills links source skills and writes project inventory', () => {
  const { root, sourceRoot } = makeFixture();
  const projectDir = path.join(root, 'weibo-topic-lab');
  initProject(projectDir);

  const enabled = enableSkills(projectDir, sourceRoot, ['baoyu-comic', 'dbs']);
  const inventory = readProjectSkills(projectDir);

  assert.equal(enabled.length, 2);
  assert.equal(inventory.skills.length, 2);
  assert.equal(
    fs.readlinkSync(path.join(projectDir, '.agents', 'skills', 'baoyu-comic')),
    path.join(sourceRoot, 'skills', 'baoyu-comic'),
  );
  assert.equal(
    fs.readlinkSync(path.join(projectDir, '.agents', 'skills', 'dbs')),
    path.join(sourceRoot, 'skills', 'dbs'),
  );
});

test('checkProject reports broken project skill links', () => {
  const { root, sourceRoot } = makeFixture();
  const projectDir = path.join(root, 'weibo-topic-lab');
  initProject(projectDir);
  enableSkills(projectDir, sourceRoot, ['baoyu-comic']);
  fs.rmSync(path.join(sourceRoot, 'skills', 'baoyu-comic'), { recursive: true, force: true });

  const report = checkProject(projectDir);
  assert.equal(report.brokenLinks.length, 1);
  assert.match(report.brokenLinks[0].path, /baoyu-comic$/);
});

test('rebuildSourceDashboard renders hidden graph internals, cards, and skill detail UI', () => {
  const { sourceRoot } = makeFixture();

  const result = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(result.dashboardPath, 'utf8');

  assert.match(html, /本地 Skill 源库/);
  assert.equal(html.includes('data-view="graph"'), false);
  assert.equal(html.includes('data-view="cards"'), false);
  assert.equal(html.includes('[data-view]'), false);
  assert.match(html, /id="graphCanvas"/);
  assert.match(html, /id="skillModal"/);
  assert.match(html, /给 Agent 的指令/);
  assert.match(html, /接下来请优先使用这个 Skill/);
  assert.match(html, /复制指令/);
  assert.match(html, /window\.isSecureContext/);
  assert.match(html, /range\.selectNodeContents\(modalCommand\);/);
  assert.match(html, /copyCommand\.textContent = '已复制';/);
  assert.match(html, /showNotice\('已复制给 Agent 的指令，可以直接粘贴使用。'\);/);
  assert.match(html, /copyCommand\.textContent = '复制失败';/);
  assert.match(html, /showNotice\('复制失败：已帮你选中这段指令，可以按 Cmd\+C 手动复制。'\);/);
  assert.match(html, /可更新来源/);
  assert.match(html, /data-action="update-skill"/);
  assert.match(html, /id="modalRemove"/);
  assert.match(html, /移除这个 Skill/);
  assert.match(html, /id="removeConfirmModal"/);
  assert.match(html, /id="removeConfirmTitle"/);
  assert.match(html, /id="removeConfirmName"/);
  assert.match(html, /id="removeConfirmCancel"/);
  assert.match(html, /id="removeConfirmSubmit"/);
  assert.match(html, /openRemoveConfirm\(modalRemove\.dataset\.slug\)/);
  assert.equal(html.includes('confirm('), false);
  assert.match(html, /fetch\('\/api\/skills\/' \+ encodeURIComponent\(slug\) \+ '\/remove'/);
  assert.match(html, /baoyu-comic/);
  assert.match(html, /skills-index.json/);
});

test('dashboard renders local favorite controls and favorites filter', () => {
  const { sourceRoot } = makeFixture();

  const result = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(result.dashboardPath, 'utf8');

  assert.match(html, /data-category="Favorites"/);
  assert.match(html, />已收藏</);
  assert.match(html, /id="favoriteCount"/);
  assert.match(html, /id="modalFavorite"/);
  assert.match(html, /skillSources:favorites:v1/);
  assert.match(html, /function toggleFavorite\(slug\)/);
  assert.match(html, /state\.category === 'Favorites'/);
  assert.match(html, /isFavorite\(skill\.slug\)/);
});

test('rebuildSourceDashboard generates copyable agent prompts instead of repeating descriptions', () => {
  const { sourceRoot } = makeFixture();

  const { dashboardPath } = rebuildSourceDashboard(sourceRoot);
  const html = fs.readFileSync(dashboardPath, 'utf8');
  const dataJson = html.match(/<script id="skill-data" type="application\/json">([^<]+)<\/script>/)[1];
  const data = JSON.parse(dataJson);
  const comic = data.skills.find((skill) => skill.slug === 'baoyu-comic');

  assert.equal(
    comic.command,
    '接下来请优先使用「baoyu-comic」Skill。先阅读并遵循该 Skill 的规则，再根据我的具体需求完成任务。',
  );
  assert.equal(comic.command.includes(comic.zhDescription), false);
  assert.equal(comic.command.includes('使用 $baoyu-comic'), false);
});

test('exportPublicRepository mirrors only the configured public subset', () => {
  const { root, sourceRoot } = makeFixture();
  writePublicExportFixture(sourceRoot);
  const destination = path.join(root, 'skill-workbench-public');

  const result = exportPublicRepository(sourceRoot, destination);
  const publicIndex = JSON.parse(fs.readFileSync(path.join(destination, 'skills-index.json'), 'utf8'));

  assert.equal(result.repoName, 'skill-workbench');
  assert.equal(result.skills, 1);
  assert.equal(fs.existsSync(path.join(destination, 'README.md')), true);
  assert.equal(fs.existsSync(path.join(destination, 'scripts', 'skill-workbench.mjs')), true);
  assert.equal(fs.existsSync(path.join(destination, 'skills', 'example-skill', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(destination, 'skills', 'baoyu-comic')), false);
  assert.equal(fs.existsSync(path.join(destination, '_repos')), false);
  assert.deepEqual(publicIndex.skills.map((skill) => skill.slug), ['example-skill']);
  assert.equal(JSON.stringify(publicIndex).includes(sourceRoot), false);
});

test('exportPublicRepository refuses destinations inside the private source repository', () => {
  const { sourceRoot } = makeFixture();
  writePublicExportFixture(sourceRoot);

  assert.throws(
    () => exportPublicRepository(sourceRoot, path.join(sourceRoot, 'public-output')),
    /inside the source repository/,
  );
});
