import {
  validateStorageBudgetOptions,
  type StorageBudgetOptions,
} from '../shared/sqlite-storage-budget.js';

/** Keep deployment limits outside the monitor configuration and its consent digest. */
export function readMonitorStorageOptions(
  env: NodeJS.ProcessEnv = process.env,
): Required<StorageBudgetOptions> {
  const options: StorageBudgetOptions = {};
  for (const [name, field, allowZero] of [
    ['OPENCOST_MONITOR_MAX_BYTES', 'maxBytes', false],
    ['OPENCOST_MONITOR_RESERVE_BYTES', 'reserveBytes', true],
    ['OPENCOST_MONITOR_WAL_MAX_BYTES', 'walMaxBytes', false],
    ['OPENCOST_MONITOR_DISK_RESERVE_BYTES', 'diskReserveBytes', true],
  ] as const) {
    const raw = env[name];
    if (raw === undefined) continue;
    if (!(allowZero ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/).test(raw))
      throw new Error(`${name} 必须是${allowZero ? '非负' : '正'}安全整数，或不设置以使用默认预算`);
    options[field] = Number(raw);
  }
  return validateStorageBudgetOptions(options);
}
