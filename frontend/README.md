# Foundry — PO Capture (Frontend)

Modular React UI for purchase-order extraction. Standalone for now; will plug into a Streamlit backend next.

## Run

The app needs a local HTTP server because Babel-Standalone fetches the `.jsx` files via XHR (which is blocked on `file://`).

**Windows (one click):**
```
start.bat
```

**Cross-platform (manual):**
```
cd frontend
python -m http.server 8000
# Then open http://localhost:8000
```

If Python isn't available, any static server works — `npx serve`, `npx http-server`, etc.

## Try it

Drag any of the three sample POs from the parent directory onto the dropzone:
- `Meridian_Supply_PO_13214085.pdf`
- `Summit_Industrial_PO_115835 (1).pdf`
- `Apex_Power_Group_FL_PO_13213236.pdf`

The mock extractor matches on filename and returns the corresponding extracted data. Drop any other file to get a blank scaffold to fill manually.

## Structure

```
frontend/
├── index.html             # script load order
├── styles.css             # design system + component styles
├── start.bat              # local server bootstrap (Windows)
└── src/
    ├── lib/
    │   ├── utils.js       # formatters, classnames, ids
    │   ├── mockData.js    # extracted data for the 3 sample POs
    │   ├── mockApi.js     # simulated LLM extraction (replaced by Streamlit)
    │   ├── excel.js       # SheetJS two-sheet export
    │   └── hooks.jsx      # useLocalStorage, useToasts, useDragDrop
    ├── components/        # generic atoms (Button, Card, Icon, Badge, ...)
    ├── layout/            # Sidebar, TopBar
    ├── features/          # PO-specific composites (POHeader, LineItemsTable, ...)
    ├── views/             # UploadView, ReviewView, RepositoryView, SettingsView
    ├── App.jsx            # root component, view routing, state
    └── main.jsx           # boot
```

Each file is an IIFE that registers components/utilities on `window.App`. This lets us split into ~25 small files without an ES-module bundler.

## What's mocked vs. real

| Piece | State |
|---|---|
| Drag-and-drop UX | ✅ Real |
| File parsing | ❌ Mocked (returns canned data based on filename) |
| LLM extraction | ❌ Mocked (1.5s delay then returns sample) |
| Editable review form | ✅ Real |
| Excel export (two-sheet) | ✅ Real (SheetJS) |
| Local persistence | ✅ Real (browser localStorage) |
| Multi-rep collaboration | ❌ Single-user only for now |

Once Streamlit is wired in, the mocks in `lib/mockApi.js` and `lib/excel.js` will be swapped for backend calls.
