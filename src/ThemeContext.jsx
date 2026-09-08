import { createContext, useContext, useEffect, useState } from "react";

// Defaults to "light" always — the existing, unchanged look every
// current user already sees. Nothing about existing behavior changes
// unless someone explicitly taps the toggle. Persisted so the choice
// survives a reload, scoped to this device only (not synced to the
// customer's account — a deliberate simplicity choice, easy to change
// later if wanted).

const STORAGE_KEY = "taxi_passenger_theme";
const ThemeContext = createContext({ theme: "light", toggleTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage unavailable (private browsing, etc.) — theme still
      // works for this session, just won't persist across reloads.
    }
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
