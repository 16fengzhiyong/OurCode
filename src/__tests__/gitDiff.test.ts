import { describe, it, expect } from 'vitest'
import { parseGitDiff, buildHunkPatch, buildChangePatch, findHunkForChange, DiffChangeRange } from '../utils/gitDiff'

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

describe('buildChangePatch', () => {
  it('isolates a mid-file replacement with context', () => {
    // parseGitDiff on the raw SAMPLE_DIFF (trailing newline) is fine — the
    // change under test lives in hunk 1, whose counts don't see the tail.
    const parsed = parseGitDiff(SAMPLE_DIFF, 'src/components/ChatMessage.tsx')
    const change: DiffChangeRange = {
      originalStartLineNumber: 46,
      originalEndLineNumber: 47,
      modifiedStartLineNumber: 46,
      modifiedEndLineNumber: 48,
    }
    const patch = buildChangePatch('src/components/ChatMessage.tsx', parsed, change)!
    expect(patch.startsWith('--- a/src/components/ChatMessage.tsx\n+++ b/src/components/ChatMessage.tsx\n')).toBe(true)
    expect(patch).toContain('@@ -45,4 +45,5 @@')
    // Only this change's lines, prefixed with the 1 context line on each side
    expect(patch).toContain('-    if (message.role === \'user\') {')
    expect(patch).toContain('+    if (message.type === \'tool_call\') {')
    expect(patch).toContain('+    }')
    expect(patch).not.toContain('export default ChatMessage')
  })

  it('isolates a trailing pure addition with 2 lines of leading context', () => {
    // trimEnd() drops the trailing newline so the tail hunk has no phantom
    // empty context line (production diff text is trimmed by gitExec).
    const parsed = parseGitDiff(SAMPLE_DIFF.trimEnd(), 'src/components/ChatMessage.tsx')
    const change: DiffChangeRange = {
      originalStartLineNumber: 0,
      originalEndLineNumber: 0,
      modifiedStartLineNumber: 129,
      modifiedEndLineNumber: 129,
    }
    const patch = buildChangePatch('src/components/ChatMessage.tsx', parsed, change)!
    expect(patch).toContain('@@ -120,2 +127,3 @@')
    expect(patch).toContain('+export default ChatMessage;')
    expect(patch).not.toContain('renderContent')
  })

  it('picks only one change when several sit in a single hunk', () => {
    const diff = `diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -3,8 +3,8 @@
 c3
 c4
-o5
+n5
 c6
 c7
 c8
-o9
+n9
 c10
 c11
`
    const parsed = parseGitDiff(diff, 'f.txt')
    const change: DiffChangeRange = {
      originalStartLineNumber: 5,
      originalEndLineNumber: 5,
      modifiedStartLineNumber: 5,
      modifiedEndLineNumber: 5,
    }
    const patch = buildChangePatch('f.txt', parsed, change)!
    expect(patch).toContain('@@ -3,6 +3,6 @@')
    expect(patch).toContain('-o5')
    expect(patch).toContain('+n5')
    expect(patch).not.toContain('o9')
    expect(patch).not.toContain('n9')
    // The second change is still locatable independently
    const change2: DiffChangeRange = {
      originalStartLineNumber: 9,
      originalEndLineNumber: 9,
      modifiedStartLineNumber: 9,
      modifiedEndLineNumber: 9,
    }
    const patch2 = buildChangePatch('f.txt', parsed, change2)!
    expect(patch2).toContain('-o9')
    expect(patch2).toContain('+n9')
  })

  it('handles a pure addition at the very start of a file (oldStart 0)', () => {
    const diff = `diff --git a/head.txt b/head.txt
index 1111111..2222222 100644
--- a/head.txt
+++ b/head.txt
@@ -0,0 +1,2 @@
+alpha
+beta`
    const parsed = parseGitDiff(diff, 'head.txt')
    const change: DiffChangeRange = {
      originalStartLineNumber: 0,
      originalEndLineNumber: 0,
      modifiedStartLineNumber: 1,
      modifiedEndLineNumber: 2,
    }
    const patch = buildChangePatch('head.txt', parsed, change)!
    expect(patch).toContain('@@ -0,0 +1,2 @@')
    expect(patch).toContain('+alpha')
    expect(patch).toContain('+beta')
  })

  it('handles a pure deletion of the final line', () => {
    const diff = `diff --git a/tail.txt b/tail.txt
index 1111111..2222222 100644
--- a/tail.txt
+++ b/tail.txt
@@ -1,4 +1,3 @@
 line1
 line2
 line3
-tail-line`
    const parsed = parseGitDiff(diff, 'tail.txt')
    const change: DiffChangeRange = {
      originalStartLineNumber: 4,
      originalEndLineNumber: 4,
      modifiedStartLineNumber: 0,
      modifiedEndLineNumber: 0,
    }
    const patch = buildChangePatch('tail.txt', parsed, change)!
    expect(patch).toContain('@@ -1,4 +1,3 @@')
    expect(patch).toContain('-tail-line')
  })

  it('keeps the no-newline marker when editing the final line', () => {
    const diff = `diff --git a/nonewline.txt b/nonewline.txt
index 1111111..2222222 100644
--- a/nonewline.txt
+++ b/nonewline.txt
@@ -1,3 +1,3 @@
 a
 b
-last
\\ No newline at end of file
+last2
\\ No newline at end of file
`
    const parsed = parseGitDiff(diff, 'nonewline.txt')
    const change: DiffChangeRange = {
      originalStartLineNumber: 3,
      originalEndLineNumber: 3,
      modifiedStartLineNumber: 3,
      modifiedEndLineNumber: 3,
    }
    const patch = buildChangePatch('nonewline.txt', parsed, change)!
    expect(patch).toContain('\\ No newline at end of file')
    expect(patch).toContain('-last')
    expect(patch).toContain('+last2')
  })

  it('returns null when the change cannot be mapped to a hunk', () => {
    const parsed = parseGitDiff(SAMPLE_DIFF, 'x.ts')
    const change: DiffChangeRange = {
      originalStartLineNumber: 200,
      originalEndLineNumber: 201,
      modifiedStartLineNumber: 200,
      modifiedEndLineNumber: 201,
    }
    expect(buildChangePatch('x.ts', parsed, change)).toBeNull()
    expect(findHunkForChange(parsed, change)).toBeNull()
  })
})
