import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { ShieldCheck, ArrowRight, AlertCircle } from "lucide-react";

/**
 * IMPORTANT CORRECTION from an earlier design pass: this uses Stripe's
 * real Elements/PaymentElement — never raw card number/expiry/CVC input
 * fields owned by our own app. Handling raw card numbers directly is a
 * PCI-DSS compliance problem; Stripe's Elements is a secure iframe THEY
 * control specifically so app code never touches raw card data.
 *
 * clientSecret must come from a backend call (a Supabase Edge Function)
 * that creates a Stripe PaymentIntent with:
 *   - amount: eurosToStripeCents(fare.total)
 *   - application_fee_amount: <platform's cut, in cents>
 *   - transfer_data: { destination: driver.stripe_connect_account_id }
 * That Edge Function doesn't exist yet — this screen expects clientSecret
 * as a prop once it does.
 */

function useGoogleFont() {
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
}

function PaymentForm({ amount, paymentTiming, balanceDue, onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements) return;

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
        <PaymentElement />
      </div>

      {errorMessage && (
        <div className="mt-3 flex items-center gap-2 rounded-lg p-3 text-xs" style={{ background: "#FCEBEB", color: "#791F1F" }}>
          <AlertCircle size={14} /> {errorMessage}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || submitting}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white disabled:opacity-60"
        style={{
          background: "linear-gradient(135deg, #378ADD, #0C447C)",
          boxShadow: "3px 3px 8px rgba(4,44,83,0.35), -2px -2px 6px rgba(133,183,235,0.5)",
        }}
      >
        {submitting
          ? "Processing…"
          : paymentTiming === "later"
          ? `Pay €${amount.toFixed(2)} deposit & confirm booking`
          : `Pay €${amount.toFixed(2)} & confirm booking`}
        {!submitting && <ArrowRight size={15} />}
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
 * @param {number} props.amount - what's being charged right now, in euros (full fare, or just the deposit for pay-later)
 * @param {"now"|"later"} [props.paymentTiming]
 * @param {number|null} [props.balanceDue] - remaining amount owed to the driver directly, when paymentTiming is "later"
 * @param {function} props.onSuccess - called with the Stripe PaymentIntent once payment succeeds
 */
export default function PaymentScreen({ stripePublishableKey, clientSecret, amount, paymentTiming, balanceDue, onSuccess }) {
  useGoogleFont();

  if (!stripePublishableKey || !clientSecret) {
    return (
      <div
        className="mx-auto w-full max-w-[400px] p-5 text-center text-sm text-[#8C8977]"
        style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter", minHeight: 300 }}
      >
        Payment unavailable — booking must be created first (this needs the
        booking Edge Function that doesn't exist yet).
      </div>
    );
  }

  const stripePromise = loadStripe(stripePublishableKey);

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
      <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
        <PaymentForm amount={amount} paymentTiming={paymentTiming} balanceDue={balanceDue} onSuccess={onSuccess} />
      </Elements>
    </div>
  );
}

