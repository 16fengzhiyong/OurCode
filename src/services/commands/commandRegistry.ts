/**
 * Unified command registry (VS Code-style): keyboard shortcuts, the command
 * palette, menus and plugins all address commands by a stable ID instead of
 * inline closures. Commands are registered once at startup (coreCommands) and
 * by plugins at activation.
 */

export interface AppCommand {
  id: string
  title: string
  category?: string
  icon?: string
  /** Optional static shortcut hint (palette display). */
  shortcut?: string
  run: (...args: unknown[]) => unknown
}

const commands = new Map<string, AppCommand>()

export function registerCommand(command: AppCommand): void {
  commands.set(command.id, command)
}

export function unregisterCommand(id: string): void {
  commands.delete(id)
}

export function executeCommand(id: string, ...args: unknown[]): unknown {
  const command = commands.get(id)
  if (!command) {
    console.warn(`Unknown command: ${id}`)
    return undefined
  }
  return command.run(...args)
}

export function getCommands(): AppCommand[] {
  return Array.from(commands.values())
}

export function hasCommand(id: string): boolean {
  return commands.has(id)
}
