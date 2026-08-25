import { useEffect, useState } from "react";
import { MapPin, Clock, Route as RouteIcon, ArrowRight, Loader2, AlertCircle, CreditCard, Banknote } from "lucide-react";
import { getRoute } from "./mapboxClient";
import { getTariffPeriod, calculateFare, selectFareRule } from "./fareCalculator";
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
  standard: { label: "Standard rate", bg: "#EAF3DE", text: "#27500A" },
  premium: { label: "Premium rate", bg: "#FAEEDA", text: "#633806" },
  special: { label: "Special rate", bg: "#FCEBEB", text: "#791F1F" },
};

/**
 * @param {object} props
 * @param {string} props.mapboxToken
 * @param {{lat:number,lng:number,address:string}} props.pickup
 * @param {{lat:number,lng:number,address:string}} props.dropoff
 * @param {Date} props.scheduledTime
 * @param {Array} props.fareRules - driver's fare_rules rows
 * @param {number} props.preBookingFee - driver's pre_booking_fee
 * @param {number} props.payLaterDepositAmount - driver's minimum pay-later deposit
 * @param {function} props.onConfirm - called with the final fare breakdown + payment choice when the driver taps confirm
 * @param {function} props.onBack
 */
export default function FareEstimateScreen({
  mapboxToken,
  pickup,
  dropoff,
  scheduledTime,
  fareRules,
  preBookingFee,
  payLaterDepositAmount,
  onConfirm,
  onBack,
}) {
  useGoogleFont();
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [route, setRoute] = useState(null);
  const [fare, setFare] = useState(null);
  const [tariffPeriod, setTariffPeriod] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  // "now": full fare charged upfront. "later": only the deposit is
  // charged now; the rest is settled with the driver in the taxi.
  const [paymentTiming, setPaymentTiming] = useState("now");

  useEffect(() => {
    let cancelled = false;

    async function loadEstimate() {
      setStatus("loading");
      try {
        const routeResult = await getRoute(pickup, dropoff, mapboxToken);
        if (!routeResult) {
          throw new Error("No route found between these two locations");
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
  }, [pickup, dropoff, scheduledTime, fareRules, preBookingFee, mapboxToken]);

  return (
    <div
      className="mx-auto w-full max-w-[400px] p-5"
      style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter", minHeight: 640 }}
    >
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
        >
          <ArrowRight size={15} color="#5F5E5A" style={{ transform: "rotate(180deg)" }} />
        </button>
        <div className="text-sm font-semibold text-[#2C2C2A]">Fare estimate</div>
        <div className="w-9" />
      </div>

      {status === "loading" && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-[#5F5E5A]">
          <Loader2 size={22} className="animate-spin" color="#185FA5" />
          Calculating your fare…
        </div>
      )}

      {status === "error" && (
        <div
          className="flex flex-col items-center gap-3 rounded-xl p-6 text-center text-sm"
          style={{ background: "#FCEBEB", color: "#791F1F" }}
        >
          <AlertCircle size={22} />
          {errorMessage}
        </div>
      )}

      {status === "ready" && (
        <>
          <div
            className="mb-4 overflow-hidden rounded-xl"
            style={{ border: "1px solid #ECE9E0", boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" }}
          >
            <LiveMapView
              token={mapboxToken}
              pickup={pickup}
              dropoff={dropoff}
              routeGeometry={route.routeGeometry}
            />
          </div>

          <div
            className="mb-4 flex items-center justify-between rounded-xl px-4 py-3"
            style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" }}
          >
            <div className="flex items-center gap-1.5 text-xs text-[#5F5E5A]">
              <RouteIcon size={13} /> {route.distanceKm} km
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[#5F5E5A]">
              <Clock size={13} /> ~{Math.round(route.durationMinutes)} min
            </div>
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{ background: TARIFF_LABEL[tariffPeriod].bg, color: TARIFF_LABEL[tariffPeriod].text }}
            >
              {TARIFF_LABEL[tariffPeriod].label}
            </span>
          </div>

          <div
            className="mb-4 rounded-xl p-4"
            style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" }}
          >
            <div className="mb-3 text-xs font-medium text-[#5F5E5A]">Fare breakdown</div>
            <div className="space-y-2 text-sm text-[#2C2C2A]">
              <div className="flex justify-between"><span>Base fare</span><span>€{fare.baseFare.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Distance ({route.distanceKm} km)</span><span>€{fare.distanceCost.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Time ({Math.round(route.durationMinutes)} min)</span><span>€{fare.timeCost.toFixed(2)}</span></div>
              {fare.discountPercent > 0 && (
                <div className="flex justify-between" style={{ color: "#27500A" }}>
                  <span>Discount ({fare.discountPercent}%)</span>
                  <span>−€{fare.discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between"><span>Pre-booking fee</span><span>€{fare.preBookingFee.toFixed(2)}</span></div>
            </div>
            {fare.minimumFareApplied && (
              <div className="mt-2 text-[11px] text-[#8C8977]">Minimum fare applied for this trip</div>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-[#ECE9E0] pt-3">
              <span className="text-sm font-medium text-[#2C2C2A]">Total</span>
              <span className="text-lg font-semibold text-[#2C2C2A]">€{fare.total.toFixed(2)}</span>
            </div>
          </div>

          {/* Pay now vs pay later */}
          <div
            className="mb-4 rounded-xl p-4"
            style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" }}
          >
            <div className="mb-3 text-xs font-medium text-[#5F5E5A]">How do you want to pay?</div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setPaymentTiming("now")}
                className="flex flex-col items-start gap-1.5 rounded-lg p-3 text-left transition-all"
                style={{
                  background: paymentTiming === "now" ? "#EAF1FB" : "#FFFFFF",
                  border: paymentTiming === "now" ? "1.5px solid #185FA5" : "1px solid #ECE9E0",
                }}
              >
                <CreditCard size={16} color={paymentTiming === "now" ? "#185FA5" : "#5F5E5A"} />
                <span className="text-xs font-semibold text-[#2C2C2A]">Pay now</span>
                <span className="text-[11px] text-[#5F5E5A]">Full fare charged by card, right now</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentTiming("later")}
                className="flex flex-col items-start gap-1.5 rounded-lg p-3 text-left transition-all"
                style={{
                  background: paymentTiming === "later" ? "#EAF1FB" : "#FFFFFF",
                  border: paymentTiming === "later" ? "1.5px solid #185FA5" : "1px solid #ECE9E0",
                }}
              >
                <Banknote size={16} color={paymentTiming === "later" ? "#185FA5" : "#5F5E5A"} />
                <span className="text-xs font-semibold text-[#2C2C2A]">Pay in the taxi</span>
                <span className="text-[11px] text-[#5F5E5A]">Cash or card after the ride</span>
              </button>
            </div>

            {paymentTiming === "later" && (
              <div className="mt-3 rounded-lg p-3 text-[11px] leading-relaxed" style={{ background: "#FAEEDA", color: "#633806" }}>
                A €{payLaterDepositAmount.toFixed(2)} deposit is charged now to secure your booking. It's
                subtracted from the fare — you'll owe €{Math.max(fare.total - payLaterDepositAmount, 0).toFixed(2)} more,
                payable to the driver by cash or card once the trip is complete.
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
                depositAmount: paymentTiming === "later" ? payLaterDepositAmount : 0,
              })
            }
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white"
            style={{
              background: "linear-gradient(135deg, #378ADD, #0C447C)",
              boxShadow: "3px 3px 8px rgba(4,44,83,0.35), -2px -2px 6px rgba(133,183,235,0.5)",
            }}
          >
            {paymentTiming === "now"
              ? `Confirm & pay €${fare.total.toFixed(2)}`
              : `Confirm & pay deposit €${payLaterDepositAmount.toFixed(2)}`}
            <ArrowRight size={15} />
          </button>

          <div className="mt-3 text-center text-[11px] text-[#8C8977]">
            Fares reflect current traffic conditions and may differ slightly from the final metered amount.
          </div>
        </>
      )}
    </div>
  );
}

