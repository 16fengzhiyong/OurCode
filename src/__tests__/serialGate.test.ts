import { describe, it, expect } from 'vitest'
import { createSerialGate } from '@/utils/serialGate'

/**
 * Approval-dialog serialization tests. The executor runs a round's tools
 * concurrently, but the store has ONE pendingApproval slot and one
 * _approvalResolves key per session — so approval-requiring tools must enter
 * their dialogs one at a time (FIFO). These tests pin the gate's contract:
 * exactly one entrant holds the turn, the next proceeds only after release,
 * and a throwing body still releases (the chain can never stall).
 */
describe('createSerialGate', () => {
  it('serializes concurrent entrants in FIFO order', async () => {
    const gate = createSerialGate()
    const order: string[] = []
    const work = async (name: string): Promise<void> => {
      const release = await gate.enter()
      order.push(`${name}:in`)
      await new Promise((r) => setTimeout(r, 10))
      order.push(`${name}:out`)
      release()
    }
    await Promise.all([work('a'), work('b'), work('c')])
    expect(order).toEqual(['a:in', 'a:out', 'b:in', 'b:out', 'c:in', 'c:out'])
  })

  it('releases even when the entrant throws (chain cannot stall)', async () => {
    const gate = createSerialGate()
    const boom = async (): Promise<void> => {
      const release = await gate.enter()
      try {
        throw new Error('boom')
      } finally {
        release()
      }
    }
    await expect(boom()).rejects.toThrow('boom')
    // The next entrant must still be able to take the turn after the throw.
    const release = await gate.enter()
    release()
  })
})
