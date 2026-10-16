/** Missing payment or refund observations never mean a zero bill. */
export function netPayment(period: { paidMinor: number | null; refundMinor: number | null }): number | null {
  return period.paidMinor === null || period.refundMinor === null
    ? null
    : period.paidMinor - period.refundMinor;
}
