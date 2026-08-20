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
      className="mx-auto w-full max-w-[400px] p-5"
      style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter" }}
    >
      <div
        className="rounded-2xl p-5"
        style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" }}
      >
        <div className="mb-3 flex items-start justify-between">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: "linear-gradient(155deg, #FFFFFF, #E7E5DD)", boxShadow: "3px 3px 8px rgba(44,44,42,0.14), -2px -2px 6px rgba(255,255,255,0.9)" }}
          >
            <UserPlus size={17} color="#185FA5" />
          </div>
          <button onClick={onDismiss} className="text-[#8C8977]">
            <X size={16} />
          </button>
        </div>

        <div className="mb-1 text-base font-semibold text-[#2C2C2A]" style={{ fontFamily: "'Space Grotesk'" }}>
          Want to save this trip?
        </div>
        <div className="mb-5 text-sm text-[#5F5E5A]">
          Create an account to keep your trip history, save favorite addresses, and book faster next time. Takes 30 seconds.
        </div>

        <button
          onClick={onCreateAccount}
          className="mb-2.5 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white"
          style={{
            background: "linear-gradient(135deg, #378ADD, #0C447C)",
            boxShadow: "3px 3px 8px rgba(4,44,83,0.35), -2px -2px 6px rgba(133,183,235,0.5)",
          }}
        >
          Create account
        </button>

        <button
          onClick={onDismiss}
          className="w-full py-2 text-center text-xs font-medium text-[#8C8977]"
        >
          No thanks, just show my booking
        </button>
      </div>
    </div>
  );
}
