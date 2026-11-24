import { readFileSync } from 'node:fs';

export interface ExperienceEntry {
  id: string;
  revision: number;
  hostname: string;
  status: 'candidate' | 'available' | 'disabled';
  goal: string;
  when: string;
  advice: string;
  check: string;
  source: string;
}

export interface ExperienceCatalog {
  version: string;
  entries: ExperienceEntry[];
}

function isEntry(value: unknown): value is ExperienceEntry {
  if (!value || typeof value !== 'object') return false;
  const { id, revision, hostname, status, goal, when, advice, check, source } = value as Partial<ExperienceEntry>;
  return [id, hostname, goal, when, advice, check, source].every(text => typeof text === 'string' && text.trim().length > 0)
    && typeof revision === 'number' && Number.isInteger(revision) && revision > 0
    && (status === 'candidate' || status === 'available' || status === 'disabled');
}

export function loadExperienceCatalog(file = new URL('../experience-catalog.json', import.meta.url)): ExperienceCatalog {
  const data = JSON.parse(readFileSync(file, 'utf8')) as (Partial<ExperienceCatalog> & { formatVersion?: number }) | null;
  if (data?.formatVersion !== 1 || typeof data.version !== 'string' || !data.version.trim()
    || !Array.isArray(data.entries) || !data.entries.every(isEntry)) {
    throw new Error('经验目录格式不正确。');
  }
  return { version: data.version, entries: data.entries };
}

export function experienceForSite(catalog: ExperienceCatalog | undefined, hostname: string): ExperienceEntry[] {
  // 扩展传入当前文档的主机名。只取这个站点的线索，由模型判断是否适用于当前目标。
  return catalog?.entries.filter(entry => entry.hostname === hostname && entry.status !== 'disabled').slice(0, 5) ?? [];
}
