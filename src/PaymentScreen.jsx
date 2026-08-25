import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { ShieldCheck, ArrowRight, AlertCircle } from "lucide-react";

/**
 * Uses Stripe's real Elements/PaymentElement — never raw card number/
 * expiry/CVC input fields owned by our own app. Handling raw card
 * numbers directly is a PCI-DSS compliance problem; Stripe's Elements is
 * a secure iframe THEY control specifically so app code never touches
 * raw card data.
 *
 * clientSecret comes from the create-booking Edge Function, which
 * creates a Stripe PaymentIntent with amount/application_fee_amount/
 * transfer_data already set correctly — see
 * supabase/functions/create-booking/index.ts.
 */

// loadStripe() must be called exactly ONCE, outside the component render
// path — not on every render inside PaymentScreen. Calling it per-render
// creates a brand new Stripe instance each time, which React then feeds
// into <Elements stripe={...}> as a "changed" prop. Stripe explicitly
// rejects that ("You cannot change the stripe prop after setting it"),
// and the mismatch between the old mounted PaymentElement and the new
// Stripe instance is exactly what caused confirmPayment() to fail with
// "elements should have a mounted Payment Element" — the button then
// sits on "Processing..." forever because the promise it's awaiting
// never resolves cleanly.
//
// This module-level cache also correctly handles a key that's genuinely
// unset on first render (falls back once state/props settle) without
// creating a new Stripe instance for every intermediate render.
let stripePromiseCache = null;
let stripePromiseCacheKey = null;
function getStripePromise(publishableKey) {
  if (!publishableKey) return null;
  if (stripePromiseCache && stripePromiseCacheKey === publishableKey) {
    return stripePromiseCache;
  }
  stripePromiseCache = loadStripe(publishableKey);
  stripePromiseCacheKey = publishableKey;
  return stripePromiseCache;
}

function useGoogleFont() {
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
}

function PaymentForm({ amount, paymentTiming, balanceDue, bookingId, onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  // Tracks whether PaymentElement has actually finished mounting its
  // iframe — stripe/elements existing is NOT the same thing. Calling
  // confirmPayment() before this fires is exactly what caused
  // "IntegrationError: elements should have a mounted Payment Element"
  // even though stripe and elements were both non-null.
  const [elementReady, setElementReady] = useState(false);
  // If the element fails to load entirely (bad key, network block, key
  // mode mismatch between publishable/secret key, etc.) neither onReady
  // NOR any console error fires by default — the form just silently
  // stays blank forever. onLoadError is the one callback Stripe
  // actually provides for this exact case; without wiring it up, this
  // failure mode is completely invisible to both user and developer.
  const [loadError, setLoadError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements || !elementReady) return;

    setSubmitting(true);
    setErrorMessage("");

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (error) {
      setErrorMessage(error.message || "Payment failed — please try again");
      setSubmitting(false);
      return;
    }

    if (paymentIntent && paymentIntent.status === "succeeded") {
      // Stripe confirms success client-side, but the booking only
      // becomes visible to the driver / counts toward availability once
      // the server independently re-verifies with Stripe — never trust
      // this client-side result alone. See
      // supabase/functions/confirm-booking-payment/index.ts.
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const res = await fetch(`${supabaseUrl}/functions/v1/confirm-booking-payment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${anonKey}`,
            apikey: anonKey,
          },
          body: JSON.stringify({ booking_id: bookingId }),
        });
        const data = await res.json();
        if (!res.ok || !data.confirmed) {
          setErrorMessage(
            "Your payment went through, but we couldn't confirm your booking — please contact support with your booking reference."
          );
          setSubmitting(false);
          return;
        }
      } catch {
        setErrorMessage(
          "Your payment went through, but we couldn't confirm your booking — please contact support with your booking reference."
        );
        setSubmitting(false);
        return;
      }

      onSuccess(paymentIntent);
    } else {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {paymentTiming === "later" && (
        <div className="mb-4 rounded-lg p-3 text-xs leading-relaxed" style={{ background: "#FAEEDA", color: "#633806" }}>
          This is your <strong>€{amount.toFixed(2)} booking deposit</strong>, not the full fare. You'll pay the
          remaining €{(balanceDue ?? 0).toFixed(2)} directly to the driver (cash or card) once the trip is complete.
        </div>
      )}

      <div
        className="rounded-xl p-4"
        style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" }}
      >
        <PaymentElement
          onReady={() => setElementReady(true)}
          onLoadError={(event) => {
            // This is the one signal Stripe gives us when the element
            // genuinely fails to mount — a bad/mismatched key, a
            // network block to js.stripe.com, or an invalid
            // clientSecret are the usual causes. Surfaced directly in
            // the UI (see the diagnostic panel below) so this failure
            // mode is no longer invisible.
            setLoadError(event?.error?.message || "Payment form failed to load (unknown reason)");
          }}
          options={{
            // "auto" (the default) already shows Apple Pay / Google Pay
            // when the browser/device supports it AND the domain is
            // registered with Stripe (see register-payment-domain
            // function) — being explicit here so it's clear this isn't
            // accidental, and so wallets are never silently suppressed
            // by a future options change.
            wallets: { applePay: "auto", googlePay: "auto" },
          }}
        />
      </div>

      {/* TEMPORARY DIAGNOSTIC — remove once the blank-payment-form bug
          is confirmed fixed. Surfaces exactly what state Stripe's SDK
          is in without needing DevTools, since the failure mode being
          debugged produces zero console errors by default. */}
      <div className="mt-3 rounded-lg p-3 text-[10px] font-mono leading-relaxed" style={{ background: "#F1EFE8", color: "#5F5E5A" }}>
        <div>stripe loaded: {stripe ? "yes" : "no"}</div>
        <div>elements loaded: {elements ? "yes" : "no"}</div>
        <div>element ready: {elementReady ? "yes" : "no"}</div>
        <div>load error: {loadError || "none"}</div>
      </div>

      {loadError && (
        <div className="mt-3 flex items-center gap-2 rounded-lg p-3 text-xs" style={{ background: "#FCEBEB", color: "#791F1F" }}>
          <AlertCircle size={14} /> Payment form couldn't load: {loadError}
        </div>
      )}

      {errorMessage && (
        <div className="mt-3 flex items-center gap-2 rounded-lg p-3 text-xs" style={{ background: "#FCEBEB", color: "#791F1F" }}>
          <AlertCircle size={14} /> {errorMessage}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || !elementReady || submitting}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white disabled:opacity-60"
        style={{
          background: "linear-gradient(135deg, #378ADD, #0C447C)",
          boxShadow: "3px 3px 8px rgba(4,44,83,0.35), -2px -2px 6px rgba(133,183,235,0.5)",
        }}
      >
        {submitting
          ? "Processing…"
          : !elementReady
          ? "Loading payment form…"
          : paymentTiming === "later"
          ? `Pay €${amount.toFixed(2)} deposit & confirm booking`
          : `Pay €${amount.toFixed(2)} & confirm booking`}
        {!submitting && elementReady && <ArrowRight size={15} />}
      </button>

      <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-[#8C8977]">
        <ShieldCheck size={12} />
        Payment goes directly to your driver via Stripe — securely processed, never stored by this app.
      </div>
    </form>
  );
}

/**
 * @param {object} props
 * @param {string} props.stripePublishableKey
 * @param {string} props.clientSecret - from the create-booking Edge Function
 * @param {string} props.bookingId - the booking's id, needed to confirm payment server-side after Stripe succeeds
 * @param {number} props.amount - what's being charged right now, in euros (full fare, or just the deposit for pay-later)
 * @param {"now"|"later"} [props.paymentTiming]
 * @param {number|null} [props.balanceDue] - remaining amount owed to the driver directly, when paymentTiming is "later"
 * @param {function} props.onSuccess - called with the Stripe PaymentIntent once payment succeeds AND is server-confirmed
 */
export default function PaymentScreen({ stripePublishableKey, clientSecret, bookingId, amount, paymentTiming, balanceDue, onSuccess }) {
  useGoogleFont();

  if (!stripePublishableKey) {
    return (
      <div
        className="mx-auto w-full max-w-[400px] p-5 text-center text-sm text-[#8C8977]"
        style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter", minHeight: 300 }}
      >
        Payment unavailable — VITE_STRIPE_PUBLISHABLE_KEY isn't set for this deployment. Add it in your
        hosting provider's environment variables (not just your local .env file) and redeploy.
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div
        className="mx-auto w-full max-w-[400px] p-5 text-center text-sm text-[#8C8977]"
        style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter", minHeight: 300 }}
      >
        Payment unavailable — no booking was created yet. Go back and confirm your fare estimate first.
      </div>
    );
  }

  const stripePromise = getStripePromise(stripePublishableKey);

  const appearance = {
    theme: "stripe",
    variables: {
      colorPrimary: "#185FA5",
      colorBackground: "#F0EEE7",
      colorText: "#2C2C2A",
      borderRadius: "10px",
      fontFamily: "Inter, sans-serif",
    },
  };

  return (
    <div className="mx-auto w-full max-w-[400px] p-5" style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter", minHeight: 500 }}>
      <div className="mb-5 text-sm font-semibold text-[#2C2C2A]">Payment</div>

      {/* TEMPORARY DIAGNOSTIC — remove once the blank-payment-form bug
          is confirmed fixed. Shows just enough of each value (never the
          full clientSecret or key) to confirm publishable-key mode and
          that a real clientSecret was actually received, without
          exposing anything sensitive on screen. */}
      <div className="mb-3 rounded-lg p-3 text-[10px] font-mono leading-relaxed" style={{ background: "#F1EFE8", color: "#5F5E5A" }}>
        <div>publishable key prefix: {stripePublishableKey.slice(0, 12)}...</div>
        <div>publishable key mode: {stripePublishableKey.startsWith("pk_live_") ? "LIVE" : stripePublishableKey.startsWith("pk_test_") ? "TEST" : "UNKNOWN"}</div>
        <div>clientSecret present: {clientSecret ? "yes" : "no"}</div>
        <div>clientSecret prefix: {clientSecret ? clientSecret.slice(0, 20) + "..." : "n/a"}</div>
      </div>

      <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
        <PaymentForm amount={amount} paymentTiming={paymentTiming} balanceDue={balanceDue} bookingId={bookingId} onSuccess={onSuccess} />
      </Elements>
    </div>
  );
}

