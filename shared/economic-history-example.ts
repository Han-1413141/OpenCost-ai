import type { LocalEconomicHistory } from './economic-history-schema.js';

/** Explicit method example only. No local accounts, identity or historical records are read. */
export function economicHistoryExample(): LocalEconomicHistory {
  const taskId = '10000000-0000-4000-8000-000000000001';
  const charge = '20000000-0000-4000-8000-000000000001';
  const refund = '20000000-0000-4000-8000-000000000002';
  const empty = { coverage: 'unknown' as const, portions: [] };
  return {
    version: 'opencost-local-economic-history-1',
    dataUse: 'method_example',
    coverage: { cashWindow: 'complete', allocationHistory: 'complete' },
    currencies: ['CNY'],
    window: {
      from: '2026-10-14T00:00:00.000Z',
      to: '2026-10-17T00:00:00.000Z',
      recordedAtOrBefore: '2026-10-17T00:00:00.000Z',
    },
    observations: [
      {
        id: '30000000-0000-4000-8000-000000000001',
        eventRef: charge,
        revision: 0,
        parentId: null,
        recordedAt: '2026-09-29T01:00:00.000Z',
        kind: 'charge',
        currency: 'CNY',
        amountMinor: 10000,
        status: 'settled',
        occurredAt: '2026-09-29T00:00:00.000Z',
        refundOf: null,
        source: 'manual_report',
        allocation: {
          coverage: 'complete',
          portions: [
            {
              taskId,
              requirementRef: '40000000-0000-4000-8000-000000000001',
              workMonth: '2026-09',
              amountMinor: 6000,
            },
            {
              taskId,
              requirementRef: '40000000-0000-4000-8000-000000000002',
              workMonth: '2026-10',
              amountMinor: 4000,
            },
          ],
        },
      },
      {
        id: '30000000-0000-4000-8000-000000000002',
        eventRef: refund,
        revision: 0,
        parentId: null,
        recordedAt: '2026-10-13T10:00:00.000Z',
        kind: 'refund',
        currency: 'CNY',
        amountMinor: 3000,
        status: 'pending',
        occurredAt: null,
        refundOf: charge,
        source: 'manual_report',
        allocation: empty,
      },
      {
        id: '30000000-0000-4000-8000-000000000003',
        eventRef: refund,
        revision: 1,
        parentId: '30000000-0000-4000-8000-000000000002',
        recordedAt: '2026-10-14T11:00:00.000Z',
        kind: 'refund',
        currency: 'CNY',
        amountMinor: 3000,
        status: 'settled',
        occurredAt: '2026-10-14T10:00:00.000Z',
        refundOf: charge,
        source: 'manual_report',
        allocation: empty,
      },
      {
        id: '30000000-0000-4000-8000-000000000004',
        eventRef: '20000000-0000-4000-8000-000000000003',
        revision: 0,
        parentId: null,
        recordedAt: '2026-10-14T12:00:00.000Z',
        kind: 'credit_grant',
        currency: 'CNY',
        amountMinor: 2000,
        status: 'settled',
        occurredAt: '2026-10-14T12:00:00.000Z',
        refundOf: null,
        source: 'manual_report',
        allocation: empty,
      },
    ],
  };
}
