import { useId, useState } from 'react';
import { findStation, searchStations, type Station } from '../lib/stations';

interface Props {
  label: string;
  value: string;
  onChange: (code: string) => void;
  /** Called when the user picks a station from the list. */
  onSelect: (station: Station) => void;
  error?: string;
  name: string;
}

/**
 * Station code input with autocomplete (WAI-ARIA 1.2 combobox pattern).
 * Matches by code or name; any 1-5 letter code can also be typed directly.
 */
export function StationCombobox({ label, value, onChange, onSelect, error, name }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const options = open ? searchStations(value) : [];
  const expanded = options.length > 0;
  const matched = findStation(value);

  const choose = (s: Station) => {
    onChange(s.code);
    onSelect(s);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (options.length ? (i + 1) % options.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (options.length ? (i <= 0 ? options.length - 1 : i - 1) : -1));
    } else if (e.key === 'Enter' && expanded && active >= 0) {
      e.preventDefault();
      choose(options[active]!);
    } else if (e.key === 'Escape' && expanded) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  const describedBy = [error ? errorId : null, hintId].filter(Boolean).join(' ');

  return (
    <div className="relative">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        role="combobox"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="Code or name"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? `${id}-opt-${active}` : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="field-input uppercase placeholder:normal-case"
      />
      <p id={hintId} className="mt-1 min-h-5 text-sm text-muted">
        {matched ? matched.name : ''}
      </p>
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label={`${label} suggestions`}
        hidden={!expanded}
        className="absolute inset-x-0 top-[4.75rem] z-20 max-h-72 overflow-auto rounded-xl border border-line bg-card py-1 shadow-lg"
      >
        {options.map((s, i) => (
          <li
            key={s.code}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(s)}
            onMouseEnter={() => setActive(i)}
            className={`flex cursor-pointer items-baseline gap-3 px-3 py-2 ${
              i === active ? 'bg-teal-soft' : ''
            }`}
          >
            <span className="w-12 shrink-0 font-mono text-sm font-semibold">{s.code}</span>
            <span className="text-sm">{s.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
