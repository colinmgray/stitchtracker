import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist'
import type { StitchOccurrence } from '../types'

type PatternViewerProps = {
  document: PDFDocumentProxy
  pageNumber: number
  occurrences: StitchOccurrence[]
  visibleSymbols: Set<string>
  symbolColors: Map<string, string>
  zoom: number
}

export function PatternViewer({
  document,
  pageNumber,
  occurrences,
  visibleSymbols,
  symbolColors,
  zoom,
}: PatternViewerProps) {
  const baseCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [rendering, setRendering] = useState(true)

  useEffect(() => {
    let cancelled = false
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null

    async function renderPage() {
      setRendering(true)
      const page = await document.getPage(pageNumber)
      if (cancelled) return

      const nextViewport = page.getViewport({ scale: zoom })
      const canvas = baseCanvasRef.current
      if (!canvas) return
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) return

      const outputScale = window.devicePixelRatio || 1
      canvas.width = Math.floor(nextViewport.width * outputScale)
      canvas.height = Math.floor(nextViewport.height * outputScale)
      canvas.style.width = `${nextViewport.width}px`
      canvas.style.height = `${nextViewport.height}px`

      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport: nextViewport,
        transform:
          outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      })

      try {
        await renderTask.promise
      } catch (reason) {
        if (
          cancelled ||
          (reason instanceof Error && reason.name === 'RenderingCancelledException')
        ) {
          return
        }
        throw reason
      }
      if (!cancelled) {
        setViewport(nextViewport)
        setRendering(false)
      }
    }

    void renderPage()
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [document, pageNumber, zoom])

  useEffect(() => {
    const canvas = overlayCanvasRef.current
    if (!canvas || !viewport) return

    const outputScale = window.devicePixelRatio || 1
    canvas.width = Math.floor(viewport.width * outputScale)
    canvas.height = Math.floor(viewport.height * outputScale)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.scale(outputScale, outputScale)
    context.clearRect(0, 0, viewport.width, viewport.height)

    const cellSize = 4.16 * zoom
    for (const occurrence of occurrences) {
      if (!visibleSymbols.has(occurrence.key)) continue
      const color = symbolColors.get(occurrence.key) ?? '#ffcf4a'

      const [originX, baselineY] = viewport.convertToViewportPoint(
        occurrence.x,
        occurrence.y,
      )
      const glyphWidth = occurrence.width * zoom
      const glyphHeight = occurrence.height * zoom
      const left = originX - Math.max(0, (cellSize - glyphWidth) / 2)
      const top = baselineY - glyphHeight - Math.max(0, (cellSize - glyphHeight) / 2)

      context.fillStyle = `${color}a8`
      context.fillRect(left, top, cellSize, cellSize)
      context.strokeStyle = `${color}dd`
      context.lineWidth = Math.max(0.5, zoom * 0.35)
      context.strokeRect(left + 0.25, top + 0.25, cellSize - 0.5, cellSize - 0.5)
    }
  }, [occurrences, symbolColors, viewport, visibleSymbols, zoom])

  return (
    <div className="pattern-stage" aria-busy={rendering}>
      <div className="canvas-stack">
        <canvas ref={baseCanvasRef} aria-label={`Pattern page ${pageNumber}`} />
        <canvas ref={overlayCanvasRef} className="overlay-canvas" aria-hidden="true" />
      </div>
      {rendering && (
        <div className="rendering-badge">
          <span className="spinner" /> Rendering pattern
        </div>
      )}
    </div>
  )
}
