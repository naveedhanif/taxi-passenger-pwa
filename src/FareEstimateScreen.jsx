import { useEffect, useState } from "react";
import { MapPin, Clock, ArrowLeft, Info, Route as RouteIcon, ArrowRight, Loader2, AlertCircle, CreditCard, Banknote, Tag, Check, X } from "lucide-react";
import { getRouteMultiStop } from "./mapboxClient";
import { getTariffPeriod, calculateFare, selectFareRule } from "./fareCalculator";
import { lookupPromoCode } from "./promoApi.js";
import LiveMapView from "./LiveMapView";

function useGoogleFont() {
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
}

const TARIFF_LABEL = {
  standard: { label: "Standard rate", bg: "var(--success-bg)", text: "var(--success-text)" },
  premium: { label: "Premium rate", bg: "var(--warning-bg)", text: "var(--warning-text)" },
  special: { label: "Special rate", bg: "var(--error-bg)", text: "var(--error-text)" },
};

/**
 * @param {object} props
 * @param {string} props.mapboxToken
 * @param {{lat:number,lng:number,address:string}} props.pickup
 * @param {{lat:number,lng:number,address:string}} props.dropoff
 * @param {{lat:number,lng:number,address:string}[]} [props.stops] - intermediate stops, in order
 * @param {Date} props.scheduledTime
 * @param {Array} props.fareRules - driver's fare_rules rows
 * @param {number} props.preBookingFee - driver's pre_booking_fee
 * @param {number} props.payLaterDepositAmount - driver's minimum pay-later deposit
 * @param {{id:string, code:string, discountType:'percent'|'fixed', discountValue:number}|null} [props.promo] - from get-active-promo; display-only, re-validated server-side
 * @param {function} props.onConfirm - called with the final fare breakdown + payment choice when the driver taps confirm
 * @param {function} props.onBack
 */
export default function FareEstimateScreen({
  driverId,
  customerSessionToken,
  mapboxToken,
  pickup,
  dropoff,
  stops = [],
  scheduledTime,
  fareRules,
  preBookingFee,
  payLaterDepositAmount,
  depositEnabled = true,
  promo = null,
  onConfirm,
  onBack,
}) {
  useGoogleFont();
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [route, setRoute] = useState(null);
  const [fare, setFare] = useState(null);
  const [tariffPeriod, setTariffPeriod] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  // A code the passenger typed/pasted in themselves — takes priority
  // over the automatically-detected `promo` prop when present, since
  // it's an explicit choice. Cleared back to auto-detection if they
  // remove it.
  const [manualCode, setManualCode] = useState("");
  const [manualPromo, setManualPromo] = useState(null);
  const [manualStatus, setManualStatus] = useState("idle"); // idle | checking | error
  const [manualError, setManualError] = useState("");
  const effectivePromo = manualPromo || promo;
  // Fixed-amount promos were previously always labeled "X% off"
  // regardless of their real type — same root bug as the discount
  // math above, just in the display text.
  function formatDiscount(p) {
    return p.discountType === "percent" ? `${p.discountValue}% off` : `€${Number(p.discountValue).toFixed(2)} off`;
  }

  async function handleApplyCode() {
    if (!manualCode.trim()) return;
    setManualStatus("checking");
    setManualError("");
    const result = await lookupPromoCode({ driverId, code: manualCode.trim(), customerSessionToken });
    if (result.error) {
      setManualStatus("error");
      setManualError(result.error);
      setManualPromo(null);
      return;
    }
    setManualStatus("idle");
    setManualPromo(result.promo);
  }

  function handleClearManualCode() {
    setManualCode("");
    setManualPromo(null);
    setManualStatus("idle");
    setManualError("");
  }
  // "now": full fare charged upfront. "later": only the deposit is
  // charged now; the rest is settled with the driver in the taxi.
  const [paymentTiming, setPaymentTiming] = useState("now");

  useEffect(() => {
    let cancelled = false;

    async function loadEstimate() {
      setStatus("loading");
      try {
        // Stops (if any) are inserted between pickup and dropoff — the
        // fare math itself (calculateFare below) doesn't need to know
        // about them at all, since Mapbox already returns the TOTAL
        // distance/duration across every leg in one request.
        const routeResult = await getRouteMultiStop([pickup, ...stops, dropoff], mapboxToken);
        if (!routeResult) {
          throw new Error("No route found for this trip");
        }

        const period = getTariffPeriod(scheduledTime);
        const rule = selectFareRule(fareRules, period);
        if (!rule) {
          throw new Error("This driver hasn't set up pricing yet");
        }

        const fareResult = calculateFare({
          distanceKm: routeResult.distanceKm,
          durationMinutes: routeResult.durationMinutes,
          fareRule: rule,
          preBookingFee,
        });

        if (!cancelled) {
          setRoute(routeResult);
          setTariffPeriod(period);
          setFare(fareResult);
          setStatus("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err.message || "Couldn't calculate a fare estimate");
          setStatus("error");
        }
      }
    }

    loadEstimate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup, dropoff, JSON.stringify(stops), scheduledTime, fareRules, preBookingFee, mapboxToken]);

  // Display-only preview — create-booking is the real authority. A
  // promo code REPLACES the standing per-tariff discount rather than
  // stacking with it, so when one applies we show only the promo line
  // and compute it off the pre-any-discount amount, not fare.total
  // (which already has the standing discount baked in).
  const fareBeforeAnyDiscount = fare ? Math.round((fare.total + fare.discountAmount) * 100) / 100 : 0;
  // FIXED BUG: this used to always divide discountValue by 100 as if
  // every promo were a percentage — a "fixed" euro-amount promo was
  // silently shown with a far-too-small discount here too, matching
  // the same bug that existed server-side in create-booking.
  const promoDiscountAmount =
    fare && effectivePromo
      ? Math.round(
          Math.min(
            effectivePromo.discountType === "percent"
              ? fareBeforeAnyDiscount * (effectivePromo.discountValue / 100)
              : effectivePromo.discountValue,
            fareBeforeAnyDiscount
          ) * 100
        ) / 100
      : 0;
  const displayTotal = fare ? (effectivePromo ? Math.round((fareBeforeAnyDiscount - promoDiscountAmount) * 100) / 100 : fare.total) : 0;

  return (
    <div
      className="mx-auto w-full max-w-[430px] p-5 pb-28"
      style={{ backgroundColor: "var(--bg-page)", fontFamily: "Inter", minHeight: 640 }}
    >
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-btn)" }}
          aria-label="Back"
        >
          <ArrowLeft size={17} color="var(--text-primary)" />
        </button>
        <div className="text-base font-bold text-[var(--text-primary)]" style={{ fontFamily: "'Space Grotesk'" }}>Trip details</div>
        <div className="w-11" />
      </div>

      {status === "loading" && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-[var(--text-secondary)]">
          <Loader2 size={22} className="animate-spin" color="var(--accent)" />
          Calculating your fare…
        </div>
      )}

      {status === "error" && (
        <div
          className="flex flex-col items-center gap-3 rounded-2xl p-6 text-center text-sm"
          style={{ background: "var(--error-bg)", color: "var(--error-text)" }}
        >
          <AlertCircle size={22} />
          {errorMessage}
        </div>
      )}

      {status === "ready" && (
        <>
          <div
            className="mb-4 overflow-hidden rounded-2xl"
            style={{ border: "1px solid var(--border-card)", boxShadow: "var(--shadow-raised)" }}
          >
            <LiveMapView
              token={mapboxToken}
              pickup={pickup}
              dropoff={dropoff}
              routeGeometry={route.routeGeometry}
            />
          </div>

          {/* Route card: pickup → stops → destination, like the reference "Trip details" */}
          <div className="mb-4 rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-raised)" }}>
            <div className="relative space-y-4 pl-7">
              <span className="absolute left-[5px] top-3 bottom-3 border-l-2 border-dashed" style={{ borderColor: "var(--border-input)" }} />
              <div className="relative">
                <span className="absolute -left-7 top-1 h-3 w-3 rounded-full" style={{ background: "#2E9E5B", boxShadow: "0 0 0 4px rgba(46,158,91,0.18)" }} />
                <div className="text-[11px] text-[var(--text-muted)]">Pickup location</div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">{pickup.address}</div>
              </div>
              {stops.map((s, i) => (
                <div key={i} className="relative">
                  <span className="absolute -left-7 top-1 h-3 w-3 rounded-full" style={{ background: "var(--bg-card)", border: "3px solid var(--text-primary)" }} />
                  <div className="text-[11px] text-[var(--text-muted)]">Stop {i + 1}</div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">{s.address}</div>
                </div>
              ))}
              <div className="relative">
                <span className="absolute -left-7 top-1 h-3 w-3 rounded-full" style={{ background: "var(--brand)", boxShadow: "0 0 0 4px rgba(255,196,0,0.25)" }} />
                <div className="text-[11px] text-[var(--text-muted)]">Destination</div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">{dropoff.address}</div>
              </div>
            </div>
          </div>

          {/* Estimated fare hero */}
          <div className="mb-4 rounded-2xl p-5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-raised)" }}>
            <div className="text-xs font-medium text-[var(--text-secondary)]">Estimated fare</div>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-4xl font-bold text-[var(--text-primary)]" style={{ fontFamily: "'Space Grotesk'" }}>€{displayTotal.toFixed(2)}</span>
              <span className="pb-1.5 text-xs text-[var(--text-muted)]">(approx.)</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)]" style={{ background: "var(--bg-card-alt)" }}>
                <RouteIcon size={12} /> {route.distanceKm} km
              </span>
              <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)]" style={{ background: "var(--bg-card-alt)" }}>
                <Clock size={12} /> ~{Math.round(route.durationMinutes)} min
              </span>
              <span
                className="rounded-full px-3 py-1 text-[11px] font-medium"
                style={{ background: TARIFF_LABEL[tariffPeriod].bg, color: TARIFF_LABEL[tariffPeriod].text }}
              >
                {TARIFF_LABEL[tariffPeriod].label}
              </span>
            </div>
          </div>

          {/* Manual promo code entry — an auto-detected code (if any)
              already applies without this; this is only for a code the
              passenger has to hand explicitly and wants to use instead. */}
          <div
            className="mb-4 rounded-2xl p-4"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-raised)" }}
          >
            {manualPromo ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--success-text)" }}>
                  <Tag size={13} />
                  {manualPromo.code} applied — {formatDiscount(manualPromo)}
                </div>
                <button onClick={handleClearManualCode} className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: "var(--bg-card-alt)" }}>
                  <X size={11} color="var(--text-secondary)" />
                </button>
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
                  <Tag size={13} /> Have a promo code?
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter code"
                    value={manualCode}
                    onChange={(e) => {
                      setManualCode(e.target.value.toUpperCase());
                      if (manualStatus === "error") {
                        setManualStatus("idle");
                        setManualError("");
                      }
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleApplyCode()}
                    className="min-w-0 flex-1 rounded-lg px-3 py-2 text-xs font-semibold uppercase text-[var(--text-primary)]"
                    style={{ background: "var(--bg-input)", border: "1px solid var(--border-card)" }}
                  />
                  <button
                    onClick={handleApplyCode}
                    disabled={manualStatus === "checking" || !manualCode.trim()}
                    className="flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background: "var(--accent-gradient)" }}
                  >
                    {manualStatus === "checking" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    Apply
                  </button>
                </div>
                {manualStatus === "error" && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--error-text)" }}>
                    <AlertCircle size={11} /> {manualError}
                  </div>
                )}
                {promo && !manualCode && (
                  <div className="mt-2 text-[11px] text-[var(--text-muted)]">
                    You already have {promo.code} ({formatDiscount(promo)}) applied automatically — entering a code here will use that one instead.
                  </div>
                )}
              </>
            )}
          </div>

          <details
            className="mb-4 rounded-2xl p-4"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-raised)" }}
          >
            <summary className="cursor-pointer text-sm font-semibold text-[var(--text-primary)]">Fare breakdown</summary>
            <div className="mt-3 space-y-2 text-sm text-[var(--text-primary)]">
              <div className="flex justify-between"><span>Base fare</span><span>€{fare.baseFare.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Distance ({route.distanceKm} km)</span><span>€{fare.distanceCost.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Time ({Math.round(route.durationMinutes)} min)</span><span>€{fare.timeCost.toFixed(2)}</span></div>
              {!effectivePromo && fare.discountPercent > 0 && (
                <div className="flex justify-between" style={{ color: "var(--success-text)" }}>
                  <span>Discount ({fare.discountPercent}%)</span>
                  <span>−€{fare.discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between"><span>Pre-booking fee</span><span>€{fare.preBookingFee.toFixed(2)}</span></div>
              {effectivePromo && promoDiscountAmount > 0 && (
                <div className="flex justify-between" style={{ color: "var(--success-text)" }}>
                  <span>Promo {effectivePromo.code} ({formatDiscount(effectivePromo)} — replaces your standard discount)</span>
                  <span>−€{promoDiscountAmount.toFixed(2)}</span>
                </div>
              )}
            </div>
            {fare.minimumFareApplied && (
              <div className="mt-2 text-[11px] text-[var(--text-muted)]">Minimum fare applied for this trip</div>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-[var(--border-card)] pt-3">
              <span className="text-sm font-medium text-[var(--text-primary)]">Total</span>
              <span className="text-lg font-semibold text-[var(--text-primary)]">€{displayTotal.toFixed(2)}</span>
            </div>
          </details>

          {/* Pay now vs pay later */}
          <div
            className="mb-4 rounded-2xl p-4"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-raised)" }}
          >
            <div className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Payment method</div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setPaymentTiming("now")}
                className="flex flex-col items-start gap-1.5 rounded-lg p-3 text-left transition-all"
                style={{
                  background: paymentTiming === "now" ? "var(--info-bg)" : "var(--bg-input)",
                  border: paymentTiming === "now" ? "1.5px solid var(--accent)" : "1px solid var(--border-card)",
                }}
              >
                <CreditCard size={16} color={paymentTiming === "now" ? "var(--accent)" : "var(--text-secondary)"} />
                <span className="text-xs font-semibold text-[var(--text-primary)]">Pay now</span>
                <span className="text-[11px] text-[var(--text-secondary)]">Full fare charged by card, right now</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentTiming("later")}
                className="flex flex-col items-start gap-1.5 rounded-lg p-3 text-left transition-all"
                style={{
                  background: paymentTiming === "later" ? "var(--info-bg)" : "var(--bg-input)",
                  border: paymentTiming === "later" ? "1.5px solid var(--accent)" : "1px solid var(--border-card)",
                }}
              >
                <Banknote size={16} color={paymentTiming === "later" ? "var(--accent)" : "var(--text-secondary)"} />
                <span className="text-xs font-semibold text-[var(--text-primary)]">Pay in the taxi</span>
                <span className="text-[11px] text-[var(--text-secondary)]">{depositEnabled ? "Cash or card after the ride" : "No deposit — pay after the ride"}</span>
              </button>
            </div>

            {paymentTiming === "later" && depositEnabled && (
              <div className="mt-3 rounded-lg p-3 text-[11px] leading-relaxed" style={{ background: "var(--warning-bg)", color: "var(--warning-text)" }}>
                A €{payLaterDepositAmount.toFixed(2)} deposit is charged now to secure your booking. It's
                subtracted from the fare — you'll owe €{Math.max(displayTotal - payLaterDepositAmount, 0).toFixed(2)} more,
                payable to the driver by cash or card once the trip is complete.
              </div>
            )}
            {paymentTiming === "later" && !depositEnabled && (
              <div className="mt-3 rounded-lg p-3 text-[11px] leading-relaxed" style={{ background: "var(--success-bg)", color: "var(--success-text)" }}>
                No deposit required — nothing is charged now. You'll pay the full fare of €{displayTotal.toFixed(2)} directly to
                your driver by cash or card once the trip is complete.
              </div>
            )}
          </div>

          <button
            onClick={() =>
              onConfirm({
                route,
                fare,
                tariffPeriod,
                paymentTiming,
                depositAmount: paymentTiming === "later" && depositEnabled ? payLaterDepositAmount : 0,
                promoCodeId: effectivePromo?.id ?? null,
              })
            }
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold text-white"
            style={{
              background: "var(--accent-gradient)",
              boxShadow: "var(--shadow-accent-btn)",
            }}
          >
            {paymentTiming === "now"
              ? `Confirm & pay €${displayTotal.toFixed(2)}`
              : depositEnabled
              ? `Confirm & pay deposit €${payLaterDepositAmount.toFixed(2)}`
              : "Confirm booking"}
            <ArrowRight size={15} />
          </button>

          <div className="mt-4 flex items-start gap-2.5 rounded-2xl p-3.5 text-[11px] leading-relaxed" style={{ background: "var(--info-bg)", color: "var(--info-text)" }}>
            <Info size={15} className="mt-0.5 shrink-0" />
            Fares reflect current traffic conditions and may differ slightly from the final metered amount.
          </div>
        </>
      )}
    </div>
  );
}

