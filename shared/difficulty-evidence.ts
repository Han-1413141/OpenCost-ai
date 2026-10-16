import research from './difficulty-research.json' with { type: 'json' };
import { workSubjectCatalogue } from './work-subjects.js';

export const difficultyResearch = research;
export const difficultyResearchPolicy = {
  version: research.version,
  endpoint: '/api/difficulty-research',
  counts: research.counts,
  sourceUse: 'project_authored_checklists_informed_by_sources; not_source_validated_scales',
  referencesArePublic: true,
  userDataReadForResearch: false,
  calibrationComplete: false,
  universalDifficultyScale: false,
  subjectCatalogueVersion: workSubjectCatalogue.version,
} as const;

export function researchForWorkType(workType: string, domain: string) {
  const task = research.coverage
    .find((d) => d.domain === domain)
    ?.types.find((t) => t.workType === workType);
  const taskIds = new Set(task?.taskReferenceIds ?? []);
  return {
    status: taskIds.size ? 'task_design_references_available' : 'domain_background_only',
    calibrated: false,
    taskSources: research.sources.filter((s) => taskIds.has(s.id)),
    domainSources: research.sources.filter(
      (s) => (s.domains as string[]).includes(domain) && !taskIds.has(s.id),
    ),
    difficultyValidation: 'not_established',
  };
}
