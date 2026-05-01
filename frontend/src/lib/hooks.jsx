/* ==========================================================================
   hooks.jsx — Custom React hooks (localStorage, toasts, drag/drop).
   ========================================================================== */
(() => {
  'use strict';
  const { useState, useEffect, useRef, useCallback } = React;

  function useLocalStorage(key, initialValue) {
    const [value, setValue] = useState(() => {
      try {
        const raw = window.localStorage.getItem(key);
        return raw !== null ? JSON.parse(raw) : initialValue;
      } catch {
        return initialValue;
      }
    });

    useEffect(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        console.warn('useLocalStorage: failed to persist', e);
      }
    }, [key, value]);

    return [value, setValue];
  }

  function useToasts() {
    const [toasts, setToasts] = useState([]);
    const timers = useRef({});

    const dismiss = useCallback((id) => {
      setToasts((curr) => curr.filter((t) => t.id !== id));
      if (timers.current[id]) {
        clearTimeout(timers.current[id]);
        delete timers.current[id];
      }
    }, []);

    const push = useCallback((toast) => {
      const id = window.App.utils.uuid();
      const t = { id, type: 'info', duration: 3500, ...toast };
      setToasts((curr) => [...curr, t]);
      if (t.duration > 0) {
        timers.current[id] = setTimeout(() => dismiss(id), t.duration);
      }
      return id;
    }, [dismiss]);

    useEffect(() => {
      return () => {
        Object.values(timers.current).forEach(clearTimeout);
        timers.current = {};
      };
    }, []);

    return { toasts, push, dismiss };
  }

  function useDragDrop({ onFiles }) {
    const [isOver, setIsOver] = useState(false);
    const dragCounter = useRef(0);

    const handlers = {
      onDragEnter: (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current += 1;
        if (dragCounter.current === 1) setIsOver(true);
      },
      onDragLeave: (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) {
          dragCounter.current = 0;
          setIsOver(false);
        }
      },
      onDragOver: (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      },
      onDrop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current = 0;
        setIsOver(false);
        const files = Array.from(e.dataTransfer?.files || []);
        if (files.length > 0) onFiles(files);
      },
    };

    return { isOver, handlers };
  }

  function useKeyboardShortcut(key, callback, deps = []) {
    useEffect(() => {
      const handler = (e) => {
        if (e.key === key) callback(e);
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
       // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
  }

  window.App = window.App || {};
  window.App.hooks = { useLocalStorage, useToasts, useDragDrop, useKeyboardShortcut };
})();
