import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { maskProxyPassword, splitProxyPassword } from "../lib/proxy";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** The field's accessible name. */
  label: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * A text box for a proxy address. The password in `user:password@host` is covered with *** unless the box is being edited
 * or the eye is pressed, so it isn't on screen for anyone looking over a shoulder (or in a screenshot).
 *
 * The box always holds the real text and the cover is drawn on top of it, so editing, selecting and tabbing in behave like any
 * other text box. (This hides the password from sight, not from a screen reader that reads the box's value.)
 */
export default function ProxyField({ value, onChange, label, invalid, disabled, className = "field mono", style }: Props) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const hasPassword = splitProxyPassword(value).password !== null;
  const covered = hasPassword && !focused && !revealed;
  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      <span className="relative inline-flex min-w-0 flex-1">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="none (e.g. socks5://127.0.0.1:1080)"
          spellCheck={false}
          autoComplete="off"
          aria-label={label}
          aria-invalid={invalid}
          disabled={disabled}
          className={className}
          style={{ ...style, ...(covered ? { color: "transparent" } : null) }}
        />
        {covered && (
          <span
            aria-hidden="true"
            data-proxy-cover
            className={`${className} absolute inset-0 flex items-center pointer-events-none overflow-hidden whitespace-nowrap`}
            style={{ ...style, background: "transparent", borderColor: "transparent", boxShadow: "none", width: "100%" }}
          >
            {maskProxyPassword(value)}
          </span>
        )}
      </span>
      {hasPassword && (
        <button type="button" className="row-btn" aria-label={revealed ? "Hide the proxy password" : "Show the proxy password"} aria-pressed={revealed} title={revealed ? "Hide the password" : "Show the password"} onClick={() => setRevealed((v) => !v)}>
          {revealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        </button>
      )}
    </span>
  );
}
