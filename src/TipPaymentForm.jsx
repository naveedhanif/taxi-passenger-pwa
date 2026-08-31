import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Loader2, AlertCircle } from "lucide-react";

// Same caching pattern as PaymentScreen.jsx, and for the same reason:
// loadStripe() must only ever be called once per publishable key, not
// on every render, or Stripe rejects the mismatched instance with
// "You cannot change the stripe prop after setting it" — see that
// file's own comment for the full story of how that bug presented.
let stripePromiseCache = null;
let stripePromiseCacheKey = null;
function getStripePromise(publishableKey) {
  if (!publishableKey) return null;
  if (stripePromiseCache && stripePromiseCacheKey === publishableKey) return stripePromiseCache;
  stripePromiseCache = loadStripe(publishableKey);
  stripePromiseCacheKey = publishableKey;
  return stripePromiseCache;
}

function TipForm({ bookingId, onSuccess, onError }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [elementReady, setElementReady] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements || !elementReady) return;
    setSubmitting(true);

    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });

    if (error) {
      onError(error.message || "Payment failed — please try again");
      setSubmitting(false);
      return;
    }

    if (paymentIntent && paymentIntent.status === "succeeded") {
      // Same principle as the fare payment — never trust the client's
      // own claim, independently re-verify server-side before treating
      // this as a real, recorded tip.
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/confirm-tip-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}`, apikey: anonKey },
        body: JSON.stringify({ booking_id: bookingId, payment_intent_id: paymentIntent.id }),
      });
      const data = await res.json();
      setSubmitting(false);
      if (!res.ok || !data.confirmed) {
        onError("Your tip payment may not have gone through — please try again in a moment.");
        return;
      }
      onSuccess(data.tipAmount);
    } else {
      setSubmitting(false);
      onError("Payment didn't complete — please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-3 rounded-lg p-3" style={{ background: "#F1EFE8" }}>
        <PaymentElement onReady={() => setElementReady(true)} />
      </div>
      <button
        type="submit"
        disabled={!stripe || !elementReady || submitting}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "linear-gradient(135deg, #378ADD, #0C447C)" }}
      >
        {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
        {submitting ? "Processing…" : "Confirm tip"}
      </button>
    </form>
  );
}

/**
 * @param {object} props
 * @param {string} props.stripePublishableKey
 * @param {string} props.clientSecret - from create-tip-payment
 * @param {string} props.bookingId
 * @param {function} props.onSuccess - (tipAmount) => void
 */
export default function TipPaymentForm({ stripePublishableKey, clientSecret, bookingId, onSuccess }) {
  const [errorMessage, setErrorMessage] = useState("");
  const stripePromise = getStripePromise(stripePublishableKey);

  if (!stripePromise || !clientSecret) {
    return (
      <div className="flex items-center gap-2 rounded-lg p-3 text-xs" style={{ background: "#FCEBEB", color: "#791F1F" }}>
        <AlertCircle size={13} /> Couldn't load the payment form.
      </div>
    );
  }

  return (
    <div>
      {errorMessage && (
        <div className="mb-3 flex items-center gap-2 rounded-lg p-3 text-xs" style={{ background: "#FCEBEB", color: "#791F1F" }}>
          <AlertCircle size={13} /> {errorMessage}
        </div>
      )}
      <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
        <TipForm bookingId={bookingId} onSuccess={onSuccess} onError={setErrorMessage} />
      </Elements>
    </div>
  );
}
