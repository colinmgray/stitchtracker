import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type {
  PatternData,
  PatternSource,
  SymbolAssets,
  StitchOccurrence,
  StitchSymbol,
} from '../types'

GlobalWorkerOptions.workerSrc = workerUrl

const BUNDLED_PATTERN_URL = './patterns/schema-bu5062.pdf'

type PdfTextItem = {
  str: string
  transform: number[]
  width: number
  fontName: string
}

function isTextItem(item: unknown): item is PdfTextItem {
  return typeof item === 'object' && item !== null && 'str' in item && 'transform' in item
}

function isStitchGlyph(item: PdfTextItem): boolean {
  const height = Math.abs(item.transform[3])
  return item.str.length === 1 && height > 2.5 && height < 5
}

export async function loadBundledPattern(): Promise<PatternSource> {
  const document = await getDocument({ url: BUNDLED_PATTERN_URL }).promise
  return { name: 'Birds on a branch', document, bundled: true }
}

export async function loadUploadedPattern(file: File): Promise<PatternSource> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const document = await getDocument({ data: bytes }).promise
  return { name: file.name.replace(/\.pdf$/i, ''), document, bundled: false }
}

export async function extractPattern(document: PDFDocumentProxy): Promise<PatternData> {
  const page = await document.getPage(1)
  const text = await page.getTextContent({ disableNormalization: true })
  const occurrences: StitchOccurrence[] = text.items.flatMap((item) => {
    if (!isTextItem(item) || !isStitchGlyph(item)) return []
    const key = `${item.fontName}:${item.str.codePointAt(0)}`
    return [
      {
        id: `${Math.round(item.transform[4] * 1000)}:${Math.round(item.transform[5] * 1000)}`,
        key,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: Math.abs(item.transform[3]),
        glyph: item.str,
        fontName: item.fontName,
      },
    ]
  })

  if (occurrences.length < 100) {
    throw new Error(
      'This PDF does not appear to contain individually positioned stitch symbols.',
    )
  }

  const grouped = new Map<string, StitchOccurrence[]>()
  const fontCounts = new Map<string, number>()
  for (const occurrence of occurrences) {
    const group = grouped.get(occurrence.key) ?? []
    group.push(occurrence)
    grouped.set(occurrence.key, group)
    fontCounts.set(occurrence.fontName, (fontCounts.get(occurrence.fontName) ?? 0) + 1)
  }

  const primaryFontName = Array.from(fontCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]

  const symbols: StitchSymbol[] = Array.from(grouped.entries())
    .map(([key, values], index) => ({
      key,
      label: `Color ${index + 1}`,
      count: values.length,
      sample: values[0],
      webGlyph:
        values[0].fontName === primaryFontName
          ? values[0].glyph
          : null,
    }))
    .sort((a, b) => b.count - a.count)
    .map((symbol, index) => ({ ...symbol, label: `Color ${index + 1}` }))

  return { occurrences, symbols }
}

export async function buildSymbolAssets(
  document: PDFDocumentProxy,
  pattern: PatternData,
): Promise<SymbolAssets> {
  const fallbackSymbols = pattern.symbols
  const fallbackImages = fallbackSymbols.length
    ? await extractFallbackGlyphs(document, fallbackSymbols)
    : new Map<string, string>()
  const colors = await extractSymbolColors(document, pattern)
  return { colors, fallbackImages }
}

async function renderPage(document: PDFDocumentProxy, pageNumber: number, scale: number) {
  const page = await document.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const canvas = window.document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
  if (!context) throw new Error('Canvas rendering is not available in this browser.')
  await page.render({ canvas, canvasContext: context, viewport }).promise
  return { canvas, context, viewport }
}

function cellRect(
  viewport: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['getViewport']>,
  occurrence: StitchOccurrence,
) {
  const [originX, baselineY] = viewport.convertToViewportPoint(
    occurrence.x,
    occurrence.y,
  )
  const cellSize = 4.16 * viewport.scale
  const glyphWidth = occurrence.width * viewport.scale
  return {
    left: originX - Math.max(0, (cellSize - glyphWidth) / 2),
    top: baselineY - cellSize / 2,
    size: cellSize,
  }
}

async function extractFallbackGlyphs(
  document: PDFDocumentProxy,
  symbols: StitchSymbol[],
): Promise<Map<string, string>> {
  const { canvas, viewport } = await renderPage(document, 1, 5)
  const images = new Map<string, string>()

  for (const symbol of symbols) {
    const rect = cellRect(viewport, symbol.sample)
    const inset = rect.size * 0.12
    const preview = window.document.createElement('canvas')
    preview.width = 64
    preview.height = 64
    const context = preview.getContext('2d', { willReadFrequently: true })
    if (!context) continue
    context.imageSmoothingEnabled = true
    context.drawImage(
      canvas,
      rect.left + inset,
      rect.top + inset,
      rect.size - inset * 2,
      rect.size - inset * 2,
      4,
      4,
      56,
      56,
    )

    const pixels = context.getImageData(0, 0, 64, 64)
    for (let i = 0; i < pixels.data.length; i += 4) {
      const pixel = i / 4
      const x = pixel % 64
      const y = Math.floor(pixel / 64)
      const red = pixels.data[i]
      const green = pixels.data[i + 1]
      const blue = pixels.data[i + 2]
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114
      const insideGlyphArea = x >= 9 && x <= 54 && y >= 9 && y <= 54
      const alpha = insideGlyphArea
        ? Math.max(0, Math.min(255, (225 - luminance) * 5))
        : 0
      pixels.data[i] = 20
      pixels.data[i + 1] = 39
      pixels.data[i + 2] = 36
      pixels.data[i + 3] = alpha
    }
    context.clearRect(0, 0, 64, 64)
    context.putImageData(pixels, 0, 0)
    images.set(symbol.key, preview.toDataURL('image/png'))
  }

  canvas.width = 1
  canvas.height = 1
  return images
}

async function extractSymbolColors(
  document: PDFDocumentProxy,
  pattern: PatternData,
): Promise<Map<string, string>> {
  const pageNumber = Math.min(2, document.numPages)
  const { canvas, context, viewport } = await renderPage(document, pageNumber, 4)
  const pagePixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const colors = new Map<string, string>()
  const occurrencesByKey = new Map<string, StitchOccurrence[]>()
  for (const occurrence of pattern.occurrences) {
    const group = occurrencesByKey.get(occurrence.key) ?? []
    group.push(occurrence)
    occurrencesByKey.set(occurrence.key, group)
  }

  const samplePoints = [
    [0.24, 0.24],
    [0.5, 0.24],
    [0.76, 0.24],
    [0.24, 0.5],
    [0.76, 0.5],
    [0.24, 0.76],
    [0.5, 0.76],
    [0.76, 0.76],
  ]

  for (const symbol of pattern.symbols) {
    const occurrences = occurrencesByKey.get(symbol.key) ?? []
    const step = Math.max(1, Math.floor(occurrences.length / 60))
    const samples: Array<[number, number, number]> = []

    for (let index = 0; index < occurrences.length && samples.length < 480; index += step) {
      const rect = cellRect(viewport, occurrences[index])
      for (const [fractionX, fractionY] of samplePoints) {
        const x = Math.max(0, Math.min(canvas.width - 1, Math.round(rect.left + rect.size * fractionX)))
        const y = Math.max(0, Math.min(canvas.height - 1, Math.round(rect.top + rect.size * fractionY)))
        const offset = (y * canvas.width + x) * 4
        samples.push([
          pagePixels[offset],
          pagePixels[offset + 1],
          pagePixels[offset + 2],
        ])
      }
    }

    colors.set(symbol.key, medianColor(samples))
  }

  canvas.width = 1
  canvas.height = 1
  return colors
}

function medianColor(samples: Array<[number, number, number]>): string {
  if (!samples.length) return '#f1e8d8'
  const median = (channel: 0 | 1 | 2) => {
    const values = samples.map((sample) => sample[channel]).sort((a, b) => a - b)
    return values[Math.floor(values.length / 2)]
  }
  return `#${([median(0), median(1), median(2)] as number[])
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`
}
