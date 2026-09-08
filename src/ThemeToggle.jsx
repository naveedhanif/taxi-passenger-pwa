import { Sun, Moon } from "lucide-react";
import { useTheme } from "./ThemeContext.jsx";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      className="flex h-9 w-9 items-center justify-center rounded-full"
      style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-btn)" }}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      {theme === "light" ? <Moon size={14} color="var(--text-secondary)" /> : <Sun size={14} color="var(--text-secondary)" />}
    </button>
  );
}
