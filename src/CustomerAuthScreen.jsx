import { useEffect, useState } from "react";
import { Mail, Lock, User, ArrowRight, AlertCircle, ArrowLeft, Gift, Eye, EyeOff } from "lucide-react";
import { signUpCustomer, signInCustomer, requestPasswordReset, setNewPassword } from "./customerAuth";

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
  const [reveal, setReveal] = useState(false);
  const isPassword = props.type === "password";
  return (
    <div
      className="flex items-center gap-2.5 rounded-2xl px-4 py-3"
      style={{ background: "var(--bg-card-alt)", boxShadow: "inset 2px 2px 5px rgba(44,44,42,0.14), inset -2px -2px 5px rgba(255,255,255,0.8)" }}
    >
      <Icon size={16} color="var(--text-muted)" />
      <input
        {...props}
        type={isPassword && reveal ? "text" : props.type}
        className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
        style={{ color: "var(--text-primary)" }}
      />
      {isPassword && (
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          aria-label={reveal ? "Hide password" : "Show password"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        >
          {reveal ? <EyeOff size={16} color="var(--text-muted)" /> : <Eye size={16} color="var(--text-muted)" />}
        </button>
      )}
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
  const [mode, setMode] = useState("signup"); // "signup" | "signin" | "forgot"
  const [resetSent, setResetSent] = useState(false);
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

    if (mode === "forgot") {
      const result = await requestPasswordReset(email.trim());
      setSubmitting(false);
      if (result.error) {
        setErrorMessage(result.error);
        return;
      }
      setResetSent(true);
      return;
    }

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
    <div className="mx-auto w-full max-w-[430px] p-5" style={{ backgroundColor: "var(--bg-page)", fontFamily: "Inter", minHeight: 640 }}>
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-btn)" }}
        >
          <ArrowLeft size={15} color="var(--text-secondary)" />
        </button>
        <div className="text-sm font-semibold text-[var(--text-primary)]">{driverName}</div>
        <div className="w-11" />
      </div>

      {resetSent ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Mail size={28} color="var(--accent)" />
          <div className="text-base font-semibold text-[var(--text-primary)]" style={{ fontFamily: "'Space Grotesk'" }}>
            Check your email
          </div>
          <div className="max-w-xs text-sm text-[var(--text-secondary)]">
            If an account exists for {email}, we've sent a link to reset your password. Open it on this phone, then choose a new password.
          </div>
          <button
            onClick={() => {
              setResetSent(false);
              setMode("signin");
            }}
            className="mt-2 text-xs font-medium text-(--accent) underline underline-offset-2"
          >
            Back to sign in
          </button>
        </div>
      ) : confirmationSent ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Mail size={28} color="var(--accent)" />
          <div className="text-base font-semibold text-[var(--text-primary)]" style={{ fontFamily: "'Space Grotesk'" }}>
            Check your email
          </div>
          <div className="max-w-xs text-sm text-[var(--text-secondary)]">
            We've sent a confirmation link to {email}. Tap it, then come back and sign in.
          </div>
          <button
            onClick={() => {
              setConfirmationSent(false);
              setMode("signin");
            }}
            className="mt-2 text-xs font-medium text-(--accent) underline underline-offset-2"
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <>
      <div className="mb-1 text-xl" style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, color: "var(--text-primary)" }}>
        {mode === "signup" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Welcome back"}
      </div>
      <div className="mb-6 text-sm text-[var(--text-secondary)]">
        {mode === "signup" ? "Save your trip history and book faster next time." : mode === "forgot" ? "Enter your email and we'll send you a reset link." : "Sign in to see your bookings."}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5">
        {mode === "signup" && (
          <>
            <Field icon={User} type="text" placeholder="Your name" required value={name} onChange={(e) => setName(e.target.value)} />
            <Field icon={User} type="tel" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </>
        )}
        <Field icon={Mail} type="email" placeholder="Email address" required value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode !== "forgot" && (
          <Field icon={Lock} type="password" placeholder="Password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
        {mode === "signin" && (
          <button
            type="button"
            onClick={() => { setErrorMessage(""); setMode("forgot"); }}
            className="block text-xs font-medium text-(--accent) underline underline-offset-2"
          >
            Forgot password?
          </button>
        )}
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
          <div className="flex items-center gap-2 rounded-lg p-3 text-xs" style={{ background: "var(--error-bg)", color: "var(--error-text)" }}>
            <AlertCircle size={14} /> {errorMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--accent-gradient)", boxShadow: "var(--shadow-accent-btn)" }}
        >
          {submitting ? "Please wait…" : mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}
          {!submitting && <ArrowRight size={15} />}
        </button>
      </form>

      <button
        onClick={() => { setErrorMessage(""); setMode(mode === "signup" ? "signin" : mode === "forgot" ? "signin" : "signup"); }}
        className="mt-4 w-full text-center text-xs font-medium text-(--accent) underline underline-offset-2"
      >
        {mode === "forgot" ? "Back to sign in" : mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>
      </>
      )}
    </div>
  );
}



/**
 * Shown when the app is opened from a password-reset email link.
 */
export function ResetPasswordScreen({ driverName, onDone }) {
  useGoogleFont();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage("");
    if (password !== confirm) {
      setErrorMessage("The two passwords don't match.");
      return;
    }
    setSubmitting(true);
    const result = await setNewPassword(password);
    setSubmitting(false);
    if (result.error) {
      setErrorMessage(result.error);
      return;
    }
    onDone?.();
  }

  return (
    <div className="mx-auto w-full max-w-[430px] p-5" style={{ backgroundColor: "var(--bg-page)", fontFamily: "Inter", minHeight: 640 }}>
      <div className="mb-5 text-center text-sm font-semibold text-[var(--text-primary)]">{driverName}</div>
      <div className="mb-1 text-xl" style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, color: "var(--text-primary)" }}>
        Choose a new password
      </div>
      <div className="mb-6 text-sm text-[var(--text-secondary)]">At least 6 characters.</div>
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <Field icon={Lock} type="password" placeholder="New password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        <Field icon={Lock} type="password" placeholder="Confirm new password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {errorMessage && (
          <div className="flex items-center gap-2 rounded-lg p-3 text-xs" style={{ background: "var(--error-bg)", color: "var(--error-text)" }}>
            <AlertCircle size={14} /> {errorMessage}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--accent-gradient)", boxShadow: "var(--shadow-accent-btn)" }}
        >
          {submitting ? "Saving…" : "Save new password"}
          {!submitting && <ArrowRight size={15} />}
        </button>
      </form>
    </div>
  );
}
