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

export function experienceForSite(catalog: ExperienceCatalog | undefined, hostname: string): ExperienceEntry[] {
  // 只给模型当前站点的线索，具体适用性由目标和页面证据决定。
  return catalog?.entries.filter(entry => entry.hostname === hostname && entry.status !== 'disabled').slice(0, 5) ?? [];
}
