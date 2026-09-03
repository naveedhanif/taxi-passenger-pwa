import { useEffect, useState } from "react";
import { Mail, Lock, User, ArrowRight, AlertCircle, ArrowLeft, Gift } from "lucide-react";
import { signUpCustomer, signInCustomer } from "./customerAuth";

function useGoogleFont() {
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
}

function Field({ icon: Icon, ...props }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl px-4 py-3"
      style={{ background: "#F0EEE7", boxShadow: "inset 2px 2px 5px rgba(44,44,42,0.14), inset -2px -2px 5px rgba(255,255,255,0.8)" }}
    >
      <Icon size={16} color="#8C8977" />
      <input
        {...props}
        className="w-full bg-transparent text-sm outline-none placeholder:text-[#8C8977]"
        style={{ color: "#2C2C2A" }}
      />
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} props.driverId - which driver's app this signup belongs to
 * @param {string} props.driverName - shown in the header, e.g. "John's Taxi"
 * @param {function} props.onAuthSuccess - called with { customerId } or { userId } once done
 * @param {function} props.onBack
 * @param {string} [props.initialReferralCode] - pre-fills the referral field from a ?ref= link, if the passenger arrived via one
 */
export default function CustomerAuthScreen({ driverId, driverName, onAuthSuccess, onBack, initialReferralCode = "" }) {
  useGoogleFont();
  const [mode, setMode] = useState("signup"); // "signup" | "signin"
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState(initialReferralCode);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmationSent, setConfirmationSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage("");
    setSubmitting(true);

    if (mode === "signup") {
      const result = await signUpCustomer({ email, password, name, phone, driverId, referralCode: referralCode.trim() || null });
      setSubmitting(false);
      if (result.error) {
        setErrorMessage(result.error);
        if (result.alreadyRegistered) setMode("signin");
        return;
      }
      if (result.needsEmailConfirmation) {
        setConfirmationSent(true);
        return;
      }
      onAuthSuccess?.({ customerId: result.customerId });
    } else {
      const result = await signInCustomer(email, password);
      setSubmitting(false);
      if (result.error) {
        setErrorMessage(result.error);
        return;
      }
      onAuthSuccess?.({ userId: result.userId });
    }
  }

  return (
    <div className="mx-auto w-full max-w-[400px] p-5" style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter", minHeight: 640 }}>
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
        >
          <ArrowLeft size={15} color="#5F5E5A" />
        </button>
        <div className="text-sm font-semibold text-[#2C2C2A]">{driverName}</div>
        <div className="w-11" />
      </div>

      {confirmationSent ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Mail size={28} color="#185FA5" />
          <div className="text-base font-semibold text-[#2C2C2A]" style={{ fontFamily: "'Space Grotesk'" }}>
            Check your email
          </div>
          <div className="max-w-xs text-sm text-[#5F5E5A]">
            We've sent a confirmation link to {email}. Tap it, then come back and sign in.
          </div>
          <button
            onClick={() => {
              setConfirmationSent(false);
              setMode("signin");
            }}
            className="mt-2 text-xs font-medium text-[#185FA5]"
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <>
      <div className="mb-1 text-xl" style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, color: "#2C2C2A" }}>
        {mode === "signup" ? "Create your account" : "Welcome back"}
      </div>
      <div className="mb-6 text-sm text-[#5F5E5A]">
        {mode === "signup" ? "Save your trip history and book faster next time." : "Sign in to see your bookings."}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5">
        {mode === "signup" && (
          <>
            <Field icon={User} type="text" placeholder="Your name" required value={name} onChange={(e) => setName(e.target.value)} />
            <Field icon={User} type="tel" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </>
        )}
        <Field icon={Mail} type="email" placeholder="Email address" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field icon={Lock} type="password" placeholder="Password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        {mode === "signup" && (
          <Field
            icon={Gift}
            type="text"
            placeholder="Referral code (optional)"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
          />
        )}

        {errorMessage && (
          <div className="flex items-center gap-2 rounded-lg p-3 text-xs" style={{ background: "#FCEBEB", color: "#791F1F" }}>
            <AlertCircle size={14} /> {errorMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "linear-gradient(135deg, #378ADD, #0C447C)", boxShadow: "3px 3px 8px rgba(4,44,83,0.35), -2px -2px 6px rgba(133,183,235,0.5)" }}
        >
          {submitting ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          {!submitting && <ArrowRight size={15} />}
        </button>
      </form>

      <button
        onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
        className="mt-4 w-full text-center text-xs font-medium text-[#185FA5]"
      >
        {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>
      </>
      )}
    </div>
  );
}

