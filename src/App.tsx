import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist'
import { PatternViewer } from './components/PatternViewer'
import { SymbolPanel } from './components/SymbolPanel'
import { TransferDialog } from './components/TransferDialog'
import {
  extractPattern,
  extractFallbackGlyphs,
  extractSymbolColors,
  loadBundledPattern,
  loadUploadedPattern,
} from './pdf/pattern'
import type { PatternData, PatternSource } from './types'
import { loadProgress, saveProgress } from './storage/progress'

type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'saved' | 'saving' | 'error'

const EMPTY_PATTERN: PatternData = { occurrences: [], symbols: [] }

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const symbolImagesBuiltRef = useRef(false)
  const symbolColorsBuiltRef = useRef(false)
  const [source, setSource] = useState<PatternSource | null>(null)
  const [pattern, setPattern] = useState<PatternData>(EMPTY_PATTERN)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const [visibleSymbols, setVisibleSymbols] = useState<Set<string>>(new Set())
  const [activeSymbolKey, setActiveSymbolKey] = useState<string | null>(null)
  const [completedCells, setCompletedCells] = useState<Set<string>>(new Set())
  const [progressStorageKey, setProgressStorageKey] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [paintEnabled, setPaintEnabled] = useState(true)
  const [showCompleted, setShowCompleted] = useState(true)
  const [symbolImages, setSymbolImages] = useState<Map<string, string>>(new Map())
  const [symbolColors, setSymbolColors] = useState<Map<string, string>>(new Map())
  const [symbolsInView, setSymbolsInView] = useState<Set<string>>(new Set())
  const [pageNumber, setPageNumber] = useState(1)
  const [zoom, setZoom] = useState(1.25)
  const [transferOpen, setTransferOpen] = useState(false)

  async function ingest(nextSource: Promise<PatternSource>) {
    setLoadState('loading')
    setError('')
    try {
      const loaded = await nextSource
      const extracted = await extractPattern(loaded.document)
      const fingerprint = loaded.document.fingerprints?.[0] ?? loaded.name
      const storageKey = `stitchtracker:progress:${fingerprint}`
      const validIds = new Set(extracted.occurrences.map((item) => item.id))
      let savedCells = new Set<string>()
      const saved = await loadProgress(storageKey)
      savedCells = new Set(
        (saved?.completed ?? [])
          .map((id) => id.split(':').slice(-2).join(':'))
          .filter((id) => validIds.has(id)),
      )
      setSource(loaded)
      setPattern(extracted)
      setVisibleSymbols(new Set())
      setActiveSymbolKey(null)
      setCompletedCells(savedCells)
      setProgressStorageKey(storageKey)
      setSaveState('saved')
      symbolImagesBuiltRef.current = false
      symbolColorsBuiltRef.current = false
      setSymbolImages(new Map())
      setSymbolColors(new Map())
      setSymbolsInView(new Set(extracted.symbols.map((symbol) => symbol.key)))
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

  useEffect(() => {
    if (!progressStorageKey || loadState !== 'ready') return
    setSaveState('saving')
    const timer = window.setTimeout(() => {
      void saveProgress(progressStorageKey, {
          version: 1,
          completed: Array.from(completedCells),
          updatedAt: new Date().toISOString(),
        })
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [completedCells, loadState, progressStorageKey])

  async function handleUpload(file: File | undefined) {
    if (!file) return
    await ingest(loadUploadedPattern(file))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function toggleSymbol(key: string) {
    setVisibleSymbols((current) => {
      const next = new Set(current)
      if (!next.has(key)) {
        next.add(key)
        setActiveSymbolKey(key)
      } else if (activeSymbolKey === key) {
        next.delete(key)
        setActiveSymbolKey(null)
      } else {
        setActiveSymbolKey(key)
      }
      return next
    })
  }

  const completedBySymbol = useMemo(() => {
    const counts = new Map<string, number>()
    for (const occurrence of pattern.occurrences) {
      if (completedCells.has(occurrence.id)) {
        counts.set(occurrence.key, (counts.get(occurrence.key) ?? 0) + 1)
      }
    }
    return counts
  }, [completedCells, pattern.occurrences])

  const activeSymbol = pattern.symbols.find((symbol) => symbol.key === activeSymbolKey)
  const paletteSymbols = pattern.symbols.filter((symbol) => symbolsInView.has(symbol.key))
  const selectedStitchCount = pattern.symbols
    .filter((symbol) => visibleSymbols.has(symbol.key))
    .reduce((total, symbol) => total + symbol.count, 0)
  const totalProgress = pattern.occurrences.length
    ? Math.round((completedCells.size / pattern.occurrences.length) * 100)
    : 0

  function paintCell(id: string, completed: boolean) {
    setCompletedCells((current) => {
      if (current.has(id) === completed) return current
      const next = new Set(current)
      if (completed) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function clearSelection() {
    setVisibleSymbols(new Set())
    setActiveSymbolKey(null)
  }

  const updateSymbolsInView = useCallback((next: Set<string>) => {
    setSymbolsInView((current) => {
      if (current.size === next.size && Array.from(next).every((key) => current.has(key))) {
        return current
      }
      return next
    })
  }, [])

  const handlePageRendered = useCallback((
    renderedPageNumber: number,
    canvas: HTMLCanvasElement,
    viewport: PageViewport,
  ) => {
    if (renderedPageNumber === 1 && !symbolImagesBuiltRef.current) {
      symbolImagesBuiltRef.current = true
      setSymbolImages(extractFallbackGlyphs(canvas, viewport, pattern.symbols))
    }

    const isColorSource = renderedPageNumber === 2 || source?.document.numPages === 1
    if (isColorSource && !symbolColorsBuiltRef.current) {
      symbolColorsBuiltRef.current = true
      setSymbolColors(extractSymbolColors(canvas, viewport, pattern))
    }
  }, [pattern, source])

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
            className="secondary-button transfer-button"
            type="button"
            onClick={() => setTransferOpen(true)}
          >
            Transfer progress
          </button>
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
            symbols={paletteSymbols}
            totalSymbolCount={pattern.symbols.length}
            visibleSymbols={visibleSymbols}
            symbolImages={symbolImages}
            symbolColors={symbolColors}
            activeSymbolKey={activeSymbolKey}
            completedBySymbol={completedBySymbol}
            totalCompleted={completedCells.size}
            totalStitches={pattern.occurrences.length}
            selectedSymbolCount={visibleSymbols.size}
            selectedStitchCount={selectedStitchCount}
            onToggle={toggleSymbol}
            onClear={clearSelection}
          />

          <section className="viewer-column">
            <div className="pattern-toolbar">
              <div className="pattern-title">
                <p className="eyebrow">Current pattern</p>
                <h1>{source.name}</h1>
                <span>
                  {pattern.occurrences.length.toLocaleString()} stitches ·{' '}
                  {pattern.symbols.length} colors
                </span>
              </div>

              <div className="toolbar-controls">
                <div className="segmented-control" aria-label="Interaction mode">
                  <button
                    type="button"
                    className={paintEnabled ? 'active' : ''}
                    onClick={() => setPaintEnabled(true)}
                  >
                    Paint
                  </button>
                  <button
                    type="button"
                    className={!paintEnabled ? 'active' : ''}
                    onClick={() => setPaintEnabled(false)}
                  >
                    Navigate
                  </button>
                </div>

                <button
                  type="button"
                  className={`completed-toggle${showCompleted ? ' active' : ''}`}
                  aria-pressed={showCompleted}
                  onClick={() => setShowCompleted((value) => !value)}
                >
                  Completed
                </button>

                <div className="segmented-control" aria-label="Pattern view">
                  <button
                    type="button"
                    className={pageNumber === 1 ? 'active' : ''}
                    onClick={() => setPageNumber(1)}
                  >
                    Pattern
                  </button>
                  <button
                    type="button"
                    className={pageNumber === 2 ? 'active' : ''}
                    onClick={() => setPageNumber(2)}
                    disabled={source.document.numPages < 2}
                  >
                    Color chart
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
                    onClick={() => setZoom((value) => Math.min(5, value + 0.25))}
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
                completedCells={completedCells}
                activeSymbolKey={activeSymbolKey}
                showCompleted={showCompleted}
                paintEnabled={paintEnabled}
                zoom={zoom}
                onPaintCell={paintCell}
                onZoomChange={setZoom}
                onVisibleSymbolsChange={updateSymbolsInView}
                onPageRendered={handlePageRendered}
              />
            </div>

            <footer className="viewer-footer">
              <span>
                {activeSymbol ? (
                  <>
                    <kbd>Paint</kbd> {activeSymbol.label}:{' '}
                    {(completedBySymbol.get(activeSymbol.key) ?? 0).toLocaleString()} of{' '}
                    {activeSymbol.count.toLocaleString()} complete
                  </>
                ) : (
                  <>Choose a color on the left, then paint completed stitches</>
                )}
              </span>
              <span>
                {completedCells.size.toLocaleString()} of {pattern.occurrences.length.toLocaleString()}{' '}
                complete · {totalProgress}% ·{' '}
                {saveState === 'saving'
                  ? 'Saving…'
                  : saveState === 'error'
                    ? 'Could not save'
                    : 'Saved locally'}
              </span>
            </footer>
          </section>
        </main>
      )}

      {transferOpen && loadState === 'ready' && source && (
        <TransferDialog
          patternName={source.name}
          patternKey={progressStorageKey}
          completedCells={completedCells}
          validCellIds={new Set(pattern.occurrences.map((occurrence) => occurrence.id))}
          totalStitches={pattern.occurrences.length}
          onImport={setCompletedCells}
          onClose={() => setTransferOpen(false)}
        />
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
        <h1>Reading stitch colors…</h1>
        <p>The PDF stays in your browser while we map each color to its chart positions.</p>
      </div>
    </main>
  )
}
