import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Icon } from "./ui";

export type SelectOption = { value: string; label: string };

type SelectProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Visible label above the trigger. Omit it and pass `ariaLabel` for compact selects. */
  label?: ReactNode;
  ariaLabel?: string;
  /** Submitted with the surrounding form, like a native select. */
  name?: string;
  /** Leading icon inside the trigger. */
  icon?: ReactNode;
  /** "field": bordered form control. "inline": borderless, for toolbars. */
  variant?: "field" | "inline";
  className?: string;
  disabled?: boolean;
};

/**
 * Custom listbox replacing the browser's native dropdown: ARIA listbox pattern with
 * full keyboard support (arrows, Home/End, Enter/Space, Escape, Tab, type-ahead).
 * The menu scales in from the edge it is anchored to, and opens upward near the
 * bottom of the screen.
 */
export function Select({
  value,
  options,
  onChange,
  label,
  ariaLabel,
  name,
  icon,
  variant = "field",
  className = "",
  disabled,
}: SelectProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const listId = `${id}-list`;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [upward, setUpward] = useState(false);
  const typeahead = useRef({ text: "", timer: 0 });

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIndex];

  const show = () => {
    if (disabled || !options.length) return;
    setActive(selectedIndex);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const choose = (index: number) => {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    close();
  };

  // Place before paint: open upward when the menu would run off the bottom of the screen.
  useLayoutEffect(() => {
    if (!open || !trigger.current || !list.current) return;
    const box = trigger.current.getBoundingClientRect();
    const height = list.current.offsetHeight;
    setUpward(box.bottom + height + 12 > window.innerHeight && box.top > height + 12);
    list.current.focus({ preventScroll: true });
  }, [open]);

  // Keep the active option in view while moving with the keyboard.
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  // A click anywhere else closes the menu, without stealing focus back.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const findByText = (key: string) => {
    const state = typeahead.current;
    window.clearTimeout(state.timer);
    state.text += key.toLowerCase();
    state.timer = window.setTimeout(() => (state.text = ""), 500);
    const start = open ? active : selectedIndex;
    const order = [...options.slice(start + 1), ...options.slice(0, start + 1)];
    const match = order.find((o) => o.label.toLowerCase().startsWith(state.text));
    return match ? options.indexOf(match) : -1;
  };

  const onTriggerKey = (e: KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      show();
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Like a native select: typing on the closed trigger changes the value.
      const index = findByText(e.key);
      if (index >= 0 && options[index].value !== value) onChange(options[index].value);
    }
  };

  const onListKey = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((i) => Math.min(last, i + 1)),
      ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      PageDown: () => setActive((i) => Math.min(last, i + 5)),
      PageUp: () => setActive((i) => Math.max(0, i - 5)),
      Enter: () => choose(active),
      " ": () => choose(active),
      // Escape closes only the menu, never the dialog around it.
      Escape: () => close(),
    };
    if (keys[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      keys[e.key]();
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const index = findByText(e.key);
      if (index >= 0) setActive(index);
    }
  };

  return (
    <div
      ref={root}
      className={`select select-${variant} ${open ? "is-open" : ""} ${className}`}
    >
      {label ? (
        <span className="select-label" id={labelId}>
          {label}
        </span>
      ) : null}
      <button
        ref={trigger}
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label ? undefined : ariaLabel}
        aria-labelledby={label ? `${labelId} ${valueId}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onTriggerKey}
      >
        {icon}
        <span className="select-value" id={valueId}>
          {selected?.label ?? ""}
        </span>
        <span className="select-chevron"><Icon name="down" /></span>
      </button>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {open ? (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={label ? labelId : undefined}
          aria-label={label ? undefined : ariaLabel}
          aria-activedescendant={`${id}-option-${active}`}
          className={`select-menu ${upward ? "upward" : ""}`}
          onKeyDown={onListKey}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-option-${index}`}
              data-index={index}
              role="option"
              aria-selected={option.value === value}
              className={index === active ? "active" : undefined}
              onPointerMove={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value ? <Icon name="check" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
