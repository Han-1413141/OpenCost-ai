import { z } from 'zod';
import { SubscriptionSnapshotSchema } from './subscriptions.js';
import { QuotaReplayInputSchema, quotaReplayLimits } from './quota-replay-schema.js';

export const quotaObservationImportLimits = {
  bytes: quotaReplayLimits.bytes,
  observations: 1024,
  sourceEvents: 8000,
  references: 16000,
  diagnostics: 100,
} as const;
const id = z.string().uuid(),
  at = z.string().datetime();
const evidence = z.enum(['source_declared', 'local_record', 'assumed', 'unknown']);
const state = z
  .object({
    observationId: id,
    stateAt: at,
    boundary: z.literal('after_automatic_before_external'),
    timeBasis: evidence,
  })
  .strict();
const sequence = z.number().int().min(0).max(1000000);

/** Local exchange only: raw observations and explicit mapping, never an upload envelope. */
export const QuotaObservationImportSchema = z
  .object({
    format: z.literal('quota-observation-import-1'),
    importRef: id,
    subscriptionRef: id,
    window: z.object({ startAt: at, endAt: at }).strict(),
    observations: z
      .array(SubscriptionSnapshotSchema)
      .min(1)
      .max(quotaObservationImportLimits.observations),
    mapping: z
      .object({
        scenario: QuotaReplayInputSchema,
        claims: z
          .object({
            requests: z.enum(['complete', 'partial', 'unknown']),
            requestIntervals: z.array(z.object({ from: at, through: at }).strict()).max(256),
            accountScope: z.enum(['all_shared_consumption', 'selected_harness_only', 'unknown']),
            requirements: z.enum(['complete', 'partial', 'unknown']),
            poolRules: evidence,
            sameTimeOrder: evidence,
            eligibility: evidence,
            cost: z.enum(['unknown', 'explicit_scenario']),
          })
          .strict(),
        pools: z
          .array(
            z
              .object({
                poolRef: id,
                opening: state,
                closing: state,
                ledgerMeaning: z.enum(['quota_units_by_event_kind', 'unknown']),
              })
              .strict(),
          )
          .min(1)
          .max(quotaReplayLimits.pools),
        requests: z
          .array(
            z
              .object({
                requestRef: id,
                arrivalAt: at,
                arrivalBasis: evidence,
                consumption: z.enum(['consumed', 'not_consumed', 'unknown']),
                chargedAt: at.nullable(),
                chargeSequence: sequence.nullable(),
                charges: z.array(z.object({ poolRef: id, sourceEventRef: id }).strict()).max(32),
              })
              .strict(),
          )
          .max(quotaReplayLimits.requests),
        events: z
          .array(z.object({ eventRef: id, sourceEventRef: id, poolRef: id }).strict())
          .max(quotaReplayLimits.events),
        expirations: z
          .array(z.object({ poolRef: id, sourceEventRef: id, lotRef: id }).strict())
          .max(4000),
        recoveries: z
          .array(z.object({ poolRef: id, sourceEventRef: id, debitRef: id }).strict())
          .max(4000),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type QuotaObservationImport = z.infer<typeof QuotaObservationImportSchema>;
