import { useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PatternViewer } from './components/PatternViewer'
import { SymbolPanel } from './components/SymbolPanel'
import {
  extractPattern,
  buildSymbolAssets,
  loadBundledPattern,
  loadUploadedPattern,
} from './pdf/pattern'
import type { PatternData, PatternSource } from './types'

type LoadState = 'loading' | 'ready' | 'error'

const EMPTY_PATTERN: PatternData = { occurrences: [], symbols: [] }

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<PatternSource | null>(null)
  const [pattern, setPattern] = useState<PatternData>(EMPTY_PATTERN)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const [visibleSymbols, setVisibleSymbols] = useState<Set<string>>(new Set())
  const [symbolImages, setSymbolImages] = useState<Map<string, string>>(new Map())
  const [symbolColors, setSymbolColors] = useState<Map<string, string>>(new Map())
  const [pageNumber, setPageNumber] = useState(1)
  const [zoom, setZoom] = useState(1.25)

  async function ingest(nextSource: Promise<PatternSource>) {
    setLoadState('loading')
    setError('')
    try {
      const loaded = await nextSource
      const extracted = await extractPattern(loaded.document)
      const assets = await buildSymbolAssets(loaded.document, extracted)
      setSource(loaded)
      setPattern(extracted)
      setVisibleSymbols(new Set())
      setSymbolImages(assets.fallbackImages)
      setSymbolColors(assets.colors)
      setPageNumber(1)
      setLoadState('ready')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'The pattern could not be opened.'
      setError(message)
      setLoadState('error')
    }
  }

  useEffect(() => {
    void ingest(loadBundledPattern())
  }, [])

  async function handleUpload(file: File | undefined) {
    if (!file) return
    await ingest(loadUploadedPattern(file))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function toggleSymbol(key: string) {
    setVisibleSymbols((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const progress = useMemo(() => {
    if (!pattern.occurrences.length) return 0
    return Math.round(
      (Array.from(visibleSymbols).reduce(
        (total, key) =>
          total + pattern.occurrences.filter((item) => item.key === key).length,
        0,
      ) /
        pattern.occurrences.length) *
        100,
    )
  }, [pattern.occurrences, visibleSymbols])

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="./" aria-label="StitchTracker home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <span>
            <strong>StitchTracker</strong>
            <small>Pattern companion</small>
          </span>
        </a>

        <div className="header-actions">
          <span className="privacy-note">
            <span className="privacy-dot" /> Stays on this device
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(event) => void handleUpload(event.target.files?.[0])}
          />
          <button
            className="secondary-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Open another PDF
          </button>
        </div>
      </header>

      {loadState === 'loading' && <LoadingScreen />}

      {loadState === 'error' && (
        <main className="message-screen">
          <div className="message-card error-card">
            <span className="message-icon">!</span>
            <p className="eyebrow">Ingestion stopped</p>
            <h1>We couldn’t read this pattern</h1>
            <p>{error}</p>
            <button
              type="button"
              className="primary-button"
              onClick={() => void ingest(loadBundledPattern())}
            >
              Return to bundled pattern
            </button>
          </div>
        </main>
      )}

      {loadState === 'ready' && source && (
        <main className="workspace">
          <SymbolPanel
            symbols={pattern.symbols}
            visibleSymbols={visibleSymbols}
            symbolImages={symbolImages}
            symbolColors={symbolColors}
            useEmbeddedWebFont={source.bundled}
            onToggle={toggleSymbol}
            onClear={() => setVisibleSymbols(new Set())}
          />

          <section className="viewer-column">
            <div className="pattern-toolbar">
              <div className="pattern-title">
                <p className="eyebrow">Current pattern</p>
                <h1>{source.name}</h1>
                <span>
                  {pattern.occurrences.length.toLocaleString()} stitches ·{' '}
                  {pattern.symbols.length} symbols
                </span>
              </div>

              <div className="toolbar-controls">
                <div className="segmented-control" aria-label="Pattern view">
                  <button
                    type="button"
                    className={pageNumber === 1 ? 'active' : ''}
                    onClick={() => setPageNumber(1)}
                  >
                    Symbols
                  </button>
                  <button
                    type="button"
                    className={pageNumber === 2 ? 'active' : ''}
                    onClick={() => setPageNumber(2)}
                    disabled={source.document.numPages < 2}
                  >
                    Color
                  </button>
                </div>

                <div className="zoom-control" aria-label="Zoom controls">
                  <button
                    type="button"
                    aria-label="Zoom out"
                    onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}
                  >
                    −
                  </button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button
                    type="button"
                    aria-label="Zoom in"
                    onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="viewer-frame">
              <PatternViewer
                document={source.document as PDFDocumentProxy}
                pageNumber={pageNumber}
                occurrences={pattern.occurrences}
                visibleSymbols={visibleSymbols}
                symbolColors={symbolColors}
                zoom={zoom}
              />
            </div>

            <footer className="viewer-footer">
              <span>
                <kbd>Click</kbd> symbols in the left panel to highlight them
              </span>
              <span>{progress}% of chart currently visible</span>
            </footer>
          </section>
        </main>
      )}
    </div>
  )
}

function LoadingScreen() {
  return (
    <main className="message-screen">
      <div className="message-card">
        <span className="loading-glyph" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <p className="eyebrow">Preparing your chart</p>
        <h1>Reading stitch symbols…</h1>
        <p>The PDF stays in your browser while we map each symbol to its position.</p>
      </div>
    </main>
  )
}
