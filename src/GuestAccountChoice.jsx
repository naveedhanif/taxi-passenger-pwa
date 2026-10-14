import { useEffect } from "react";
import { UserPlus, X } from "lucide-react";

function useGoogleFont() {
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
}

/**
 * @param {object} props
 * @param {function} props.onCreateAccount
 * @param {function} props.onDismiss - "No thanks, just show my booking"
 */
export default function GuestAccountChoice({ onCreateAccount, onDismiss }) {
  useGoogleFont();

  return (
    <div
      className="mx-auto w-full max-w-[430px] p-5"
      style={{ backgroundColor: "var(--bg-page)", fontFamily: "Inter" }}
    >
      <div
        className="rounded-2xl p-5"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-raised)" }}
      >
        <div className="mb-3 flex items-start justify-between">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-btn)" }}
          >
            <UserPlus size={17} color="var(--accent)" />
          </div>
          <button onClick={onDismiss} className="text-[var(--text-muted)]">
            <X size={16} />
          </button>
        </div>

        <div className="mb-1 text-base font-semibold text-[var(--text-primary)]" style={{ fontFamily: "'Space Grotesk'" }}>
          Want to save this trip?
        </div>
        <div className="mb-5 text-sm text-[var(--text-secondary)]">
          Create an account to keep your trip history, save favorite addresses, and book faster next time. Takes 30 seconds.
        </div>

        <button
          onClick={onCreateAccount}
          className="mb-2.5 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold text-white"
          style={{
            background: "var(--accent-gradient)",
            boxShadow: "var(--shadow-accent-btn)",
          }}
        >
          Create account
        </button>

        <button
          onClick={onDismiss}
          className="w-full py-2 text-center text-xs font-medium text-[var(--text-muted)]"
        >
          No thanks, just show my booking
        </button>
      </div>
    </div>
  );
}

