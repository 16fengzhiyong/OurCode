import { useState, useCallback } from 'react'
import { SearchResult } from '@/types'
import { useEditorStore } from '@/stores/editorStore'

interface SearchPanelProps {
  rootPath: string | null
}

export default function SearchPanel({ rootPath }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const { openFile } = useEditorStore()

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !rootPath) return
    setIsSearching(true)
    try {
      const searchResults = await window.electronAPI.searchInFiles(rootPath, query, {
        caseSensitive, wholeWord, regex: useRegex,
      })
      setResults(searchResults)
    } catch (error) {
      console.error('Search failed:', error)
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [query, rootPath, caseSensitive, wholeWord, useRegex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  // Group results by file
  const groupedResults = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.filePath]) acc[r.filePath] = []
    acc[r.filePath].push(r)
    return acc
  }, {})

  return (
    <div className="h-full flex flex-col">
      {/* Search input */}
      <div className="p-2 space-y-2">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索文件内容..."
            className="w-full px-2.5 py-1.5 bg-nova-hover border border-nova-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:border-accent-blue focus:outline-none"
          />
          {isSearching && (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-text-muted">
              ...
            </span>
          )}
        </div>

        {/* Search options */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCaseSensitive(!caseSensitive)}
            className={`px-1.5 py-0.5 text-xs rounded-md transition-colors ${
              caseSensitive ? 'bg-accent-btn-primary text-white' : 'text-text-muted hover:text-text-secondary'
            }`}
            title="区分大小写"
          >
            Aa
          </button>
          <button
            onClick={() => setWholeWord(!wholeWord)}
            className={`px-1.5 py-0.5 text-xs rounded-md transition-colors ${
              wholeWord ? 'bg-accent-btn-primary text-white' : 'text-text-muted hover:text-text-secondary'
            }`}
            title="全词匹配"
          >
            Ab
          </button>
          <button
            onClick={() => setUseRegex(!useRegex)}
            className={`px-1.5 py-0.5 text-xs rounded-md transition-colors ${
              useRegex ? 'bg-accent-btn-primary text-white' : 'text-text-muted hover:text-text-secondary'
            }`}
            title="正则表达式"
          >
            .*
          </button>
          {results.length > 0 && (
            <span className="ml-auto text-xs text-text-muted">
              {results.length} 个结果
            </span>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!rootPath ? (
          <div className="p-4 text-center text-text-muted text-sm">打开文件夹以搜索</div>
        ) : results.length === 0 && query && !isSearching ? (
          <div className="p-4 text-center text-text-muted text-sm">未找到结果</div>
        ) : (
          Object.entries(groupedResults).map(([filePath, fileResults]) => (
            <div key={filePath} className="mb-1">
              <div className="px-2 py-1 bg-nova-surface/50 text-xs text-text-muted font-medium truncate">
                {fileResults[0].fileName}
                <span className="text-text-dim ml-1">({fileResults.length})</span>
              </div>
              {fileResults.map((result, idx) => (
                <div
                  key={idx}
                  className="px-3 py-1 hover:bg-nova-hover cursor-pointer text-xs group"
                  onClick={() => openFile(result.filePath)}
                >
                  <span className="text-text-dim mr-2 select-none w-8 inline-block text-right">
                    {result.lineNumber}
                  </span>
                  <span className="text-text-secondary truncate">{result.lineContent}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
