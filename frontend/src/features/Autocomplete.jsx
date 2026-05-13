/* ==========================================================================
   Autocomplete.jsx — Input with a suggestion dropdown. Used in the review
   form for customer/supplier names so reps don't retype existing parties.
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useEffect, useRef, useMemo } = React;
  const { cn } = window.App.utils;
  const { Icon } = window.App;

  /** Cache fetched distinct values per field across mounts. */
  const _cache = new Map();
  const _cacheStamp = new Map();
  const CACHE_TTL_MS = 60_000;

  async function fetchSuggestions(field) {
    const stamp = _cacheStamp.get(field) || 0;
    if (Date.now() - stamp < CACHE_TTL_MS && _cache.has(field)) {
      return _cache.get(field);
    }
    try {
      const values = await window.App.backend.getDistinct(field);
      _cache.set(field, values);
      _cacheStamp.set(field, Date.now());
      return values;
    } catch {
      return _cache.get(field) || [];
    }
  }

  // NOTE: Avoids `...rest` destructure (see Button.jsx) — explicit forwarding
  // of the input attrs we actually use.
  function Autocomplete(props) {
    const value = props.value;
    const onChange = props.onChange;
    const field = props.field;
    const placeholder = props.placeholder;
    const className = props.className ?? '';
    const [suggestions, setSuggestions] = useState([]);
    const [open, setOpen] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
      if (!loaded) return;
      const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
      window.addEventListener('mousedown', close);
      return () => window.removeEventListener('mousedown', close);
    }, [loaded]);

    const loadIfNeeded = async () => {
      if (loaded) return;
      const v = await fetchSuggestions(field);
      setSuggestions(v);
      setLoaded(true);
    };

    const filtered = useMemo(() => {
      const q = (value || '').trim().toLowerCase();
      if (!q) return suggestions.slice(0, 8);
      return suggestions
        .filter((s) => s && s.toLowerCase().includes(q) && s.toLowerCase() !== q)
        .slice(0, 8);
    }, [suggestions, value]);

    const pick = (v) => {
      onChange?.(v);
      setOpen(false);
    };

    return (
      <div className={cn('autocomplete', className)} ref={ref}>
        <input
          type="text"
          className="input"
          value={value ?? ''}
          onChange={(e) => { onChange?.(e.target.value); setOpen(true); }}
          onFocus={() => { loadIfNeeded(); setOpen(true); }}
          placeholder={placeholder}
          autoComplete="off"
          onBlur={props.onBlur}
          onKeyDown={props.onKeyDown}
          disabled={props.disabled}
          readOnly={props.readOnly}
          name={props.name}
          id={props.id}
          style={props.style}
          aria-label={props['aria-label']}
        />
        {open && filtered.length > 0 && (
          <div className="autocomplete-menu">
            {filtered.map((s, i) => (
              <button
                key={i}
                type="button"
                className="autocomplete-item"
                onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              >
                <Icon name="search" size={11} style={{ color: 'var(--text-subtle)' }} />
                <span>{s}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  window.App = window.App || {};
  window.App.Autocomplete = Autocomplete;
})();
