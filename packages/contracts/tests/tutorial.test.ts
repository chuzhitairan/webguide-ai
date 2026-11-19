import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadTutorial } from '../src/index.js';
import type { AdapterCapabilities, Capabilities, TutorialVersion } from '../src/types.js';
import { fixtureCapabilities } from '../../../tests/fixtures/collaboration/capabilities.js';
import { makeTutorialText } from '../../../tests/fixtures/collaboration/cases.js';

const samples = new URL('../../../docs/design/contracts/', import.meta.url);
const collaboration = readFileSync(new URL('collaboration.tutorial.json', samples), 'utf8');
const pages = readFileSync(new URL('pages.tutorial.json', samples), 'utf8');
const fixture = JSON.parse(makeTutorialText()) as TutorialVersion;

function describeSample(raw: string): [string, AdapterCapabilities] {
  const tutorial = JSON.parse(raw) as TutorialVersion;
  const checkers = Object.fromEntries(tutorial.steps.flatMap(step =>
    step.check.type === 'adapter' ? [[step.check.checkerId, { readRoles: [step.pageRole], observationKinds: ['sample'] }]] : [],
  ));
  return [tutorial.adapterId, {
    parameterProfiles: [tutorial.parameterProfile],
    roles: tutorial.steps.map(step => step.pageRole),
    locatorIds: tutorial.steps.flatMap(step => 'locatorId' in step.target ? [step.target.locatorId] : []),
    checkers,
    finalVerifierIds: [tutorial.finalVerifierId],
  }];
}

const descriptionCapabilities: Capabilities = {
  mode: 'description',
  adapters: Object.fromEntries([describeSample(collaboration), describeSample(pages)]),
};

describe('教程加载', () => {
  it('报告损坏的 JSON', async () => {
    expect(await loadTutorial('{', fixtureCapabilities)).toMatchObject({ ok: false, code: 'INVALID_JSON' });
  });

  it('拒绝在 v1 使用仅由 v2 支持的 input 动作', async () => {
    const sample = JSON.parse(pages) as TutorialVersion;
    sample.steps[0].action = 'input';
    expect(await loadTutorial(JSON.stringify(sample), descriptionCapabilities))
      .toMatchObject({ ok: false, code: 'INVALID_TUTORIAL', issues: [{ path: '/steps/0/action' }] });
  });

  it.each([collaboration, pages])('接受设计样例，同时要求运行时注册实际适配器', async raw => {
    expect(await loadTutorial(raw, descriptionCapabilities)).toMatchObject({ ok: true });
    expect(await loadTutorial(raw, fixtureCapabilities)).toMatchObject({ ok: false, code: 'UNSUPPORTED_CAPABILITY' });
  });

  it('拒绝未知 Schema 版本', async () => {
    const raw = JSON.stringify({ ...fixture, schemaVersion: 3 });
    expect(await loadTutorial(raw, fixtureCapabilities)).toMatchObject({ ok: false, code: 'UNSUPPORTED_SCHEMA_VERSION' });
  });

  it('拒绝重复步骤和重复来源', async () => {
    expect(await loadTutorial(makeTutorialText({ steps: [fixture.steps[0], fixture.steps[0]] }), fixtureCapabilities))
      .toMatchObject({ ok: false, code: 'DUPLICATE_STEP_ID' });
    expect(await loadTutorial(makeTutorialText({ sources: [...fixture.sources, fixture.sources[0]] }), fixtureCapabilities))
      .toMatchObject({ ok: false, code: 'DUPLICATE_SOURCE_ID' });
  });

  it('拒绝未知字段、步骤来源与参数格式', async () => {
    const step = fixture.steps[0];
    expect(await loadTutorial(JSON.stringify({ ...fixture, other: true }), fixtureCapabilities))
      .toMatchObject({ ok: false, code: 'INVALID_TUTORIAL', issues: [{ path: '/other' }] });
    expect(await loadTutorial(makeTutorialText({ steps: [{ ...step, sourceIds: ['missing'] }] }), fixtureCapabilities))
      .toMatchObject({ ok: false, code: 'UNKNOWN_SOURCE' });
    expect(await loadTutorial(makeTutorialText({ parameterProfile: 'other' }), fixtureCapabilities))
      .toMatchObject({ ok: false, code: 'UNSUPPORTED_CAPABILITY' });
  });

  it('拒绝错误定位语法和未知定位器引用', async () => {
    const withTarget = (target: TutorialVersion['steps'][number]['target']) =>
      makeTutorialText({ steps: [{ ...fixture.steps[0], target }] });
    expect(await loadTutorial(withTarget({ css: '.thing[' }), fixtureCapabilities))
      .toMatchObject({ ok: false, code: 'INVALID_TUTORIAL' });
    expect(await loadTutorial(withTarget({ locatorId: 'fixture.unknown' }), fixtureCapabilities))
      .toMatchObject({ ok: false, code: 'UNSUPPORTED_CAPABILITY' });
  });

  it('使用原 JSON 的字节生成内容身份，空白变化也会生成新身份', async () => {
    const text = makeTutorialText();
    const first = await loadTutorial(text, fixtureCapabilities);
    expect(first).toMatchObject({
      ok: true,
      identity: { id: fixture.tutorialId, contentHash: createHash('sha256').update(text).digest('hex') },
    });
    const second = await loadTutorial(text + '\n', fixtureCapabilities);
    expect(second).toMatchObject({ ok: true, identity: { id: fixture.tutorialId } });
    if (!first.ok || !second.ok) throw new Error('教程应该加载成功');
    expect(second.identity.contentHash).not.toBe(first.identity.contentHash);
  });
});