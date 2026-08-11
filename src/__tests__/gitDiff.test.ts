import { describe, it, expect } from 'vitest'
import { parseGitDiff, buildHunkPatch } from '../utils/gitDiff'

const SAMPLE_DIFF = `diff --git a/src/components/ChatMessage.tsx b/src/components/ChatMessage.tsx
index 1234567..89abcde 100644
--- a/src/components/ChatMessage.tsx
+++ b/src/components/ChatMessage.tsx
@@ -45,8 +45,15 @@ export const ChatMessage: React.FC<Props> = ({ message }) => {
   const renderContent = () => {
-    if (message.role === 'user') {
-      return <UserBubble content={message.content} />;
+    if (message.type === 'tool_call') {
+      return <ToolChip call={message.tool_data} />;
+    }
   }
@@ -120,3 +127,7 @@ export const ChatMessage: React.FC<Props> = ({ message }) => {
   return null;
 }
+export default ChatMessage;
`

describe('parseGitDiff', () => {
  it('parses hunks with line numbers and +/- markers', () => {
    const parsed = parseGitDiff(SAMPLE_DIFF, 'src/components/ChatMessage.tsx')
    expect(parsed.file).toBe('src/components/ChatMessage.tsx')
    expect(parsed.hunks.length).toBe(2)
    expect(parsed.added).toBe(4)
    expect(parsed.deleted).toBe(2)
  })

  it('tracks old/new line numbers per line', () => {
    const parsed = parseGitDiff(SAMPLE_DIFF)
    const hunk0 = parsed.hunks[0]
    // First del line: old 46, no new line; first add line: new 46, no old line
    const del = hunk0.lines.find((l) => l.type === 'del')!
    const add = hunk0.lines.find((l) => l.type === 'add')!
    expect(del.oldLine).toBe(46)
    expect(del.newLine).toBeUndefined()
    expect(add.newLine).toBe(46)
    expect(add.oldLine).toBeUndefined()
  })

  it('starts hunk line counters at the @@ offsets', () => {
    const parsed = parseGitDiff(SAMPLE_DIFF)
    expect(parsed.hunks[0].oldStart).toBe(45)
    expect(parsed.hunks[0].newStart).toBe(45)
    expect(parsed.hunks[1].oldStart).toBe(120)
    expect(parsed.hunks[1].newStart).toBe(127)
  })

  it('returns empty hunks for empty input', () => {
    const parsed = parseGitDiff('')
    expect(parsed.hunks).toEqual([])
    expect(parsed.added).toBe(0)
    expect(parsed.deleted).toBe(0)
  })
})

describe('buildHunkPatch', () => {
  it('reassembles a single hunk with --- / +++ file headers', () => {
    const parsed = parseGitDiff(SAMPLE_DIFF, 'src/components/ChatMessage.tsx')
    const patch = buildHunkPatch('src/components/ChatMessage.tsx', parsed.hunks[0])
    expect(patch.startsWith('--- a/src/components/ChatMessage.tsx\n+++ b/src/components/ChatMessage.tsx\n')).toBe(true)
    expect(patch).toContain('@@ -45,8 +45,15 @@')
    expect(patch).toContain('-    if (message.role === \'user\') {')
    expect(patch).toContain('+    if (message.type === \'tool_call\') {')
  })
})

describe('parseGitDiff — added files (/dev/null headers)', () => {
  const NEW_FILE_DIFF = `diff --git a/newfile.ts b/newfile.ts
new file mode 100644
index 0000000..3b18e51
--- /dev/null
+++ b/newfile.ts
@@ -0,0 +1,3 @@
+export const hello = () => 'hi';
+export const bye = () => 'bye';
`

  it('captures /dev/null file headers and counts adds', () => {
    const parsed = parseGitDiff(NEW_FILE_DIFF, 'newfile.ts')
    expect(parsed.oldHeader).toBe('/dev/null')
    expect(parsed.newHeader).toBe('b/newfile.ts')
    expect(parsed.hunks.length).toBe(1)
    expect(parsed.added).toBe(2)
    expect(parsed.deleted).toBe(0)
  })

  it('builds a patch that keeps the /dev/null header', () => {
    const parsed = parseGitDiff(NEW_FILE_DIFF, 'newfile.ts')
    const patch = buildHunkPatch('newfile.ts', parsed.hunks[0], parsed)
    expect(patch.startsWith('--- /dev/null\n+++ b/newfile.ts\n')).toBe(true)
  })
})

describe('parseGitDiff — no-newline marker', () => {
  const NO_EOL_DIFF = `diff --git a/x.txt b/x.txt
--- a/x.txt
+++ b/x.txt
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
`

  it('marks \\ no newline lines and re-emits them verbatim', () => {
    const parsed = parseGitDiff(NO_EOL_DIFF, 'x.txt')
    expect(parsed.hunks.length).toBe(1)
    const marker = parsed.hunks[0].lines.find((l) => l.noNewlineMarker)
    expect(marker).toBeDefined()
    // text keeps the space after the backslash; rebuild prepends the backslash
    expect(marker!.text).toBe(' No newline at end of file')
    expect(marker!.oldLine).toBeUndefined()
    const patch = buildHunkPatch('x.txt', parsed.hunks[0], parsed)
    expect(patch).toContain('\\ No newline at end of file')
  })
})
