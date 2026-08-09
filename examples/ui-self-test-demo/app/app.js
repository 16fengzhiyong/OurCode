/* 任务管理工作台 - 交互逻辑（纯原生 JS，无外部依赖） */
(function () {
  'use strict'

  const STORAGE_KEY = 'taskboard.v1'

  const state = loadState()

  // 任务 id 自增序号：与时间戳组合，避免同毫秒内连续添加造成 id 冲突
  // （id 冲突会导致勾选/删除时误伤多条任务）
  let taskSeq = 0

  // ── DOM 引用 ────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel)
  const tabs = document.querySelectorAll('.tab')
  const panels = {
    dashboard: $('#panel-dashboard'),
    tasks: $('#panel-tasks'),
    settings: $('#panel-settings'),
  }
  const statTotal = $('#stat-total')
  const statDone = $('#stat-done')
  const statPending = $('#stat-pending')
  const dashboardGreeting = $('#dashboard-greeting')
  const taskForm = $('#task-form')
  const taskInput = $('#task-input')
  const formError = $('#form-error')
  const searchInput = $('#search-input')
  const taskCount = $('#task-count')
  const taskList = $('#task-list')
  const emptyHint = $('#empty-hint')
  const usernameInput = $('#username-input')
  const usernamePreview = $('#username-preview')
  const themeLight = $('#theme-light')
  const themeDark = $('#theme-dark')

  // ── 状态 ────────────────────────────────────────────────────
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return { tasks: [], username: '', theme: 'light' }
      const parsed = JSON.parse(raw)
      return {
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        username: typeof parsed.username === 'string' ? parsed.username : '',
        theme: parsed.theme === 'dark' ? 'dark' : 'light',
      }
    } catch {
      return { tasks: [], username: '', theme: 'light' }
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch { /* localStorage 不可用时静默降级 */ }
  }

  function applyTheme() {
    document.body.dataset.theme = state.theme
    themeLight.classList.toggle('active', state.theme === 'light')
    themeDark.classList.toggle('active', state.theme === 'dark')
  }

  // ── 渲染 ────────────────────────────────────────────────────
  function renderDashboard() {
    const total = state.tasks.length
    const done = state.tasks.filter((t) => t.done).length
    statTotal.textContent = total
    statDone.textContent = done
    statPending.textContent = total - done
    dashboardGreeting.textContent = state.username
      ? `你好，${state.username}！今天也加油吧。`
      : '你好，请先在「设置」里填写你的名字。'
  }

  function renderTasks() {
    const keyword = searchInput.value.trim().toLowerCase()
    const visible = keyword
      ? state.tasks.filter((t) => t.text.toLowerCase().includes(keyword))
      : state.tasks

    taskList.innerHTML = ''
    visible.forEach((task, idx) => {
      const li = document.createElement('li')
      li.className = 'task-item' + (task.done ? ' completed' : '')
      li.dataset.taskId = task.id

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = task.done
      checkbox.setAttribute('aria-label', '标记完成')
      checkbox.addEventListener('change', () => toggleTask(task.id))

      const span = document.createElement('span')
      span.className = 'task-text'
      span.textContent = task.text

      const del = document.createElement('button')
      del.className = 'delete-btn'
      del.textContent = '✕'
      del.title = '删除任务'
      del.setAttribute('aria-label', '删除任务')
      del.addEventListener('click', () => deleteTask(task.id))

      li.append(checkbox, span, del)
      taskList.appendChild(li)
    })

    const total = state.tasks.length
    taskCount.textContent = `共 ${total} 项 · 显示 ${visible.length} 项`
    emptyHint.hidden = total > 0
  }

  function renderUsername() {
    usernameInput.value = state.username
    usernamePreview.textContent = state.username || '…'
  }

  function renderAll() {
    renderDashboard()
    renderTasks()
    renderUsername()
    applyTheme()
  }

  // ── 操作 ────────────────────────────────────────────────────
  function addTask(text) {
    state.tasks.push({ id: `${Date.now()}-${++taskSeq}`, text: text.trim(), done: false })
    saveState()
    renderAll()
  }

  function toggleTask(id) {
    const task = state.tasks.find((t) => t.id === id)
    if (task) {
      task.done = !task.done
      saveState()
      renderAll()
    }
  }

  function deleteTask(id) {
    state.tasks = state.tasks.filter((t) => t.id !== id)
    saveState()
    renderAll()
  }

  // ── 事件绑定 ────────────────────────────────────────────────
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab
      tabs.forEach((t) => t.classList.toggle('active', t === tab))
      Object.entries(panels).forEach(([key, el]) => {
        el.hidden = key !== name
        el.classList.toggle('active', key === name)
      })
    })
  })

  taskForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const text = taskInput.value.trim()
    if (!text) {
      formError.hidden = false
      taskInput.focus()
      return
    }
    formError.hidden = true
    addTask(text)
    taskInput.value = ''
    taskInput.focus()
  })

  taskInput.addEventListener('input', () => {
    if (formError.hidden === false && taskInput.value.trim()) formError.hidden = true
  })

  searchInput.addEventListener('input', renderTasks)

  // 回车即失焦，触发 change 保存（与文档「失焦或回车保存」一致）
  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') usernameInput.blur()
  })

  usernameInput.addEventListener('change', () => {
    state.username = usernameInput.value.trim()
    saveState()
    renderAll()
  })

  themeLight.addEventListener('click', () => {
    state.theme = 'light'
    saveState()
    applyTheme()
  })

  themeDark.addEventListener('click', () => {
    state.theme = 'dark'
    saveState()
    applyTheme()
  })

  // ── 初始化 ──────────────────────────────────────────────────
  renderAll()
})()
