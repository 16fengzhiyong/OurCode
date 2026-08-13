import { create } from 'zustand'

/** What to do with a dirty file when the user closes it / its panel. */
export type UnsavedChoice = 'save' | 'discard' | 'cancel'

interface UnsavedDialogState {
  isOpen: boolean
  fileName: string
  /** Resolver for the currently-open prompt (null while no prompt is shown). */
  resolve: ((choice: UnsavedChoice) => void) | null
  /** Ask the user what to do with `fileName`. Resolves with the choice. */
  ask: (fileName: string) => Promise<UnsavedChoice>
  /** Close the dialog and resolve the pending prompt with `choice`. */
  settle: (choice: UnsavedChoice) => void
}

/**
 * Promise-based Save/Don't-Save/Cancel prompt for dirty files. Components and
 * store actions await `ask()` and act on the returned choice; the dialog is a
 * small component (UnsavedDialog) rendered once in the layout.
 */
export const useUnsavedStore = create<UnsavedDialogState>((set, get) => ({
  isOpen: false,
  fileName: '',
  resolve: null,

  ask: (fileName) => {
    // Never stack prompts: resolve an already-open one as 'cancel' so its
    // caller keeps the file open, then open the new prompt.
    get().resolve?.('cancel')
    return new Promise((resolve) => {
      set({ isOpen: true, fileName, resolve })
    })
  },

  settle: (choice) => {
    get().resolve?.(choice)
    set({ isOpen: false, fileName: '', resolve: null })
  },
}))
