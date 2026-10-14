import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist'
import type { StitchOccurrence } from '../types'

type PatternViewerProps = {
  document: PDFDocumentProxy
  pageNumber: number
  occurrences: StitchOccurrence[]
  visibleSymbols: Set<string>
  symbolColors: Map<string, string>
  completedCells: Set<string>
  activeSymbolKey: string | null
  showCompleted: boolean
  paintEnabled: boolean
  zoom: number
  onPaintCell: (id: string, completed: boolean) => void
  onZoomChange: (zoom: number) => void
  onVisibleSymbolsChange: (symbols: Set<string>) => void
}

type Point = { x: number; y: number }

type PinchState = {
  distance: number
  zoom: number
  midpoint: Point
  scrollLeft: number
  scrollTop: number
  frameLeft: number
  frameTop: number
}

const CELL_SIZE = 4.16
const MIN_ZOOM = 0.75
const MAX_ZOOM = 5

function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  )
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}

function midpoint(points: Point[]) {
  return {
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2,
  }
}

function pointerDistance(points: Point[]) {
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
}

export function PatternViewer({
  document,
  pageNumber,
  occurrences,
  visibleSymbols,
  symbolColors,
  completedCells,
  activeSymbolKey,
  showCompleted,
  paintEnabled,
  zoom,
  onPaintCell,
  onZoomChange,
  onVisibleSymbolsChange,
}: PatternViewerProps) {
  const baseCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const touchesRef = useRef(new Map<number, Point>())
  const pinchRef = useRef<PinchState | null>(null)
  const paintingRef = useRef(false)
  const paintValueRef = useRef(true)
  const lastPaintPointRef = useRef<Point | null>(null)
  const paintedCellsRef = useRef(new Set<string>())
  const zoomRef = useRef(zoom)
  const onZoomChangeRef = useRef(onZoomChange)
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [rendering, setRendering] = useState(true)

  useEffect(() => {
    zoomRef.current = zoom
    onZoomChangeRef.current = onZoomChange
  }, [onZoomChange, zoom])

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
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      })

      try {
        await renderTask.promise
      } catch (reason) {
        if (cancelled || (reason instanceof Error && reason.name === 'RenderingCancelledException')) {
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
    const frame = canvas?.closest('.viewer-frame') as HTMLElement | null
    if (!canvas || !frame) return
    type BrowserGestureEvent = Event & { scale?: number; clientX?: number; clientY?: number }
    let gestureStart: (PinchState & { clientX: number; clientY: number }) | null = null
    let lastWheelUpdate = 0

    const framePoint = (clientX?: number, clientY?: number) => {
      const bounds = frame.getBoundingClientRect()
      return {
        x: clientX ?? bounds.left + bounds.width / 2,
        y: clientY ?? bounds.top + bounds.height / 2,
        bounds,
      }
    }

    const beginNativeGesture = (event: BrowserGestureEvent) => {
      event.preventDefault()
      const point = framePoint(event.clientX, event.clientY)
      gestureStart = {
        distance: 1,
        zoom: zoomRef.current,
        midpoint: { x: point.x, y: point.y },
        scrollLeft: frame.scrollLeft,
        scrollTop: frame.scrollTop,
        frameLeft: point.bounds.left,
        frameTop: point.bounds.top,
        clientX: point.x,
        clientY: point.y,
      }
    }

    const changeNativeGesture = (event: BrowserGestureEvent) => {
      event.preventDefault()
      if (!gestureStart) beginNativeGesture(event)
      if (!gestureStart) return
      const nextZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, Math.round((gestureStart.zoom * (event.scale ?? 1)) * 4) / 4),
      )
      const scale = nextZoom / gestureStart.zoom
      const anchorX = gestureStart.scrollLeft + gestureStart.clientX - gestureStart.frameLeft
      const anchorY = gestureStart.scrollTop + gestureStart.clientY - gestureStart.frameTop
      frame.scrollLeft = anchorX * scale - (gestureStart.clientX - gestureStart.frameLeft)
      frame.scrollTop = anchorY * scale - (gestureStart.clientY - gestureStart.frameTop)
      if (nextZoom !== zoomRef.current) {
        zoomRef.current = nextZoom
        onZoomChangeRef.current(nextZoom)
      }
    }

    const handleTrackpadPinch = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const now = performance.now()
      if (now - lastWheelUpdate < 55) return
      lastWheelUpdate = now
      const previousZoom = zoomRef.current
      const nextZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, previousZoom + (event.deltaY < 0 ? 0.25 : -0.25)),
      )
      if (nextZoom === previousZoom) return
      const point = framePoint(event.clientX, event.clientY)
      const scale = nextZoom / previousZoom
      const anchorX = frame.scrollLeft + point.x - point.bounds.left
      const anchorY = frame.scrollTop + point.y - point.bounds.top
      frame.scrollLeft = anchorX * scale - (point.x - point.bounds.left)
      frame.scrollTop = anchorY * scale - (point.y - point.bounds.top)
      zoomRef.current = nextZoom
      onZoomChangeRef.current(nextZoom)
    }

    const preventMultiTouch = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault()
    }
    const endNativeGesture = () => {
      gestureStart = null
    }
    frame.addEventListener('touchstart', preventMultiTouch, { passive: false })
    frame.addEventListener('touchmove', preventMultiTouch, { passive: false })
    frame.addEventListener('gesturestart', beginNativeGesture, { passive: false })
    frame.addEventListener('gesturechange', changeNativeGesture, { passive: false })
    frame.addEventListener('gestureend', endNativeGesture, { passive: false })
    frame.addEventListener('wheel', handleTrackpadPinch, { passive: false })
    return () => {
      frame.removeEventListener('touchstart', preventMultiTouch)
      frame.removeEventListener('touchmove', preventMultiTouch)
      frame.removeEventListener('gesturestart', beginNativeGesture)
      frame.removeEventListener('gesturechange', changeNativeGesture)
      frame.removeEventListener('gestureend', endNativeGesture)
      frame.removeEventListener('wheel', handleTrackpadPinch)
    }
  }, [])

  function getCellRect(occurrence: StitchOccurrence) {
    if (!viewport) return null
    const [originX, baselineY] = viewport.convertToViewportPoint(occurrence.x, occurrence.y)
    const cellSize = CELL_SIZE * zoom
    const glyphWidth = occurrence.width * zoom
    return {
      left: originX - Math.max(0, (cellSize - glyphWidth) / 2),
      top: baselineY - cellSize / 2,
      size: cellSize,
    }
  }

  useEffect(() => {
    const canvas = overlayCanvasRef.current
    const frame = canvas?.closest('.viewer-frame') as HTMLElement | null
    if (!canvas || !frame || !viewport) return
    let animationFrame = 0

    const reportVisibleSymbols = () => {
      animationFrame = 0
      if (pageNumber !== 1) {
        onVisibleSymbolsChange(new Set(occurrences.map((occurrence) => occurrence.key)))
        return
      }

      const frameBounds = frame.getBoundingClientRect()
      const canvasBounds = canvas.getBoundingClientRect()
      const visible = new Set<string>()
      for (const occurrence of occurrences) {
        const rect = getCellRect(occurrence)
        if (!rect) continue
        const left = canvasBounds.left + rect.left
        const top = canvasBounds.top + rect.top
        if (
          left + rect.size >= frameBounds.left &&
          left <= frameBounds.right &&
          top + rect.size >= frameBounds.top &&
          top <= frameBounds.bottom
        ) {
          visible.add(occurrence.key)
        }
      }
      onVisibleSymbolsChange(visible)
    }

    const scheduleReport = () => {
      if (!animationFrame) animationFrame = window.requestAnimationFrame(reportVisibleSymbols)
    }
    const resizeObserver = new ResizeObserver(scheduleReport)
    resizeObserver.observe(frame)
    frame.addEventListener('scroll', scheduleReport, { passive: true })
    scheduleReport()
    return () => {
      frame.removeEventListener('scroll', scheduleReport)
      resizeObserver.disconnect()
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
    }
  }, [occurrences, onVisibleSymbolsChange, pageNumber, viewport, zoom])

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
    context.setTransform(outputScale, 0, 0, outputScale, 0, 0)
    context.clearRect(0, 0, viewport.width, viewport.height)

    if (pageNumber !== 1) return
    for (const occurrence of occurrences) {
      const rect = getCellRect(occurrence)
      if (!rect) continue

      if (visibleSymbols.has(occurrence.key)) {
        const color = symbolColors.get(occurrence.key) ?? '#ffcf4a'
        context.fillStyle = `${color}a8`
        context.fillRect(rect.left, rect.top, rect.size, rect.size)
        context.strokeStyle = `${color}dd`
        context.lineWidth = Math.max(0.5, zoom * 0.35)
        context.strokeRect(rect.left + 0.25, rect.top + 0.25, rect.size - 0.5, rect.size - 0.5)
      }

      if (showCompleted && completedCells.has(occurrence.id)) {
        context.fillStyle = 'rgba(21, 63, 58, 0.82)'
        context.fillRect(rect.left, rect.top, rect.size, rect.size)
        if (rect.size >= 6) {
          context.strokeStyle = '#ffffff'
          context.lineWidth = Math.max(1, rect.size * 0.12)
          context.lineCap = 'round'
          context.lineJoin = 'round'
          context.beginPath()
          context.moveTo(rect.left + rect.size * 0.24, rect.top + rect.size * 0.53)
          context.lineTo(rect.left + rect.size * 0.43, rect.top + rect.size * 0.71)
          context.lineTo(rect.left + rect.size * 0.77, rect.top + rect.size * 0.3)
          context.stroke()
        }
      }
    }
  }, [completedCells, occurrences, pageNumber, showCompleted, symbolColors, viewport, visibleSymbols, zoom])

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }

  function paintBetween(start: Point, end: Point) {
    if (!viewport || !activeSymbolKey || pageNumber !== 1) return
    const threshold = (CELL_SIZE * zoom) / 2
    for (const occurrence of occurrences) {
      if (occurrence.key !== activeSymbolKey || paintedCellsRef.current.has(occurrence.id)) continue
      const rect = getCellRect(occurrence)
      if (!rect) continue
      const center = { x: rect.left + rect.size / 2, y: rect.top + rect.size / 2 }
      if (distanceToSegment(center, start, end) <= threshold) {
        paintedCellsRef.current.add(occurrence.id)
        onPaintCell(occurrence.id, paintValueRef.current)
      }
    }
  }

  function beginPinch() {
    const points = Array.from(touchesRef.current.values())
    if (points.length < 2) return
    const frame = overlayCanvasRef.current?.closest('.viewer-frame') as HTMLElement | null
    if (!frame) return
    const frameBounds = frame.getBoundingClientRect()
    for (const id of paintedCellsRef.current) {
      onPaintCell(id, !paintValueRef.current)
    }
    paintedCellsRef.current.clear()
    paintingRef.current = false
    lastPaintPointRef.current = null
    pinchRef.current = {
      distance: Math.max(pointerDistance(points), 1),
      zoom,
      midpoint: midpoint(points),
      scrollLeft: frame.scrollLeft,
      scrollTop: frame.scrollTop,
      frameLeft: frameBounds.left,
      frameTop: frameBounds.top,
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = canvasPoint(event)

    if (event.pointerType === 'touch') {
      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touchesRef.current.size === 2) beginPinch()
      if (touchesRef.current.size > 1) return
    }

    if (!paintEnabled || !activeSymbolKey || pageNumber !== 1) return
    const hit = occurrences.find((occurrence) => {
      if (occurrence.key !== activeSymbolKey) return false
      const rect = getCellRect(occurrence)
      return Boolean(
        rect &&
          point.x >= rect.left &&
          point.x <= rect.left + rect.size &&
          point.y >= rect.top &&
          point.y <= rect.top + rect.size,
      )
    })
    if (!hit) return
    paintingRef.current = true
    paintValueRef.current = !completedCells.has(hit.id)
    paintedCellsRef.current = new Set()
    lastPaintPointRef.current = point
    paintBetween(point, point)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.preventDefault()
    const point = canvasPoint(event)
    if (event.pointerType === 'touch' && touchesRef.current.has(event.pointerId)) {
      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touchesRef.current.size >= 2 && pinchRef.current) {
        const points = Array.from(touchesRef.current.values())
        const currentMidpoint = midpoint(points)
        const ratio = pointerDistance(points) / pinchRef.current.distance
        const nextZoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, Math.round((pinchRef.current.zoom * ratio) * 4) / 4),
        )
        const frame = event.currentTarget.closest('.viewer-frame') as HTMLElement | null
        if (frame) {
          const scale = nextZoom / pinchRef.current.zoom
          const anchorX =
            pinchRef.current.scrollLeft +
            pinchRef.current.midpoint.x -
            pinchRef.current.frameLeft
          const anchorY =
            pinchRef.current.scrollTop +
            pinchRef.current.midpoint.y -
            pinchRef.current.frameTop
          frame.scrollLeft =
            anchorX * scale - (currentMidpoint.x - pinchRef.current.frameLeft)
          frame.scrollTop =
            anchorY * scale - (currentMidpoint.y - pinchRef.current.frameTop)
        }
        if (nextZoom !== zoom) onZoomChange(nextZoom)
        return
      }
    }

    if (!paintingRef.current || !lastPaintPointRef.current) return
    paintBetween(lastPaintPointRef.current, point)
    lastPaintPointRef.current = point
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'touch') {
      touchesRef.current.delete(event.pointerId)
      if (touchesRef.current.size < 2) pinchRef.current = null
    }
    if (touchesRef.current.size === 0 || event.pointerType !== 'touch') {
      paintingRef.current = false
      lastPaintPointRef.current = null
      paintedCellsRef.current.clear()
    }
  }

  return (
    <div className="pattern-stage" aria-busy={rendering}>
      <div className="canvas-stack">
        <canvas ref={baseCanvasRef} aria-label={`Pattern page ${pageNumber}`} />
        <canvas
          ref={overlayCanvasRef}
          className={`overlay-canvas${paintEnabled && activeSymbolKey ? ' paint-enabled' : ''}`}
          aria-label={paintEnabled ? 'Paint completed stitches' : 'Pattern highlights'}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        />
      </div>
      {rendering && (
        <div className="rendering-badge">
          <span className="spinner" /> Rendering pattern
        </div>
      )}
    </div>
  )
}
