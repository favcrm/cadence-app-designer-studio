import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  /** Accessible name for the listbox and the trigger. */
  label: string;
  /** Short visible prefix inside the trigger, e.g. "Sort". */
  prefix?: string;
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
}

/** A single-select listbox on the host kit's own select classes
 *  (.select/.select-trigger/.select-pop/.select-opt). The kit's popover is
 *  position: fixed, so it is placed from the trigger's rectangle. Keyboard:
 *  Enter/Space/ArrowDown opens; arrows, Home and End move; Enter or Space
 *  picks; Escape or Tab closes and returns focus to the trigger. */
export function Dropdown<T extends string>({ label, prefix, value, options, onChange }: Props<T>) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[selectedIndex];

  function show() {
    // Place before the first render so the list is visible (and focusable)
    // in the same commit that opens it.
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPlace({ top: rect.bottom + 4, left: rect.left, minWidth: rect.width });
    setActive(selectedIndex);
    setOpen(true);
  }
  function hide(focusTrigger: boolean) {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  }
  function pick(index: number) {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    hide(true);
  }

  useLayoutEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) hide(false);
    };
    const reflow = () => hide(false);
    document.addEventListener("pointerdown", away);
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", reflow, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", reflow, true);
    };
  }, [open]);

  function onTriggerKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      show();
    }
  }

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    const last = options.length - 1;
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); setActive((i) => Math.min(last, i + 1)); break;
      case "ArrowUp": event.preventDefault(); setActive((i) => Math.max(0, i - 1)); break;
      case "Home": event.preventDefault(); setActive(0); break;
      case "End": event.preventDefault(); setActive(last); break;
      case "Enter":
      case " ": event.preventDefault(); pick(active); break;
      case "Escape": event.preventDefault(); hide(true); break;
      case "Tab": hide(true); break;
    }
  }

  return (
    <div className="select select-sm ds-dropdown" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${label}: ${current?.label ?? ""}`}
        onClick={() => (open ? hide(false) : show())}
        onKeyDown={onTriggerKey}
      >
        <span className="select-value">
          {prefix && <span className="ds-dropdown-prefix">{prefix}:</span>} {current?.label}
        </span>
        <svg className="select-caret" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div className="select-pop" style={place ?? { visibility: "hidden" }}>
          <ul
            ref={list}
            id={`${id}-list`}
            className="select-list"
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={`${id}-opt-${active}`}
            onKeyDown={onListKey}
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                id={`${id}-opt-${index}`}
                role="option"
                className="select-opt"
                aria-selected={option.value === value}
                data-active={index === active ? "true" : undefined}
                onPointerEnter={() => setActive(index)}
                onClick={() => pick(index)}
              >
                <span className="select-check" aria-hidden="true">{option.value === value ? "✓" : ""}</span>
                <span className="select-label">{option.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
