/** Округление денег до копеек, чтобы 0.1 + 0.2 не всплывали в Firestore. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
