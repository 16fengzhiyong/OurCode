import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '@/stores/uiStore'

// Capture the pristine initial state so each test starts clean
const initialState = useUIStore.getState()

beforeEach(() => {
  useUIStore.setState(initialState)
})

describe('notifications', () => {
  it('showNotification appends a toast with info type by default', () => {
    useUIStore.getState().showNotification('hello')
    const notifications = useUIStore.getState().notifications
    expect(notifications).toHaveLength(1)
    expect(notifications[0].message).toBe('hello')
    expect(notifications[0].type).toBe('info')
  })

  it('respects the explicit type', () => {
    useUIStore.getState().showNotification('boom', 'error')
    expect(useUIStore.getState().notifications[0].type).toBe('error')
  })

  it('assigns monotonic ids', () => {
    useUIStore.getState().showNotification('a')
    useUIStore.getState().showNotification('b', 'warning')
    const [a, b] = useUIStore.getState().notifications
    expect(a.id).not.toBe(b.id)
  })

  it('ignores blank messages', () => {
    useUIStore.getState().showNotification('   ')
    expect(useUIStore.getState().notifications).toHaveLength(0)
  })

  it('caps the stack at 5, dropping the oldest', () => {
    for (let i = 1; i <= 6; i++) useUIStore.getState().showNotification(`m${i}`)
    const notifications = useUIStore.getState().notifications
    expect(notifications).toHaveLength(5)
    expect(notifications[0].message).toBe('m2')
    expect(notifications[4].message).toBe('m6')
  })

  it('dismissNotification removes by id', () => {
    useUIStore.getState().showNotification('a')
    useUIStore.getState().showNotification('b')
    const [first] = useUIStore.getState().notifications
    useUIStore.getState().dismissNotification(first.id)
    const notifications = useUIStore.getState().notifications
    expect(notifications).toHaveLength(1)
    expect(notifications[0].message).toBe('b')
  })
})
