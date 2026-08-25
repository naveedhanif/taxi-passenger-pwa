/**
 * Turns a phone number as entered by a driver/passenger (which may
 * include spaces, dashes, parens) into the two link formats needed:
 *   - tel: needs the raw digits with a leading + kept
 *   - wa.me needs digits only, no +, no other punctuation
 *
 * Returns null for empty/invalid input so callers can hide the buttons
 * entirely rather than render a broken link.
 */
export function formatPhoneForLinks(rawPhone) {
  if (!rawPhone) return null;
  const trimmed = rawPhone.trim();
  if (!trimmed) return null;

  const hasLeadingPlus = trimmed.startsWith("+");
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (!digitsOnly) return null;

  return {
    tel: hasLeadingPlus ? `+${digitsOnly}` : digitsOnly,
    whatsapp: digitsOnly, // wa.me never includes the + sign
  };
}
