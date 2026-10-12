import type { PDFDocumentProxy } from 'pdfjs-dist'

export type PatternSource = {
  name: string
  document: PDFDocumentProxy
  bundled: boolean
}

export type StitchOccurrence = {
  key: string
  x: number
  y: number
  width: number
  height: number
  glyph: string
  fontName: string
}

export type StitchSymbol = {
  key: string
  label: string
  count: number
  sample: StitchOccurrence
  webGlyph: string | null
}

export type PatternData = {
  occurrences: StitchOccurrence[]
  symbols: StitchSymbol[]
}

export type SymbolAssets = {
  colors: Map<string, string>
  fallbackImages: Map<string, string>
}
