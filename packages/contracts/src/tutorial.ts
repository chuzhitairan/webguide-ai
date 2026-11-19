import { parse } from 'css-what';
import v1Validator from './generated/tutorial-v1-validator.js';
import v2Validator from './generated/tutorial-v2-validator.js';
import type { AdapterCapabilities, Capabilities, TargetSpec, TutorialIdentity, TutorialVersion } from './types.js';

interface Issue { path: string; message: string }
type Failure = {
  ok: false;
  code: 'INVALID_JSON' | 'INVALID_TUTORIAL' | 'UNSUPPORTED_SCHEMA_VERSION' | 'UNSUPPORTED_CAPABILITY'
    | 'DUPLICATE_STEP_ID' | 'DUPLICATE_SOURCE_ID' | 'UNKNOWN_SOURCE';
  issues: Issue[];
};
export type TutorialLoadResult = { ok: true; tutorial: TutorialVersion; identity: TutorialIdentity } | Failure;

type SchemaError = Issue & { instancePath: string; keyword: string; params: Record<string, unknown> };
type Validator = ((value: unknown) => boolean) & { errors: SchemaError[] | null };

function failure(code: Failure['code'], path: string, message: string): Failure {
  return { ok: false, code, issues: [{ path, message }] };
}

function schemaIssues(validator: Validator): Issue[] {
  return (validator.errors ?? []).map(error => {
    const property = error.params.additionalProperty ?? error.params.missingProperty;
    const suffix = typeof property === 'string' ? '/' + property.replaceAll('~', '~0').replaceAll('/', '~1') : '';
    return { path: error.instancePath + suffix || '/', message: error.message };
  });
}

function checkTarget(target: TargetSpec, path: string, adapter: AdapterCapabilities): Failure | undefined {
  if ('locatorId' in target) {
    if (!adapter.locatorIds.includes(target.locatorId)) {
      return failure('UNSUPPORTED_CAPABILITY', path + '/locatorId', '未注册的页面定位器');
    }
    return;
  }
  try {
    if (parse(target.css).length > 0) return;
  } catch {
    // 把解析错误放回教程中的字段位置，便于作者找到要改的选择器。
  }
  return failure('INVALID_TUTORIAL', path + '/css', '无效的 CSS 选择器');
}

function checkReferences(tutorial: TutorialVersion, capabilities: Capabilities): Failure | undefined {
  const adapter = Object.hasOwn(capabilities.adapters, tutorial.adapterId)
    ? capabilities.adapters[tutorial.adapterId] : undefined;
  if (!adapter) return failure('UNSUPPORTED_CAPABILITY', '/adapterId', '未注册的适配器');
  if (!adapter.parameterProfiles.includes(tutorial.parameterProfile)) {
    return failure('UNSUPPORTED_CAPABILITY', '/parameterProfile', '适配器未声明此参数格式');
  }
  if (!adapter.finalVerifierIds.includes(tutorial.finalVerifierId)) {
    return failure('UNSUPPORTED_CAPABILITY', '/finalVerifierId', '未注册的最终校验器');
  }

  const sourceIds = new Set<string>();
  for (const [index, source] of tutorial.sources.entries()) {
    if (sourceIds.has(source.id)) return failure('DUPLICATE_SOURCE_ID', '/sources/' + index + '/id', '来源编号必须唯一');
    sourceIds.add(source.id);
  }
  const stepIds = new Set<string>();
  for (const [index, step] of tutorial.steps.entries()) {
    const path = '/steps/' + index;
    if (stepIds.has(step.id)) return failure('DUPLICATE_STEP_ID', path + '/id', '步骤编号必须唯一');
    stepIds.add(step.id);
    if (!adapter.roles.includes(step.pageRole)) {
      return failure('UNSUPPORTED_CAPABILITY', path + '/pageRole', '适配器未声明此页面角色');
    }
    const sourceIndex = step.sourceIds.findIndex(id => !sourceIds.has(id));
    if (sourceIndex !== -1) return failure('UNKNOWN_SOURCE', path + '/sourceIds/' + sourceIndex, '来源编号不存在');
    const badTarget = checkTarget(step.target, path + '/target', adapter);
    if (badTarget) return badTarget;
    if (step.check.type === 'adapter' && !Object.hasOwn(adapter.checkers, step.check.checkerId)) {
      return failure('UNSUPPORTED_CAPABILITY', path + '/check/checkerId', '未注册的步骤校验器');
    }
    if (step.check.type === 'dom' && step.check.target) {
      const badCheckTarget = checkTarget(step.check.target, path + '/check/target', adapter);
      if (badCheckTarget) return badCheckTarget;
    }
  }
}

export async function loadTutorial(jsonText: string, capabilities: Capabilities): Promise<TutorialLoadResult> {
  let value: unknown;
  try {
    value = JSON.parse(jsonText);
  } catch {
    return failure('INVALID_JSON', '/', '无法读取 JSON');
  }
  if (!value || typeof value !== 'object' || !('schemaVersion' in value)) {
    return failure('INVALID_TUTORIAL', '/schemaVersion', '教程需要格式版本');
  }
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    return failure('UNSUPPORTED_SCHEMA_VERSION', '/schemaVersion', '当前支持第 1、2 版教程格式');
  }
  const validate = (value.schemaVersion === 1 ? v1Validator : v2Validator) as unknown as Validator;
  if (!validate(value)) return { ok: false, code: 'INVALID_TUTORIAL', issues: schemaIssues(validate) };
  const tutorial = value as TutorialVersion;
  const badReference = checkReferences(tutorial, capabilities);
  if (badReference) return badReference;

  // 用原始文件算身份，重新排版或更换说明也会生成新的内容版本。
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jsonText));
  const contentHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { ok: true, tutorial, identity: { id: tutorial.tutorialId, version: tutorial.version, contentHash } };
}