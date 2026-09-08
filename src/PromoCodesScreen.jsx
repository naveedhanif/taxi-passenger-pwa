import { useEffect, useState } from "react";
import { ArrowRight, Tag, Copy, Check, Loader2, AlertCircle, Gift, Ticket } from "lucide-react";
import { listMyPromos, lookupPromoCode } from "./promoApi.js";

// Restyled to match the reference layout (redeem-code input up top,
// active offers as a clear card list) and to respond to the light/dark
// theme toggle via CSS variables — no change to what data this screen
// shows or how it's fetched. The redeem-code input is real, not new
// fabricated functionality: it calls lookupPromoCode, which already
// existed and was already used elsewhere (manual entry on the fare
// estimate screen) — this screen just didn't have its own copy of it
// before.

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
  active: { label: "Active", bgVar: "var(--success-bg)", textVar: "var(--success-text)" },
  used: { label: "Used", bgVar: "var(--bg-card-alt)", textVar: "var(--text-secondary)" },
  paused: { label: "Unavailable", bgVar: "var(--bg-card-alt)", textVar: "var(--text-secondary)" },
  expired: { label: "Expired", bgVar: "var(--error-bg)", textVar: "var(--error-text)" },
  used_up: { label: "Fully redeemed", bgVar: "var(--error-bg)", textVar: "var(--error-text)" },
};

function PromoCard({ promo }) {
  const [copied, setCopied] = useState(false);
  const s = STATUS_LABEL[promo.status] || STATUS_LABEL.active;
  const isUsable = promo.status === "active";

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        boxShadow: isUsable ? "var(--shadow-raised)" : "none",
        opacity: isUsable ? 1 : 0.7,
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Tag size={13} color={isUsable ? "var(--accent)" : "var(--text-muted)"} />
          <span className="font-mono text-sm font-bold" style={{ color: "var(--text-primary)" }}>{promo.code}</span>
        </div>
        <span className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold" style={{ background: s.bgVar, color: s.textVar }}>
          {s.label}
        </span>
      </div>

      <div className="mb-3 text-2xl font-bold" style={{ fontFamily: "'Space Grotesk'", color: isUsable ? "var(--success-text)" : "var(--text-muted)" }}>
        {promo.discountType === "percent" ? `${promo.discountValue}% off` : `€${Number(promo.discountValue).toFixed(2)} off`}
        <span className="ml-1.5 text-xs font-normal" style={{ fontFamily: "Inter", color: "var(--text-muted)" }}>
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
          style={{ background: "var(--bg-card-alt)", color: "var(--accent)" }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy code"}
        </button>
      ) : (
        <div className="text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
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

  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemResult, setRedeemResult] = useState(null); // { ok: boolean, message: string }

  async function loadPromos() {
    setStatus("loading");
    const result = await listMyPromos({ driverId, customerSessionToken });
    if (result.error) {
      setErrorMessage(result.error);
      setStatus("error");
      return;
    }
    setPromos(result.promos || []);
    setStatus("ready");
  }

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

  async function handleRedeem(e) {
    e.preventDefault();
    if (!redeemCode.trim()) return;
    setRedeeming(true);
    setRedeemResult(null);
    const result = await lookupPromoCode({ driverId, code: redeemCode.trim().toUpperCase(), customerSessionToken });
    setRedeeming(false);
    if (result.error) {
      setRedeemResult({ ok: false, message: result.error });
      return;
    }
    setRedeemResult({ ok: true, message: `"${result.promo.code}" is valid — it'll apply automatically at checkout.` });
    setRedeemCode("");
    loadPromos();
  }

  const active = promos.filter((p) => p.status === "active");
  const inactive = promos.filter((p) => p.status !== "active");

  return (
    <div className="mx-auto w-full max-w-[400px] p-5" style={{ backgroundColor: "var(--bg-page)", fontFamily: "Inter", minHeight: 640 }}>
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-btn)" }}
        >
          <ArrowRight size={15} color="var(--text-secondary)" style={{ transform: "rotate(180deg)" }} />
        </button>
        <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Promo codes</div>
        <div className="w-9" />
      </div>

      {/* Redeem a code — real functionality, calls the same
          lookup-promo-code backend the fare estimate screen already
          used, just newly available here too. */}
      <form onSubmit={handleRedeem} className="mb-6">
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Redeem a code
        </div>
        <div className="flex items-center gap-2 rounded-xl p-1.5" style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)" }}>
          <Ticket size={15} className="ml-2 shrink-0" color="var(--text-muted)" />
          <input
            value={redeemCode}
            onChange={(e) => setRedeemCode(e.target.value)}
            placeholder="Enter code"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          <button
            type="submit"
            disabled={redeeming || !redeemCode.trim()}
            className="shrink-0 rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--accent-gradient)" }}
          >
            {redeeming ? <Loader2 size={13} className="animate-spin" /> : "Apply"}
          </button>
        </div>
        {redeemResult && (
          <div
            className="mt-2 flex items-center gap-1.5 rounded-lg p-2 text-[11px]"
            style={{
              background: redeemResult.ok ? "var(--success-bg)" : "var(--error-bg)",
              color: redeemResult.ok ? "var(--success-text)" : "var(--error-text)",
            }}
          >
            {redeemResult.ok ? <Check size={12} /> : <AlertCircle size={12} />}
            {redeemResult.message}
          </div>
        )}
      </form>

      {status === "loading" && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm" style={{ color: "var(--text-secondary)" }}>
          <Loader2 size={22} className="animate-spin" color="var(--accent)" />
          Loading your promo codes…
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-3 rounded-xl p-6 text-center text-sm" style={{ background: "var(--error-bg)", color: "var(--error-text)" }}>
          <AlertCircle size={22} />
          {errorMessage}
        </div>
      )}

      {status === "ready" && promos.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl py-16 text-center" style={{ border: "1px solid var(--border-card)", background: "var(--bg-card)" }}>
          <Gift size={24} color="var(--text-muted)" />
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>No promo codes yet.</div>
          <div className="px-6 text-[11px]" style={{ color: "var(--text-muted)" }}>Any discount your driver sends you, or a general offer, will show up here.</div>
        </div>
      )}

      {status === "ready" && promos.length > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Active Offers</div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{active.length} available</div>
          </div>

          {active.length > 0 ? (
            <div className="mb-5 space-y-3">
              {active.map((p) => (
                <PromoCard key={p.id} promo={p} />
              ))}
            </div>
          ) : (
            <div className="mb-5 rounded-xl py-8 text-center text-[11px]" style={{ border: "1px solid var(--border-card)", background: "var(--bg-card)", color: "var(--text-muted)" }}>
              No active offers right now.
            </div>
          )}

          <p className="mb-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
            An active code is applied automatically at checkout — you don't need to copy or paste anything to book with it.
          </p>

          {inactive.length > 0 && (
            <>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Past codes</div>
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
