import { useEffect, useState } from "react";
import { ArrowRight, Tag, Copy, Check, Loader2, AlertCircle, Gift } from "lucide-react";
import { listMyPromos } from "./promoApi.js";

function useGoogleFont() {
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
}

const STATUS_LABEL = {
  active: { label: "Active", bg: "#EAF3DE", text: "#27500A" },
  used: { label: "Used", bg: "#F1EFE8", text: "#5F5E5A" },
  paused: { label: "Unavailable", bg: "#F1EFE8", text: "#5F5E5A" },
  expired: { label: "Expired", bg: "#FCEBEB", text: "#791F1F" },
  used_up: { label: "Fully redeemed", bg: "#FCEBEB", text: "#791F1F" },
};

function PromoCard({ promo }) {
  const [copied, setCopied] = useState(false);
  const s = STATUS_LABEL[promo.status] || STATUS_LABEL.active;
  const isUsable = promo.status === "active";

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: isUsable ? "#FBFAF6" : "#F7F7F5",
        border: isUsable ? "1px solid #ECE9E0" : "1px solid #ECE9E0",
        boxShadow: isUsable ? "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" : "none",
        opacity: isUsable ? 1 : 0.75,
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Tag size={13} color={isUsable ? "#185FA5" : "#8C8977"} />
          <span className="font-mono text-sm font-bold text-[#2C2C2A]">{promo.code}</span>
        </div>
        <span className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold" style={{ background: s.bg, color: s.text }}>
          {s.label}
        </span>
      </div>

      <div className="mb-3 text-2xl font-bold" style={{ fontFamily: "'Space Grotesk'", color: isUsable ? "#27500A" : "#8C8977" }}>
        {promo.discountType === "percent" ? `${promo.discountValue}% off` : `€${Number(promo.discountValue).toFixed(2)} off`}
        <span className="ml-1.5 text-xs font-normal text-[#8C8977]" style={{ fontFamily: "Inter" }}>
          your next ride
        </span>
      </div>

      {isUsable ? (
        <button
          onClick={() => {
            navigator.clipboard?.writeText(promo.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold"
          style={{ background: "#EAF1FB", color: "#185FA5" }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy code"}
        </button>
      ) : (
        <div className="text-center text-[11px] text-[#8C8977]">
          {promo.status === "used" && "You've already used this one."}
          {promo.status === "expired" && "This code has expired."}
          {promo.status === "used_up" && "This code has reached its usage limit."}
          {promo.status === "paused" && "This code isn't currently available."}
        </div>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} props.driverId
 * @param {string|null} props.customerSessionToken
 * @param {function} props.onBack
 */
export default function PromoCodesScreen({ driverId, customerSessionToken, onBack }) {
  useGoogleFont();
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [promos, setPromos] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      const result = await listMyPromos({ driverId, customerSessionToken });
      if (cancelled) return;
      if (result.error) {
        setErrorMessage(result.error);
        setStatus("error");
        return;
      }
      setPromos(result.promos || []);
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [driverId, customerSessionToken]);

  const active = promos.filter((p) => p.status === "active");
  const inactive = promos.filter((p) => p.status !== "active");

  return (
    <div className="mx-auto w-full max-w-[400px] p-5" style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter", minHeight: 640 }}>
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
        >
          <ArrowRight size={15} color="#5F5E5A" style={{ transform: "rotate(180deg)" }} />
        </button>
        <div className="text-sm font-semibold text-[#2C2C2A]">Promo codes</div>
        <div className="w-9" />
      </div>

      {status === "loading" && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-[#5F5E5A]">
          <Loader2 size={22} className="animate-spin" color="#185FA5" />
          Loading your promo codes…
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-3 rounded-xl p-6 text-center text-sm" style={{ background: "#FCEBEB", color: "#791F1F" }}>
          <AlertCircle size={22} />
          {errorMessage}
        </div>
      )}

      {status === "ready" && promos.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-[#E4E2DA] bg-white py-16 text-center">
          <Gift size={24} color="#B4B2A9" />
          <div className="text-sm text-[#8C8977]">No promo codes yet.</div>
          <div className="px-6 text-[11px] text-[#8C8977]">Any discount your driver sends you, or a general offer, will show up here.</div>
        </div>
      )}

      {status === "ready" && promos.length > 0 && (
        <>
          <p className="mb-4 text-[11px] text-[#8C8977]">
            An active code is applied automatically at checkout — you don't need to copy or paste anything to book with it. Copy it here only if you want to share it or keep track of it.
          </p>

          {active.length > 0 && (
            <div className="mb-5 space-y-3">
              {active.map((p) => (
                <PromoCard key={p.id} promo={p} />
              ))}
            </div>
          )}

          {inactive.length > 0 && (
            <>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[#8C8977]">Past codes</div>
              <div className="space-y-2.5">
                {inactive.map((p) => (
                  <PromoCard key={p.id} promo={p} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
