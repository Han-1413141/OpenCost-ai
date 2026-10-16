/** Public intake contract, independent of pricing and analysis implementation. */
export const uploadProtocol = {
  format: 'opencost-upload-capabilities-1',
  protocolRevision: '2026-10-17.1',
  authentication: { header: 'Authorization', scheme: 'Bearer' },
  idempotencyHeader: 'Idempotency-Key',
  maxRequestBytes: 512 * 1024,
  contribution: {
    schemaVersion: '1.1',
    schema: '/api/schema',
    preview: '/api/contributions/preview',
    submit: '/api/contributions',
    unknownBilling: true,
    nullableAmounts: true,
  },
  journal: {
    format: 'opencost-daily-summary-1',
    schema: '/api/work-summaries/schema',
    preview: '/api/work-summaries/preview',
    submit: '/api/work-summaries',
    adapterRequired: false,
  },
  subscription: {
    format: 'opencost-subscriptions-1',
    preview: '/api/subscriptions/preview',
    submit: '/api/subscriptions',
  },
  confirmation: 'preview_then_confirm',
} as const;
