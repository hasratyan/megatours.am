"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrency } from "@/components/currency-provider";
import { displayCurrencyOptions, type DisplayCurrency } from "@/lib/currency";

type CurrencySwitcherProps = {
  onAction?: () => void;
};

export default function CurrencySwitcher({ onAction }: CurrencySwitcherProps) {
  const { currency, setCurrency } = useCurrency();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption =
    displayCurrencyOptions.find((option) => option.code === currency) ?? displayCurrencyOptions[0];
  const menuOptions = displayCurrencyOptions.filter((option) => option.code !== currency);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (nextCurrency: DisplayCurrency) => {
    setCurrency(nextCurrency);
    setIsOpen(false);
    onAction?.();
  };

  return (
    <div className="currency-switcher" ref={rootRef}>
      <button
        type="button"
        className="currency-switcher__trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Display currency: ${selectedOption.label}`}
        title={selectedOption.label}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span aria-hidden="true">{selectedOption.symbol}</span>
        {selectedOption.label}
        <span className="material-symbols-rounded currency-switcher__arrow" aria-hidden="true">
          arrow_drop_down
        </span>
      </button>
      {isOpen ? (
        <div className="currency-switcher__menu" role="menu" aria-label="Display currency options">
          {menuOptions.map((option) => (
            <button
              key={option.code}
              type="button"
              role="menuitem"
              onClick={() => handleSelect(option.code)}
              title={option.label}
            >
              <span aria-hidden="true">{option.symbol}</span>
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
