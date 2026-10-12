import type { StitchSymbol } from '../types'

type SymbolPanelProps = {
  symbols: StitchSymbol[]
  visibleSymbols: Set<string>
  symbolImages: Map<string, string>
  symbolColors: Map<string, string>
  useEmbeddedWebFont: boolean
  onToggle: (key: string) => void
  onClear: () => void
}

export function SymbolPanel({
  symbols,
  visibleSymbols,
  symbolImages,
  symbolColors,
  useEmbeddedWebFont,
  onToggle,
  onClear,
}: SymbolPanelProps) {
  const visibleCount = symbols
    .filter((symbol) => visibleSymbols.has(symbol.key))
    .reduce((sum, symbol) => sum + symbol.count, 0)

  return (
    <aside className="symbol-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Pattern palette</p>
          <h2>Stitch symbols</h2>
        </div>
        <span className="symbol-total">{symbols.length}</span>
      </div>

      <p className="panel-help">
        Select one or more symbols to reveal every matching stitch on the chart.
      </p>

      <div className="selection-summary" aria-live="polite">
        <span>{visibleSymbols.size} selected</span>
        <strong>{visibleCount.toLocaleString()} stitches</strong>
        <button type="button" onClick={onClear} disabled={visibleSymbols.size === 0}>
          Clear
        </button>
      </div>

      <div className="symbol-grid">
        {symbols.map((symbol) => {
          const selected = visibleSymbols.has(symbol.key)
          return (
            <button
              type="button"
              key={symbol.key}
              className={`symbol-card${selected ? ' selected' : ''}`}
              aria-pressed={selected}
              onClick={() => onToggle(symbol.key)}
              title={`${symbol.label}: ${symbol.count.toLocaleString()} stitches`}
            >
              <span
                className="symbol-preview"
                aria-hidden="true"
                style={{ backgroundColor: symbolColors.get(symbol.key) ?? '#f7f3e8' }}
              >
                {useEmbeddedWebFont && symbol.webGlyph ? (
                  <span className="extracted-glyph">{symbol.webGlyph}</span>
                ) : symbolImages.has(symbol.key) ? (
                  <img src={symbolImages.get(symbol.key)} alt="" />
                ) : (
                  <span className="symbol-placeholder" />
                )}
              </span>
              <span className="symbol-copy">
                <span>{symbol.label}</span>
                <small>{symbol.count.toLocaleString()}</small>
              </span>
              <span className="visibility-dot" aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </aside>
  )
}
