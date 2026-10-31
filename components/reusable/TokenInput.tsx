"use client";

import { useRef, useLayoutEffect, useState } from "react";

interface TokenInputProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  usdValueLabel: string;
  isLoading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  /** Keep a read-only quoted value at full white contrast. */
  forceWhiteValue?: boolean;
}

const MAX_FONT_SIZE = 36;
const MIN_FONT_SIZE = 10;

const TokenInput = ({
  value,
  onChange,
  onClear,
  usdValueLabel,
  isLoading = false,
  loadingLabel = "Loading quote",
  disabled = false,
  forceWhiteValue = false,
}: TokenInputProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(MAX_FONT_SIZE);
  const measuredValue = isLoading ? "..." : value || "0.00";

  useLayoutEffect(() => {
    const container = containerRef.current;
    const mirror = mirrorRef.current;
    if (!container || !mirror) return;

    // Available width: container minus the clear-button space (24px)
    const hasClear = !isLoading && value !== "0.00" && value !== "";
    const availableWidth = container.clientWidth - (hasClear ? 28 : 4);

    // Binary-search for the largest font size that fits
    let lo = MIN_FONT_SIZE;
    let hi = MAX_FONT_SIZE;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      mirror.style.fontSize = `${mid}px`;
      if (mirror.scrollWidth <= availableWidth) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    setFontSize(lo);
  }, [isLoading, value]);

  return (
    <div
      ref={containerRef}
      className="relative ml-auto flex-1 basis-0 min-w-0 max-w-full text-right overflow-hidden"
    >
      {/* Hidden mirror used to measure rendered text width */}
      <span
        ref={mirrorRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          top: -9999,
          left: -9999,
          visibility: "hidden",
          whiteSpace: "nowrap",
          fontWeight: 600,
          fontFamily: "inherit",
          pointerEvents: "none",
        }}
      >
        {measuredValue}
      </span>

      <style jsx>{`
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type="number"] {
          -moz-appearance: textfield;
          appearance: textfield;
        }
        @keyframes tokenInputDotPulse {
          0%,
          80%,
          100% {
            opacity: 0.35;
            transform: translateY(0);
          }
          40% {
            opacity: 1;
            transform: translateY(-2px);
          }
        }
        .quote-loading-dot {
          display: inline-block;
          animation: tokenInputDotPulse 1s infinite ease-in-out;
        }
        .quote-loading-dot:nth-child(2) {
          animation-delay: 0.12s;
        }
        .quote-loading-dot:nth-child(3) {
          animation-delay: 0.24s;
        }
      `}</style>

      {isLoading ? (
        <div
          aria-live="polite"
          aria-label={loadingLabel}
          style={{
            fontSize: `${fontSize}px`,
            height: `${MAX_FONT_SIZE + 4}px`,
            transition: "font-size 0.15s ease",
          }}
          className="flex w-full min-w-0 items-center justify-end bg-transparent pr-1 text-right font-semibold text-foreground outline-none"
        >
          <span aria-hidden="true" className="inline-flex items-center gap-0.5">
            <span className="quote-loading-dot">.</span>
            <span className="quote-loading-dot">.</span>
            <span className="quote-loading-dot">.</span>
          </span>
        </div>
      ) : (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => {
            if (value === "0.00") onChange("");
            e.target.select();
          }}
          onBlur={() => {
            if (value === "") onChange("0.00");
          }}
          disabled={disabled}
          style={{
            fontSize: `${fontSize}px`,
            height: `${MAX_FONT_SIZE + 4}px`,
            transition: "font-size 0.15s ease",
          }}
          className={`block w-full min-w-0 bg-transparent pr-6 text-right font-semibold outline-none disabled:cursor-not-allowed ${
            forceWhiteValue
              ? "text-white disabled:text-white disabled:opacity-100"
              : "text-foreground disabled:opacity-70"
          }`}
          placeholder="0.00"
        />
      )}

      {!isLoading && !disabled && value !== "0.00" && value !== "" && (
        <button
          onClick={onClear}
          className="absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-lg"
        >
          ×
        </button>
      )}
      <p
        className={`text-sm truncate ${
          isLoading ? "font-medium text-primary" : "text-muted-foreground"
        }`}
      >
        {isLoading ? loadingLabel : usdValueLabel}
      </p>
    </div>
  );
};

export default TokenInput;
