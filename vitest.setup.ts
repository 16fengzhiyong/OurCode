import { vi } from 'vitest'

/**
 * Global stubs for the Node test environment.
 *
 * The chat/config stores read `localStorage` at module load (e.g. configStore
 * hydrates favoriteModelIds/promptHistory), so it must exist before any test
 * module is imported — a plain `vi.stubGlobal` inside a test file runs after
 * the hoisted imports and is too late.
 */
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
})

// getWorkspaceRoot() reads the file-tree DOM node; a null return is the
// "no workspace" case which every code path handles.
vi.stubGlobal('document', { getElementById: () => null })
