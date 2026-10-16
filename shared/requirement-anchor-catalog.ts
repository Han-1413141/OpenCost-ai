// Compact closed vocabulary; checked against difficultyFramework by tests.
export const REQUIREMENT_FRAMEWORK_VERSION = 'domain-difficulty-draft-2' as const;
export const requirementAnchorCatalog = {
  software: ['behavior', 'diagnosis', 'invariants', 'compatibility'],
  data: ['structure', 'identification', 'validity', 'semantics'],
  ai: ['objective', 'generalization', 'system', 'evaluation'],
  mathematics: ['formulation', 'structure', 'proof', 'numerics'],
  research: ['evidence', 'inference', 'design', 'reproducibility'],
  engineering: ['physics', 'conditions', 'integration', 'validation'],
  writing: ['structure', 'fidelity', 'expression', 'construction'],
  translation: ['meaning', 'terminology', 'localization', 'format'],
  design: ['composition', 'interaction', 'consistency', 'verification'],
  media: ['temporal', 'modal', 'construction', 'delivery'],
  office: ['structure', 'calculation', 'workflow', 'fidelity'],
  business: ['decision', 'evidence', 'coordination', 'exception'],
  education: ['knowledge', 'diagnosis', 'adaptation', 'assessment'],
  legal: ['applicability', 'relations', 'evidence', 'review'],
  health: ['evidence', 'scope', 'reasoning', 'review'],
  finance: ['relations', 'model', 'basis', 'verification'],
} as const;
