/**
 * Stripe requires amounts as integers in the smallest currency unit
 * (cents for EUR), never floats. Naive float math (e.g. amount * 100)
 * can produce values like 1839.9999999999998 due to floating-point
 * imprecision, which Stripe will reject or misinterpret.
 */
function eurosToStripeCents(amountInEuros) {
  return Math.round(amountInEuros * 100);
}

export { eurosToStripeCents };
