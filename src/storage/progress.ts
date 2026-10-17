export type SavedProgress = {
  version: 1
  completed: string[]
  symbolColors?: Record<string, string>
  symbolImages?: Record<string, string>
  symbolImageVersion?: 1
  updatedAt: string
}

const DATABASE_NAME = 'stitchtracker'
const STORE_NAME = 'pattern-progress'
const SERVER_STORE_PATH = '/__stitchtracker/progress/'

async function readFromLocalServer(key: string) {
  const response = await fetch(`${SERVER_STORE_PATH}${encodeURIComponent(key)}`)
  if (!response.ok) throw new Error('Local progress file is unavailable.')
  return (await response.json()) as SavedProgress | null
}

async function writeToLocalServer(key: string, progress: SavedProgress) {
  const response = await fetch(`${SERVER_STORE_PATH}${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(progress),
  })
  if (!response.ok) throw new Error('Could not write the local progress file.')
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not available.'))
      return
    }
    const request = window.indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open progress storage.'))
  })
}

async function readFromDatabase(key: string) {
  const database = await openDatabase()
  try {
    return await new Promise<SavedProgress | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(key)
      request.onsuccess = () => resolve((request.result as SavedProgress | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('Could not read saved progress.'))
    })
  } finally {
    database.close()
  }
}

async function writeToDatabase(key: string, progress: SavedProgress) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(progress, key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save progress.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Progress save was interrupted.'))
    })
  } finally {
    database.close()
  }
}

function readFromLocalStorage(key: string): SavedProgress | null {
  try {
    const value = window.localStorage?.getItem(key)
    return value ? (JSON.parse(value) as SavedProgress) : null
  } catch {
    return null
  }
}

function writeToLocalStorage(key: string, progress: SavedProgress) {
  try {
    window.localStorage?.setItem(key, JSON.stringify(progress))
    return true
  } catch {
    return false
  }
}

export async function loadProgress(key: string): Promise<SavedProgress | null> {
  try {
    const saved = await readFromLocalServer(key)
    if (saved) return saved
  } catch {
    // A deployed static app will not have the local Vite storage endpoint.
  }

  try {
    const saved = await readFromDatabase(key)
    if (saved) return saved
  } catch {
    // Fall through to localStorage for browsers with IndexedDB disabled.
  }

  const legacy = readFromLocalStorage(key)
  if (legacy) {
    try {
      await writeToDatabase(key, legacy)
    } catch {
      // The localStorage copy remains usable if migration is unavailable.
    }
  }
  return legacy
}

export async function saveProgress(key: string, progress: SavedProgress) {
  const localStorageSaved = writeToLocalStorage(key, progress)
  let databaseSaved = false
  try {
    await writeToDatabase(key, progress)
    databaseSaved = true
  } catch {
    // The local development file or localStorage can still persist the change.
  }
  try {
    await writeToLocalServer(key, progress)
    return
  } catch (reason) {
    if (!databaseSaved && !localStorageSaved) throw reason
  }
}
