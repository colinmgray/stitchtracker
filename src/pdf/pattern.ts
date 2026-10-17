import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PageViewport,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type {
  PatternData,
  PatternSource,
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
  const textItems: unknown[] = []
  const reader = page
    .streamTextContent({ disableNormalization: true })
    .getReader()

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      textItems.push(...value.items)
    }
  } finally {
    reader.releaseLock()
  }

  const occurrences: StitchOccurrence[] = textItems.flatMap((item) => {
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

function cellRect(
  viewport: PageViewport,
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

export function extractFallbackGlyphs(
  canvas: HTMLCanvasElement,
  viewport: PageViewport,
  symbols: StitchSymbol[],
): Map<string, string> {
  const images = new Map<string, string>()
  const outputScale = canvas.width / viewport.width

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
      (rect.left + inset) * outputScale,
      (rect.top + inset) * outputScale,
      (rect.size - inset * 2) * outputScale,
      (rect.size - inset * 2) * outputScale,
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

  return images
}

export function extractSymbolColors(
  canvas: HTMLCanvasElement,
  viewport: PageViewport,
  pattern: PatternData,
): Map<string, string> {
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
  if (!context) return new Map()
  const pagePixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const outputScale = canvas.width / viewport.width
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
        const x = Math.max(
          0,
          Math.min(
            canvas.width - 1,
            Math.round((rect.left + rect.size * fractionX) * outputScale),
          ),
        )
        const y = Math.max(
          0,
          Math.min(
            canvas.height - 1,
            Math.round((rect.top + rect.size * fractionY) * outputScale),
          ),
        )
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
