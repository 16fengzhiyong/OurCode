/**
 * Workflow store — reusable prompt templates (Windsurf-style Workflows).
 *
 * A workflow is a named prompt that can be re-run against the current
 * workspace/selection. Stored in SQLite (optionally encrypted) and invoked by
 * sending its prompt into the active chat session.
 */
import { create } from 'zustand'
import { Workflow } from '@/types'

interface WorkflowState {
  workflows: Workflow[]
  loaded: boolean

  loadWorkflows: () => Promise<void>
  addWorkflow: (input: { name: string; description?: string; prompt: string }) => Promise<void>
  deleteWorkflow: (id: string) => Promise<void>
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: [],
  loaded: false,

  loadWorkflows: async () => {
    try {
      const workflows = await window.electronAPI.workflowList()
      set({ workflows, loaded: true })
    } catch (error) {
      console.error('加载工作流失败:', error)
      set({ loaded: true })
    }
  },

  addWorkflow: async (input) => {
    if (!input.prompt.trim()) return
    try {
      const workflow = await window.electronAPI.workflowAdd(input)
      set({ workflows: [workflow, ...get().workflows] })
    } catch (error) {
      console.error('保存工作流失败:', error)
    }
  },

  deleteWorkflow: async (id) => {
    try {
      await window.electronAPI.workflowDelete(id)
      set({ workflows: get().workflows.filter((w) => w.id !== id) })
    } catch (error) {
      console.error('删除工作流失败:', error)
    }
  },
}))
