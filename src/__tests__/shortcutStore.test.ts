import { describe, it, expect } from 'vitest'
import { matchesShortcut } from '../stores/shortcutStore'

// matchesShortcut only reads ctrlKey/metaKey/shiftKey/altKey/key, so a plain
// object shaped like a KeyboardEvent is enough (avoids needing jsdom).
function keyEvent(overrides: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }): KeyboardEvent {
  return {
    key: overrides.key,
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    altKey: overrides.altKey ?? false,
  } as unknown as KeyboardEvent
}

describe('matchesShortcut', () => {
  it('matches a plain Ctrl binding', () => {
    expect(matchesShortcut(keyEvent({ key: 's', ctrlKey: true }), 'Ctrl+S')).toBe(true)
  })

  it('is case-insensitive for letter keys', () => {
    expect(matchesShortcut(keyEvent({ key: 'S', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+S')).toBe(true)
    expect(matchesShortcut(keyEvent({ key: 's', ctrlKey: true }), 'Ctrl+S')).toBe(true)
  })

  it('does NOT match Ctrl+N when Ctrl+Shift+N is pressed', () => {
    expect(matchesShortcut(keyEvent({ key: 'N', ctrlKey: true, shiftKey: true }), 'Ctrl+N')).toBe(false)
    expect(matchesShortcut(keyEvent({ key: 'N', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+N')).toBe(true)
  })

  it('does NOT match Ctrl+Shift+S when plain Ctrl+S is pressed', () => {
    expect(matchesShortcut(keyEvent({ key: 's', ctrlKey: true }), 'Ctrl+Shift+S')).toBe(false)
  })

  it('matches Alt bindings', () => {
    expect(matchesShortcut(keyEvent({ key: 'F12', altKey: true }), 'Alt+F12')).toBe(true)
    expect(matchesShortcut(keyEvent({ key: 'F12' }), 'Alt+F12')).toBe(false)
  })

  it('matches function-key bindings', () => {
    expect(matchesShortcut(keyEvent({ key: 'F4', ctrlKey: true }), 'Ctrl+F4')).toBe(true)
    expect(matchesShortcut(keyEvent({ key: 'F4', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+F12')).toBe(false)
  })

  it('matches punctuation keys', () => {
    expect(matchesShortcut(keyEvent({ key: '\\', ctrlKey: true }), 'Ctrl+\\')).toBe(true)
    expect(matchesShortcut(keyEvent({ key: '`', ctrlKey: true }), 'Ctrl+`')).toBe(true)
    expect(matchesShortcut(keyEvent({ key: '=', ctrlKey: true }), 'Ctrl+=')).toBe(true)
  })

  it('treats Cmd (meta) as Ctrl for macOS parity', () => {
    expect(matchesShortcut(keyEvent({ key: 'p', metaKey: true }), 'Ctrl+P')).toBe(true)
  })

  it('returns false for empty/missing bindings', () => {
    expect(matchesShortcut(keyEvent({ key: 'a' }), '')).toBe(false)
  })

  it('does not match when the key is wrong', () => {
    expect(matchesShortcut(keyEvent({ key: 'x', ctrlKey: true }), 'Ctrl+P')).toBe(false)
  })
})
