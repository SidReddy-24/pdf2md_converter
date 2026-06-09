# pdf2md.io

> **Convert PDF files to clean, structured Markdown — entirely in your browser.**  
> No uploads. No servers. No data ever leaves your computer.

---

## Table of Contents

- [Overview](#overview)
- [User Guide](#user-guide)
  - [Opening the App](#opening-the-app)
  - [Uploading PDFs](#uploading-pdfs)
  - [Understanding the Queue](#understanding-the-queue)
  - [Viewing the Output](#viewing-the-output)
  - [Downloading Results](#downloading-results)
  - [Tips & Limitations](#tips--limitations)
- [Developer Guide](#developer-guide)
  - [Tech Stack](#tech-stack)
  - [Project Structure](#project-structure)
  - [Getting Started](#getting-started)
  - [Architecture Overview](#architecture-overview)
  - [Core Modules](#core-modules)
  - [Key Design Decisions](#key-design-decisions)
  - [Scripts Reference](#scripts-reference)
  - [Extending the App](#extending-the-app)
  - [Deployment](#deployment)

---

## Overview

**pdf2md.io** is a fully client-side PDF-to-Markdown conversion tool. Upload one file, a handful of files, or an entire folder of PDFs and receive well-structured Markdown output in seconds — with the exact folder hierarchy preserved in the downloaded ZIP.

**Key features:**

| Feature | Details |
|---|---|
| 🔒 100% private | All processing happens in the browser — nothing is sent to a server |
| 📁 Folder uploads | Upload entire directory trees via drag-and-drop or the "Select Folder" button |
| 📂 Structure-preserving ZIP | Exported ZIP mirrors the original folder layout (`reports/Q1/file.md`) |
| 📄 Batch processing | Multiple PDFs queue automatically and convert one after another |
| ✏️ Live Markdown editor | Edit extracted text in the Raw Markdown tab before downloading |
| 👁️ Formatted preview | See a rendered HTML preview of the Markdown output side-by-side |

---

## User Guide

### Opening the App

Run the development server (see [Getting Started](#getting-started)) then open:

```
http://localhost:3000
```

You will see the dashboard with:

- A **stats bar** (queue count, pages processed, total size, system status)
- A **drop zone** for uploading files
- A **workspace** split into the file queue (left) and preview panel (right)

---

### Uploading PDFs

You have three ways to get files into the queue:

#### 1 — Drag & Drop
Drag any number of `.pdf` files **or whole folders** from your file manager and drop them onto the grey upload zone.

#### 2 — Select Files
Click the **Select Files** button (or click anywhere on the drop zone) to open a standard file picker. Hold `⌘` / `Ctrl` to select multiple files.

#### 3 — Select Folder
Click the **Select Folder** button. The entire folder tree is traversed recursively; only `.pdf` files are picked up. Sub-folder paths are remembered for the ZIP export.

> **Duplicate prevention:** If a file with the same name already exists in the queue it is silently skipped. Clear the queue first if you need to re-process a file.

---

### Understanding the Queue

The **Queue List** panel on the left shows every file you have added.

| Status badge | Meaning |
|---|---|
| `PENDING` | Waiting to be processed — will start automatically |
| `CONVERTING` (spinner) | Currently being parsed — shows live progress percentage |
| `READY` ✓ | Conversion succeeded — Markdown is available |
| `FAILED` ✗ | Something went wrong — hover the badge to see the error |

Use the **search box** to filter by filename and the **All / Completed / Processing / Pending / Error** dropdown to focus on a specific status.

Click any item in the queue to load its output in the preview panel on the right.

The **trash icon** on each item removes it from the queue. The **Clear Queue** button in the header removes everything at once.

---

### Viewing the Output

Once a file reaches `READY` status, select it in the queue. The right panel has two tabs:

| Tab | What you see |
|---|---|
| **Formatted Preview** | Rendered HTML — headings, bold text, lists, blockquotes, code |
| **Raw Markdown** | Editable plain-text Markdown. Changes are saved in-memory |

The toolbar above the preview shows:
- **File name** and size
- **Page count** parsed from the document
- **Copy** — copies the Markdown to your clipboard
- **Download** — saves a single `.md` file for the selected document

---

### Downloading Results

#### Single file
With a completed file selected, click the **Download** button in the preview toolbar. A `.md` file with the same base name as the PDF is saved.

#### All files as ZIP
Click **Export completed ZIP (n)** in the top header bar. A `markdown_conversions.zip` is downloaded containing every completed file.

**Folder structure is preserved inside the ZIP.** If you uploaded:

```
research/
  paper1.pdf
  sub/
    paper2.pdf
```

The ZIP will contain:

```
research/
  paper1.md
  sub/
    paper2.md
```

---

### Tips & Limitations

- **Text-based PDFs only.** Scanned PDFs (images of pages) contain no machine-readable text and will produce empty output. Use an OCR tool first.
- **Complex layouts.** Multi-column documents, footnotes, and tables may not be reconstructed perfectly — review the output and edit as needed in the Raw Markdown tab.
- **Large files.** Very large PDFs (100+ pages) may take several seconds because processing is entirely on the main thread. The progress bar gives live feedback.
- **Offline support.** After the first load the PDF.js worker is cached by the browser. Subsequent sessions work without an internet connection.
- **Editing is ephemeral.** Changes made in the Raw Markdown editor exist only in memory. Download your file before clearing the queue or closing the tab.

---

## Developer Guide

### Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org/) (App Router, Turbopack) |
| Language | TypeScript 5 |
| PDF parsing | [pdfjs-dist](https://github.com/mozilla/pdf.js) v6 |
| ZIP creation | [JSZip](https://stuk.github.io/jszip/) v3 |
| Icons | [lucide-react](https://lucide.dev/) |
| Styling | Vanilla CSS (CSS Custom Properties) |
| Fonts | Geist Sans + Geist Mono (via `next/font`) |

---

### Project Structure

```
pdf2md/
├── public/
│   └── pdf.worker.min.mjs      # PDF.js worker (auto-copied from node_modules)
├── src/
│   ├── app/
│   │   ├── globals.css          # Design system — all CSS custom properties + classes
│   │   ├── layout.tsx           # Root HTML layout, fonts, metadata
│   │   └── page.tsx             # Main application component (~900 lines)
│   ├── utils/
│   │   └── pdfParser.ts         # PDF → Markdown conversion logic
│   └── types/                   # (reserved for shared TypeScript types)
├── next.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

### Getting Started

#### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9

#### Install & run

```bash
# Clone the repository
git clone <repo-url>
cd pdf2md

# Install dependencies
npm install

# Start the development server (also copies the PDF.js worker to /public)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The dev script is:

```json
"dev": "cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/ && next dev"
```

The `cp` step ensures the worker file is always in sync with the installed `pdfjs-dist` version before Next.js starts, preventing the `"API version does not match Worker version"` error.

---

### Architecture Overview

```
Browser
│
├── page.tsx  (React state machine + UI)
│   │
│   ├── addFiles()          — normalises File[] into QueueFile[]
│   ├── traverseDirectory() — recursively walks FileSystemEntry trees
│   │                         and attaches relativePath to each File
│   ├── processNextFile()   — ref-based queue worker (useCallback, no
│   │                         cancellation on state updates)
│   └── handleDownloadZip() — builds structure-preserving ZIP via JSZip
│
└── pdfParser.ts  (pure async function, no React)
    │
    ├── import('pdfjs-dist')          — dynamic import (SSR-safe)
    ├── GlobalWorkerOptions.workerSrc — points to /pdf.worker.min.mjs
    ├── pdfjsLib.getDocument()        — opens the PDF
    ├── page.getTextContent()         — extracts raw text items per page
    ├── font-size frequency analysis  — determines body font size (mode)
    ├── Y-coordinate grouping         — reconstructs visual lines
    └── heading / bold / italic rules — emits Markdown tokens
```

---

### Core Modules

#### `src/utils/pdfParser.ts`

The single exported function:

```ts
convertPdfToMarkdown(
  arrayBuffer: ArrayBuffer,
  onProgress?: (current: number, total: number) => void
): Promise<string>
```

**Processing pipeline (two-pass):**

| Pass | What happens |
|---|---|
| Pass 1 — Analysis | Iterates every page, collects all text items with their `transform` matrix. Builds a frequency histogram of font sizes to identify the statistical mode (body text size). |
| Pass 2 — Rendering | Groups items into visual lines by Y-coordinate proximity (tolerance = `fontSize × 0.5`). Sorts lines top-to-bottom and items left-to-right. Applies heading rules (font size relative to body mode) and bold/italic detection via `fontName` strings. Assembles Markdown with `#`, `##`, `###`, `**`, `*`, `-` tokens. |

**Heading thresholds:**

| Condition | Output |
|---|---|
| `fontSize ≥ bodyFontSize × 2.0` | `# H1` |
| `fontSize ≥ bodyFontSize × 1.5` | `## H2` |
| `fontSize > bodyFontSize × 1.25` | `### H3` |
| `fontSize > bodyFontSize × 1.1` AND bold | `### H3` |

**Font detection:** `fontName` substrings `bold`, `black`, `heavy`, `semibold` → bold; `italic`, `oblique` → italic.

---

#### `src/app/page.tsx`

The entire UI lives in a single `Home` React component. Key state:

```ts
const [files, setFiles]               // QueueFile[] — the queue
const [selectedFileId, setSelectedFileId]
const [searchQuery, setSearchQuery]
const [statusFilter, setStatusFilter]
const [activeTab, setActiveTab]       // 'preview' | 'editor'
```

Key refs (used to avoid stale closures in the queue worker):

```ts
const filesRef         // always mirrors `files` state
const isProcessingRef  // mutex — prevents concurrent conversions
const isMountedRef     // guards setState after unmount
const originalFilesRef // Map<id, File> — preserves the original File object
```

**Queue worker pattern:**

The processing loop is implemented as a `useCallback`-wrapped async function (`processNextFile`) rather than a plain `useEffect`. This is critical:

- Standard `useEffect(() => {...}, [files])` cleans up (and therefore cancels) its inner async work every time `files` state changes — which happens on every progress update, killing the conversion at 5%.
- The ref-based approach reads from `filesRef.current` (always fresh) and uses `isProcessingRef` as a mutex, so state updates mid-conversion never interrupt the running task.

---

#### `src/app/globals.css`

All visual tokens are CSS custom properties on `:root`:

```css
--bg-deep          /* page background */
--bg-card          /* panel / card background */
--bg-card-hover    /* hover state */
--primary          /* action color (black in light mode) */
--text-main        /* body text */
--text-muted       /* secondary text */
--text-dim         /* tertiary / placeholder */
--border           /* default border */
--border-hover     /* highlighted border */
--success / --warning / --error   /* status colors */
```

All component classes (`.metric-card`, `.queue-item`, `.btn-primary`, etc.) consume only these variables, so switching themes requires changing only `:root` values.

---

### Key Design Decisions

#### Why no backend?
PDF parsing with PDF.js is mature and fast enough in a browser worker thread. Keeping everything client-side means zero infrastructure cost, zero privacy risk, and offline capability after first load.

#### Why copy the worker to `/public`?
Browsers enforce the **same-origin policy** for Web Workers. Loading a worker script from a CDN (`cdn.jsdelivr.net`) causes a cross-origin failure in most browsers. Serving the worker from the same origin (`/pdf.worker.min.mjs`) is the only reliable approach.

The `cp` in the `dev` and `build` scripts keeps the worker in sync automatically whenever `pdfjs-dist` is updated via `npm install`.

#### Why a ref-based queue worker instead of `useEffect`?
See [Queue worker pattern](#queue-worker-pattern) above. `useEffect` with `[files]` as a dependency cancels the async task on every intermediate state update, preventing the conversion from progressing beyond the initial 5% progress mark.

#### Why JSZip for directory-preserving export?
JSZip accepts arbitrary path strings as keys — `zip.file("folder/sub/file.md", content)` — and automatically creates the nested folder structure inside the archive. This maps directly onto the `relativePath` we capture from `FileSystemEntry.fullPath` or `File.webkitRelativePath`.

---

### Scripts Reference

| Script | Command | Description |
|---|---|---|
| `dev` | `npm run dev` | Copies worker, starts Next.js dev server with Turbopack HMR |
| `build` | `npm run build` | Copies worker, compiles production bundle |
| `start` | `npm start` | Serves the production build (run `build` first) |
| `lint` | `npm run lint` | Runs ESLint across the codebase |

---

### Extending the App

#### Add OCR support
Integrate [Tesseract.js](https://tesseract.projectnaptha.com/) as a fallback when `pdfParser` returns an empty string. Run it in a separate Web Worker to avoid blocking the UI.

#### Persist queue across sessions
Wrap `originalFilesRef` operations with the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) or serialize to `IndexedDB` using a library like `idb-keyval`.

#### Add table detection
In `pdfParser.ts`, after grouping items into lines, detect runs of lines where X-positions cluster into columns. Emit GitHub-Flavoured Markdown table syntax (`| col1 | col2 |`).

#### Theming
All colours live in `globals.css` `:root`. Add a `[data-theme="dark"]` selector block to re-declare the variables for dark mode, then toggle `document.documentElement.dataset.theme` from a button.

---

### Deployment

#### Vercel (recommended)

```bash
npm i -g vercel
vercel
```

Vercel automatically runs `npm run build` which copies the worker to `public/` before bundling. The output is a fully static site (`○` routes in the build output) — no server-side runtime required.

#### Docker / static hosting

```bash
npm run build
# Serve the .next/static output or use `next start`
```

For a fully static export (no Node.js server), add to `next.config.ts`:

```ts
const nextConfig: NextConfig = {
  output: 'export',
};
```

Then serve the `out/` directory with any static file host (Nginx, S3, Netlify, GitHub Pages).

> **Note:** Ensure your host serves `.mjs` files with `Content-Type: application/javascript`. Without this, the PDF.js worker will fail to initialise.

---

## License

MIT — do whatever you like with it.
