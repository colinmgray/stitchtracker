import { useEffect, useRef, useState } from 'react'

type TransferDialogProps = {
  patternName: string
  patternKey: string
  completedCells: Set<string>
  symbolColors: Map<string, string>
  validCellIds: Set<string>
  validSymbolKeys: Set<string>
  totalStitches: number
  onImport: (completed: Set<string>, symbolColors: Map<string, string>) => void
  onClose: () => void
}

type TransferPayload = {
  format: 'stitchtracker-progress'
  version: 1
  patternKey: string
  patternName: string
  totalStitches: number
  completed: string[]
  symbolColors?: Record<string, string>
  exportedAt: string
}

function safeFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function isTransferPayload(value: unknown): value is TransferPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<TransferPayload>
  return (
    payload.format === 'stitchtracker-progress' &&
    payload.version === 1 &&
    typeof payload.patternKey === 'string' &&
    Array.isArray(payload.completed) &&
    payload.completed.every((id) => typeof id === 'string') &&
    (payload.symbolColors === undefined || (
      typeof payload.symbolColors === 'object' &&
      payload.symbolColors !== null &&
      !Array.isArray(payload.symbolColors) &&
      Object.values(payload.symbolColors).every((color) => typeof color === 'string')
    ))
  )
}

export function TransferDialog({
  patternName,
  patternKey,
  completedCells,
  symbolColors,
  validCellIds,
  validSymbolKeys,
  totalStitches,
  onImport,
  onClose,
}: TransferDialogProps) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  function createProgressFile() {
    const payload: TransferPayload = {
      format: 'stitchtracker-progress',
      version: 1,
      patternKey,
      patternName,
      totalStitches,
      completed: Array.from(completedCells),
      symbolColors: Object.fromEntries(symbolColors),
      exportedAt: new Date().toISOString(),
    }
    return new File([JSON.stringify(payload, null, 2)], `${safeFileName(patternName)}.stitchprogress.json`, {
      type: 'application/json',
    })
  }

  async function shareProgress() {
    setBusy(true)
    setMessage('')
    const file = createProgressFile()
    try {
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `${patternName} progress`,
          text: `StitchTracker progress: ${completedCells.size.toLocaleString()} of ${totalStitches.toLocaleString()} stitches complete.`,
          files: [file],
        })
        setMessage('Progress shared successfully.')
      } else {
        const url = URL.createObjectURL(file)
        const link = document.createElement('a')
        link.href = url
        link.download = file.name
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
        setMessage('Progress file downloaded. Send it to your other device.')
      }
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setMessage(reason instanceof Error ? reason.message : 'Progress could not be shared.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function importProgress(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setMessage('')
    try {
      const payload = JSON.parse(await file.text()) as unknown
      if (!isTransferPayload(payload)) {
        throw new Error('This is not a valid StitchTracker progress file.')
      }
      if (payload.patternKey !== patternKey) {
        throw new Error('This progress file belongs to a different PDF pattern.')
      }
      const imported = new Set(
        payload.completed
          .map((id) => id.split(':').slice(-2).join(':'))
          .filter((id) => validCellIds.has(id)),
      )
      const importedColors = new Map(
        Object.entries(payload.symbolColors ?? {})
          .filter(([key, color]) => (
            validSymbolKeys.has(key) && /^#[0-9a-f]{6}$/i.test(color)
          )),
      )
      onImport(imported, importedColors)
      setMessage(`Imported ${imported.size.toLocaleString()} completed stitches.`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Progress could not be imported.')
    } finally {
      setBusy(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section
        className="transfer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="dialog-close" type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <p className="eyebrow">Continue elsewhere</p>
        <h2 id="transfer-title">Transfer progress</h2>
        <p>
          Share a small progress file through AirDrop, Files, iCloud, email, or any other app.
          Import it on the other device after opening the same PDF.
        </p>

        <div className="transfer-summary">
          <strong>{completedCells.size.toLocaleString()}</strong>
          <span>of {totalStitches.toLocaleString()} stitches included</span>
        </div>

        <div className="transfer-actions">
          <button className="primary-button" type="button" disabled={busy} onClick={() => void shareProgress()}>
            Share progress
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json,.stitchprogress.json"
            hidden
            onChange={(event) => void importProgress(event.target.files?.[0])}
          />
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => importInputRef.current?.click()}
          >
            Import progress file
          </button>
        </div>

        <small className="transfer-note">
          Importing replaces this device’s progress for this pattern. The PDF itself is not included.
        </small>
        {message && <div className="transfer-message" role="status">{message}</div>}
      </section>
    </div>
  )
}
