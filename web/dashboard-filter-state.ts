import type { WorkDomain } from '../shared/schema';

export type DashboardFilters = { domain: WorkDomain };
export const defaultFilters: DashboardFilters = { domain: 'software' };
