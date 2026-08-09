import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUIStore } from '@/stores/uiStore'

// Capture the pristine initial state so each test starts clean
const initialState = useUIStore.getState()

beforeEach(() => {
  useUIStore.setState(initialState)
  // Reset to the setup-file default (getItem → null); the restoreLastProject
  // tests re-stub localStorage/window per case.
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  })
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

describe('restoreLastProject', () => {
  const saved = JSON.stringify({ path: 'C:/proj/restored', view: 'tree' })
  const existingStat = { size: 0, isFile: false, isDirectory: true, createdAt: 0, modifiedAt: 0 }

  // Persisted state says the last project was C:/proj/restored
  const stubSavedProject = () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'lastProjectState' ? saved : null),
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    })
  }

  it('authorizes the path before probing it, then restores the project', async () => {
    stubSavedProject()
    useUIStore.setState({ recentProjects: ['C:/proj/restored'] })
    const authorize = vi.fn(async () => {})
    const stat = vi.fn(async () => existingStat)
    vi.stubGlobal('window', { electronAPI: { authorize, stat } })

    await useUIStore.getState().restoreLastProject()

    // The allowlist is empty at startup — the probe must happen after authorize
    expect(authorize).toHaveBeenCalledWith('C:/proj/restored')
    expect(stat).toHaveBeenCalledWith('C:/proj/restored')
    expect(useUIStore.getState().activeProjectPath).toBe('C:/proj/restored')
    expect(useUIStore.getState().projectListView).toBe('tree')
  })

  it('does not restore when the folder no longer exists on disk', async () => {
    stubSavedProject()
    useUIStore.setState({ recentProjects: ['C:/proj/restored'] })
    const authorize = vi.fn(async () => {})
    const stat = vi.fn(async () => { throw new Error('ENOENT') })
    vi.stubGlobal('window', { electronAPI: { authorize, stat } })

    await useUIStore.getState().restoreLastProject()

    expect(stat).toHaveBeenCalled()
    expect(useUIStore.getState().activeProjectPath).toBeNull()
    expect(useUIStore.getState().projectListView).toBe('list')
  })

  it('does not authorize paths that were never opened before', async () => {
    stubSavedProject()
    // recentProjects is empty → the restore is skipped entirely
    const authorize = vi.fn(async () => {})
    vi.stubGlobal('window', { electronAPI: { authorize } })

    await useUIStore.getState().restoreLastProject()

    expect(authorize).not.toHaveBeenCalled()
    expect(useUIStore.getState().activeProjectPath).toBeNull()
  })

  it('does nothing when no project was saved', async () => {
    useUIStore.setState({ recentProjects: ['C:/proj/restored'] })
    const authorize = vi.fn(async () => {})
    vi.stubGlobal('window', { electronAPI: { authorize } })

    await useUIStore.getState().restoreLastProject()

    expect(authorize).not.toHaveBeenCalled()
    expect(useUIStore.getState().activeProjectPath).toBeNull()
  })
})
