import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Loader2, AlertCircle } from "lucide-react";
import { listMessages, sendMessage } from "./messagesApi.js";

const POLL_INTERVAL_MS = 6000;

/**
 * @param {object} props
 * @param {string} props.bookingId
 * @param {string|null} [props.guestAccessToken]
 * @param {string|null} [props.customerSessionToken]
 * @param {"driver"|"passenger"} props.selfRole - which side of the chat this instance is rendering for, purely for message alignment styling
 */
export default function ChatPanel({ bookingId, guestAccessToken, customerSessionToken, selfRole }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Previously an error here just silently returned, leaving loaded
  // permanently false — the panel looked exactly like an infinite
  // "Loading…" spinner with no way to tell it had actually failed
  // (e.g. the messages table/functions not deployed yet).
  const [loadError, setLoadError] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;

    async function load() {
      const result = await listMessages({ bookingId, guestAccessToken, customerSessionToken });
      if (cancelled) return;
      if (result.error) {
        setLoadError(result.error);
        setLoaded(true);
        return;
      }
      setLoadError("");
      setMessages(result.messages || []);
      setLoaded(true);
    }
    load();
    const intervalId = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [bookingId, guestAccessToken, customerSessionToken]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    // Optimistic — feels instant, the next poll reconciles with the
    // server's real copy shortly after.
    const optimistic = { id: `pending-${Date.now()}`, sender_role: selfRole, body: text, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    const result = await sendMessage({ bookingId, guestAccessToken, customerSessionToken, body: text });
    setSending(false);
    if (result.error) {
      // Roll back the optimistic bubble on failure so it's not
      // misleadingly shown as delivered.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      window.alert(result.error);
    }
  }

  return (
    <div className="rounded-xl" style={{ background: "#FBFAF6", border: "1px solid #ECE9E0" }}>
      <div className="flex items-center gap-2 border-b border-[#ECE9E0] px-3.5 py-2.5 text-xs font-semibold text-[#5F5E5A]">
        <MessageCircle size={13} /> Messages
      </div>
      <div ref={scrollRef} className="max-h-52 space-y-2 overflow-y-auto p-3">
        {!loaded ? (
          <div className="flex items-center justify-center gap-1.5 py-4 text-xs text-[#8C8977]">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : loadError ? (
          <div className="flex items-center justify-center gap-1.5 py-4 text-center text-xs" style={{ color: "#791F1F" }}>
            <AlertCircle size={12} /> {loadError}
          </div>
        ) : messages.length === 0 ? (
          <div className="py-4 text-center text-xs text-[#8C8977]">No messages yet — say hello!</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender_role === selfRole ? "justify-end" : "justify-start"}`}>
              <div
                className="max-w-[75%] rounded-2xl px-3 py-1.5 text-xs"
                style={
                  m.sender_role === selfRole
                    ? { background: "#185FA5", color: "white" }
                    : { background: "#F0EEE7", color: "#2C2C2A" }
                }
              >
                {m.body}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-[#ECE9E0] p-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Type a message…"
          className="flex-1 rounded-full px-3.5 py-2 text-xs text-[#2C2C2A] placeholder:text-[#B4B2A9]"
          style={{ background: "#F0EEE7" }}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-50"
          style={{ background: "#185FA5" }}
          aria-label="Send"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}
