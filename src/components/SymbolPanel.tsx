import type { StitchSymbol } from '../types'

type SymbolPanelProps = {
  symbols: StitchSymbol[]
  totalSymbolCount: number
  visibleSymbols: Set<string>
  symbolImages: Map<string, string>
  symbolColors: Map<string, string>
  activeSymbolKey: string | null
  completedBySymbol: Map<string, number>
  totalCompleted: number
  totalStitches: number
  selectedSymbolCount: number
  selectedStitchCount: number
  onToggle: (key: string) => void
  onClear: () => void
}

export function SymbolPanel({
  symbols,
  totalSymbolCount,
  visibleSymbols,
  symbolImages,
  symbolColors,
  activeSymbolKey,
  completedBySymbol,
  totalCompleted,
  totalStitches,
  selectedSymbolCount,
  selectedStitchCount,
  onToggle,
  onClear,
}: SymbolPanelProps) {
  const progress = totalStitches ? Math.round((totalCompleted / totalStitches) * 100) : 0

  return (
    <aside className="symbol-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Pattern palette</p>
          <h2>Thread colors</h2>
        </div>
        <span className="symbol-total">
          {symbols.length === totalSymbolCount ? symbols.length : `${symbols.length}/${totalSymbolCount}`}
        </span>
      </div>

      <p className="panel-help">
        Showing colors in the visible chart area. Select one, then paint completed stitches.
      </p>

      <div className="project-progress" aria-label={`Project ${progress}% complete`}>
        <div>
          <span>Project progress</span>
          <strong>{progress}%</strong>
        </div>
        <div className="progress-track">
          <span style={{ width: `${progress}%` }} />
        </div>
        <small>
          {totalCompleted.toLocaleString()} of {totalStitches.toLocaleString()} stitches
        </small>
      </div>

      <div className="selection-summary" aria-live="polite">
        <span>{selectedSymbolCount} selected</span>
        <strong>{selectedStitchCount.toLocaleString()} stitches</strong>
        <button type="button" onClick={onClear} disabled={selectedSymbolCount === 0}>
          Clear
        </button>
      </div>

      <div className="symbol-grid">
        {symbols.length === 0 && (
          <p className="empty-palette">No stitch colors are visible in this part of the chart.</p>
        )}
        {symbols.map((symbol) => {
          const selected = visibleSymbols.has(symbol.key)
          const active = activeSymbolKey === symbol.key
          const completed = completedBySymbol.get(symbol.key) ?? 0
          return (
            <button
              type="button"
              key={symbol.key}
              className={`symbol-card${selected ? ' selected' : ''}${active ? ' active' : ''}`}
              aria-pressed={selected}
              onClick={() => onToggle(symbol.key)}
              title={`${symbol.label}: ${symbol.count.toLocaleString()} stitches`}
            >
              <span
                className="symbol-preview"
                aria-hidden="true"
                style={{ backgroundColor: symbolColors.get(symbol.key) ?? '#f7f3e8' }}
              >
                {symbolImages.has(symbol.key) ? (
                  <img src={symbolImages.get(symbol.key)} alt="" />
                ) : (
                  <span className="symbol-placeholder" />
                )}
              </span>
              <span className="symbol-copy">
                <span>{symbol.label}</span>
                <small>
                  {completed.toLocaleString()} / {symbol.count.toLocaleString()}
                </small>
              </span>
              <span className="visibility-dot" aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </aside>
  )
}
