export const PAGE_HTML_PREFIX = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>open-im Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      :root {
        /* Light Theme - Linear/Vercel inspired */
        --bg-primary: #ffffff;
        --bg-secondary: #f9fafb;
        --bg-tertiary: #f3f4f6;
        --bg-card: #ffffff;
        --bg-hover: #f9fafb;
        --bg-active: #f3f4f6;

        --border-subtle: #e5e7eb;
        --border-default: #d1d5db;
        --border-strong: #9ca3af;

        --text-primary: #111827;
        --text-secondary: #4b5563;
        --text-tertiary: #6b7280;
        --text-quaternary: #9ca3af;

        --accent-primary: #2563eb;
        --accent-primary-hover: #1d4ed8;
        --accent-primary-light: #dbeafe;

        --success-bg: #dcfce7;
        --success-text: #166534;
        --success-border: #86efac;

        --warning-bg: #fef3c7;
        --warning-text: #92400e;
        --warning-border: #fcd34d;

        --error-bg: #fee2e2;
        --error-text: #991b1b;
        --error-border: #fca5a5;

        --info-bg: #dbeafe;
        --info-text: #1e40af;
        --info-border: #93c5fd;

        --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.05);
        --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
        --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
        --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);

        --radius-xs: 4px;
        --radius-sm: 6px;
        --radius-md: 8px;
        --radius-lg: 12px;
        --radius-xl: 16px;

        --transition-fast: 150ms ease;
        --transition-normal: 200ms ease;
      }

      /* Dark Theme */
      :root.dark {
        --bg-primary: #0f0f0f;
        --bg-secondary: #18181b;
        --bg-tertiary: #27272a;
        --bg-card: #18181b;
        --bg-hover: #27272a;
        --bg-active: #3f3f46;

        --border-subtle: #27272a;
        --border-default: #3f3f46;
        --border-strong: #52525b;

        --text-primary: #fafafa;
        --text-secondary: #a1a1aa;
        --text-tertiary: #71717a;
        --text-quaternary: #52525b;

        --accent-primary: #3b82f6;
        --accent-primary-hover: #60a5fa;
        --accent-primary-light: #1e3a5f;

        --success-bg: #14532d;
        --success-text: #86efac;
        --success-border: #166534;

        --warning-bg: #713f12;
        --warning-text: #fcd34d;
        --warning-border: #92400e;

        --error-bg: #7f1d1d;
        --error-text: #fca5a5;
        --error-border: #991b1b;

        --info-bg: #1e3a5f;
        --info-text: #93c5fd;
        --info-border: #1e40af;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: var(--text-primary);
        background: var(--bg-secondary);
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      /* Layout */
      .app {
        display: flex;
        min-height: 100vh;
      }

      /* Sidebar */
      .sidebar {
        width: 260px;
        background: #111827;
        color: #f3f4f6;
        display: flex;
        flex-direction: column;
        position: fixed;
        height: 100vh;
        left: 0;
        top: 0;
        z-index: 10;
      }

      .sidebar-header {
        padding: 24px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .sidebar-brand {
        font-size: 18px;
        font-weight: 600;
        color: #ffffff;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .sidebar-brand svg {
        width: 24px;
        height: 24px;
        color: var(--accent-primary);
      }

      .sidebar-nav {
        flex: 1;
        padding: 16px 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .nav-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: var(--radius-md);
        color: rgba(255, 255, 255, 0.7);
        text-decoration: none;
        font-size: 13px;
        font-weight: 500;
        transition: all var(--transition-fast);
        cursor: pointer;
        border: none;
        background: transparent;
        width: 100%;
        text-align: left;
      }

      .nav-item:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
      }

      .nav-item.active {
        background: rgba(255, 255, 255, 0.12);
        color: #ffffff;
      }

      .nav-item svg {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
      }

      .sidebar-footer {
        padding: 16px 20px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      /* Main Content */
      .main {
        flex: 1;
        margin-left: 260px;
        display: flex;
        flex-direction: column;
      }

      .main-header {
        background: var(--bg-primary);
        border-bottom: 1px solid var(--border-subtle);
        padding: 16px 32px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .main-title {
        font-size: 20px;
        font-weight: 600;
        color: var(--text-primary);
      }

      .main-subtitle {
        font-size: 13px;
        color: var(--text-secondary);
        margin-top: 2px;
      }

      .header-actions {
        display: flex;
        gap: 12px;
        align-items: center;
      }

      .lang-button {
        padding: 8px 14px;
        font-size: 13px;
        font-weight: 500;
        border-radius: var(--radius-md);
        border: 1px solid var(--border-default);
        background: var(--bg-primary);
        color: var(--text-primary);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .lang-button:hover {
        background: var(--bg-hover);
        border-color: var(--border-strong);
      }

      .dark-mode-toggle {
        padding: 8px;
        border-radius: var(--radius-md);
        border: 1px solid var(--border-default);
        background: var(--bg-primary);
        color: var(--text-primary);
        cursor: pointer;
        transition: all var(--transition-fast);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .dark-mode-toggle:hover {
        background: var(--bg-hover);
        border-color: var(--border-strong);
      }

      /* Content */
      .content {
        padding: 32px;
      }

      /* Section */
      .section {
        margin-bottom: 48px;
      }

      .section-header {
        margin-bottom: 24px;
      }

      .section-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 8px 0;
      }

      .section-description {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0;
      }

      /* Cards */
      .card {
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
        overflow: hidden;
      }

      .card-header {
        padding: 20px 24px;
        border-bottom: 1px solid var(--border-subtle);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .card-title {
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
      }

      .card-body {
        padding: 24px;
      }

      /* Stats Grid */
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
        margin-bottom: 24px;
      }

      .stat-card {
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-lg);
        padding: 20px;
      }

      .stat-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .stat-value {
        font-size: 28px;
        font-weight: 700;
        color: var(--text-primary);
        margin-top: 8px;
        line-height: 1;
      }

      /* Platform Cards */
      .platform-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 20px;
      }

      .platform-card {
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-lg);
        overflow: hidden;
        transition: all var(--transition-fast);
      }

      .platform-card:hover {
        box-shadow: var(--shadow-md);
      }

      .platform-card.disabled {
        opacity: 0.6;
      }

      .platform-header {
        padding: 20px 24px;
        border-bottom: 1px solid var(--border-subtle);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .platform-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-primary);
      }

      .platform-body {
        padding: 24px;
      }

      /* Badges */
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 500;
        border-radius: 999px;
      }

      .badge-success { background: var(--success-bg); color: var(--success-text); }
      .badge-error { background: var(--error-bg); color: var(--error-text); }
      .badge-warning { background: var(--warning-bg); color: var(--warning-text); }
      .badge-default { background: var(--bg-tertiary); color: var(--text-secondary); }
      .badge-info { background: var(--info-bg); color: var(--info-text); }

      /* Form Elements */
      .form-group {
        margin-bottom: 16px;
      }

      .form-group:last-child {
        margin-bottom: 0;
      }

      .form-label {
        display: block;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-primary);
        margin-bottom: 6px;
      }

      .form-hint {
        font-size: 12px;
        color: var(--text-tertiary);
        margin-top: 4px;
      }

      .form-input,
      .form-select,
      .form-textarea {
        width: 100%;
        padding: 10px 12px;
        font-family: inherit;
        font-size: 14px;
        color: var(--text-primary);
        background: var(--bg-primary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        transition: all var(--transition-fast);
      }

      .form-input:focus,
      .form-select:focus,
      .form-textarea:focus {
        outline: none;
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 3px var(--accent-primary-light);
      }

      .form-input.mono,
      .form-textarea.mono {
        font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
        font-size: 13px;
      }

      .form-textarea {
        min-height: 80px;
        resize: vertical;
      }

      /* Toggle Switch */
      .toggle {
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
      }

      .toggle-input {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      .toggle-switch {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
        background: var(--border-default);
        border-radius: 999px;
        transition: background var(--transition-fast);
        flex-shrink: 0;
      }

      .toggle-switch::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        background: white;
        border-radius: 50%;
        transition: transform var(--transition-fast);
        box-shadow: var(--shadow-xs);
      }

      .toggle-input:checked + .toggle-switch {
        background: var(--accent-primary);
      }

      .toggle-input:checked + .toggle-switch::after {
        transform: translateX(20px);
      }

      .toggle-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-primary);
      }

      /* Buttons */
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 10px 16px;
        font-family: inherit;
        font-size: 14px;
        font-weight: 500;
        border-radius: var(--radius-md);
        border: 1px solid transparent;
        cursor: pointer;
        text-decoration: none;
        transition: all var(--transition-fast);
        white-space: nowrap;
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-primary {
        background: var(--accent-primary);
        color: white;
        box-shadow: var(--shadow-sm);
      }

      .btn-primary:hover:not(:disabled) {
        background: var(--accent-primary-hover);
        box-shadow: var(--shadow-md);
      }

      .btn-secondary {
        background: var(--bg-primary);
        color: var(--text-primary);
        border-color: var(--border-default);
      }

      .btn-secondary:hover:not(:disabled) {
        background: var(--bg-hover);
        border-color: var(--border-strong);
      }

      .btn-ghost {
        background: transparent;
        color: var(--text-secondary);
      }

      .btn-ghost:hover:not(:disabled) {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .btn-danger {
        background: var(--error-bg);
        color: var(--error-text);
      }

      .btn-danger:hover:not(:disabled) {
        background: var(--error-border);
      }

      .btn-warning {
        background: var(--warning-bg);
        color: var(--warning-text);
      }

      .btn-warning:hover:not(:disabled) {
        background: var(--warning-border);
      }

      .btn-sm {
        padding: 8px 12px;
        font-size: 13px;
      }

      .btn-lg {
        padding: 12px 20px;
        font-size: 15px;
      }

      /* Tabs */
      .tabs {
        display: flex;
        gap: 4px;
        padding: 4px;
        background: var(--bg-tertiary);
        border-radius: var(--radius-lg);
      }

      .tab {
        padding: 8px 14px;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-secondary);
        background: transparent;
        border: none;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .tab:hover {
        color: var(--text-primary);
      }

      .tab.active {
        background: var(--bg-primary);
        color: var(--text-primary);
        box-shadow: var(--shadow-xs);
      }

      /* Message */
      .message {
        padding: 12px 16px;
        border-radius: var(--radius-md);
        font-size: 14px;
      }

      .message-success {
        background: var(--success-bg);
        color: var(--success-text);
      }

      .message-error {
        background: var(--error-bg);
        color: var(--error-text);
      }

      .hidden {
        display: none !important;
      }

      .mt-4 { margin-top: 16px; }
      .mt-6 { margin-top: 24px; }
      .text-center { text-align: center; }

      /* AI Tool Panels */
      .ai-grid {
        display: grid;
        grid-template-columns: 300px 1fr;
        gap: 20px;
      }

      .ai-card {
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-lg);
        overflow: hidden;
      }

      .ai-card-body {
        padding: 20px;
      }

      .ai-tool-panel {
        display: none;
      }

      .ai-tool-panel.active {
        display: block;
      }

      /* Form Help */
      .form-help {
        margin-top: 16px;
        padding: 12px 16px;
        background: var(--bg-secondary);
        border-radius: var(--radius-md);
        font-size: 13px;
        color: var(--text-secondary);
        line-height: 1.6;
      }

      /* Responsive */
      @media (max-width: 1024px) {
        .sidebar {
          width: 200px;
        }
        .main {
          margin-left: 200px;
        }
        .stats-grid {
          grid-template-columns: 1fr;
        }
        .ai-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 768px) {
        .app {
          flex-direction: column;
        }
        .sidebar {
          position: relative;
          width: 100%;
          height: auto;
        }
        .main {
          margin-left: 0;
        }
        .platform-grid {
          grid-template-columns: 1fr;
        }
        .content {
          padding: 20px;
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-header">
          <div class="sidebar-brand">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            open-im
          </div>
        </div>
        <nav class="sidebar-nav">
          <button class="nav-item active" id="navOverviewBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
            </svg>
            <span id="navOverviewText">Dashboard</span>
          </button>
          <button class="nav-item" id="navPlatformsBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            </svg>
            <span id="navPlatformsText">Platforms</span>
          </button>
          <button class="nav-item" id="navAiBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 14a4 4 0 1 1 4-4 4 4 0 0 1-4 4z"/>
            </svg>
            <span id="navAiText">AI Tooling</span>
          </button>
          <button class="nav-item" id="navServiceBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12,6 12,12 16,14"/>
            </svg>
            <span id="navServiceText">Service</span>
          </button>
        </nav>
      </aside>

      <!-- Main Content -->
      <main class="main">
        <header class="main-header">
          <div>
            <h1 class="main-title" id="mainTitle">Dashboard</h1>
            <p class="main-subtitle" id="mainSubtitle">Platform status and setup progress</p>
          </div>
          <div class="header-actions">
            <a href="https://github.com/wu529778790/open-im" target="_blank" class="btn btn-ghost btn-sm">
              <svg style="width:16px;height:16px" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              <span id="footerGithubText">GitHub</span>
            </a>
            <button class="dark-mode-toggle" id="darkModeToggle" type="button" aria-label="Toggle dark mode">
              <svg class="sun-icon" style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="5"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
              <svg class="moon-icon" style="width:16px;height:16px;display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            </button>
            <button class="lang-button" id="langButton">中文</button>
          </div>
        </header>

        <div class="content">
          <!-- Hidden elements for script compatibility -->
          <div id="configPath" style="display:none"></div>
          <div id="overviewTitle" style="display:none"></div>
          <div id="overviewBody" style="display:none"></div>
          <div id="liveSummary" style="display:none"></div>

          <!-- Dashboard Overview Section -->
          <div id="overviewTitle" style="display:none"></div>
          <div id="overviewBody" style="display:none"></div>
          <div id="liveSummary" style="display:none"></div>

          <!-- Dashboard Overview Section -->
          <section class="section" id="dashboardSection">
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-label" id="statConfiguredLabel">Configured</div>
                <div class="stat-value" id="statConfiguredValue">0/5</div>
              </div>
              <div class="stat-card">
                <div class="stat-label" id="statEnabledLabel">Enabled</div>
                <div class="stat-value" id="statEnabledValue">0</div>
              </div>
              <div class="stat-card">
                <div class="stat-label" id="statServiceLabel">Service</div>
                <div class="stat-value" id="statServiceValue">Idle</div>
              </div>
            </div>
          </section>

          <!-- Platforms Section -->
          <section class="section" id="configSection">
            <div class="section-header">
              <h2 class="section-title" id="platformsTitle">Platforms</h2>
              <p class="section-description" id="platformsHint">Configure your IM platform credentials</p>
            </div>

            <div class="platform-grid">
              <!-- Telegram -->
              <div class="platform-card">
                <div class="platform-header">
                  <h3 class="platform-title">Telegram</h3>
                  <label class="toggle">
                    <input type="checkbox" id="telegram-enabled" class="toggle-input">
                    <span class="toggle-switch"></span>
                    <span class="toggle-label" id="telegram-label">Enabled</span>
                  </label>
                </div>
                <div class="platform-body">
                  <p class="form-hint" id="telegram-description">Bot token and optional proxy</p>
                  <div class="form-group">
                    <label class="form-label" id="telegram-botToken-label">Bot Token</label>
                    <input id="telegram-botToken" class="form-input mono" type="password" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="telegram-proxy-label">Proxy (optional)</label>
                    <input id="telegram-proxy" class="form-input mono" type="password" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="telegram-aiCommand-label">AI Tool</label>
                    <select id="telegram-aiCommand" class="form-select">
                      <option value="">(default)</option>
                      <option value="claude">claude</option>
                      <option value="codex">codex</option>
                      <option value="codebuddy">codebuddy</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="telegram-allowedUserIds-label">Allowed User IDs</label>
                    <textarea id="telegram-allowedUserIds" class="form-textarea mono"></textarea>
                    <div class="form-hint" id="telegram-allowedUserIds-hint">Leave empty to allow all users</div>
                  </div>
                  <div class="form-help" id="telegram-help">Get credentials: visit @BotFather, send /newbot, then copy the Bot Token</div>
                  <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    <button id="test-telegram" class="btn btn-secondary btn-sm" type="button">Test Configuration</button>
                  </div>
                  <div id="test-telegram-result" class="mt-4"></div>
                </div>
              </div>

              <!-- Feishu -->
              <div class="platform-card">
                <div class="platform-header">
                  <h3 class="platform-title">Feishu</h3>
                  <label class="toggle">
                    <input type="checkbox" id="feishu-enabled" class="toggle-input">
                    <span class="toggle-switch"></span>
                    <span class="toggle-label" id="feishu-label">Enabled</span>
                  </label>
                </div>
                <div class="platform-body">
                  <p class="form-hint" id="feishu-description">App ID, App Secret, and allowed user scope</p>
                  <div class="form-group">
                    <label class="form-label" id="feishu-appId-label">App ID</label>
                    <input id="feishu-appId" class="form-input mono" type="text" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="feishu-appSecret-label">App Secret</label>
                    <input id="feishu-appSecret" class="form-input mono" type="password" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="feishu-aiCommand-label">AI Tool</label>
                    <select id="feishu-aiCommand" class="form-select">
                      <option value="">(default)</option>
                      <option value="claude">claude</option>
                      <option value="codex">codex</option>
                      <option value="codebuddy">codebuddy</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="feishu-allowedUserIds-label">Allowed User IDs</label>
                    <textarea id="feishu-allowedUserIds" class="form-textarea mono"></textarea>
                  </div>
                  <div class="form-help" id="feishu-help">Get credentials: visit Feishu Open Platform, create an app, enable the bot, and copy the App ID / App Secret</div>
                  <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    <button id="test-feishu" class="btn btn-secondary btn-sm" type="button">Test Configuration</button>
                  </div>
                  <div id="test-feishu-result" class="mt-4"></div>
                </div>
              </div>

              <!-- QQ -->
              <div class="platform-card">
                <div class="platform-header">
                  <h3 class="platform-title">QQ</h3>
                  <label class="toggle">
                    <input type="checkbox" id="qq-enabled" class="toggle-input">
                    <span class="toggle-switch"></span>
                    <span class="toggle-label" id="qq-label">Enabled</span>
                  </label>
                </div>
                <div class="platform-body">
                  <p class="form-hint" id="qq-description">App ID and secret for bot access</p>
                  <div class="form-group">
                    <label class="form-label" id="qq-appId-label">App ID</label>
                    <input id="qq-appId" class="form-input mono" type="text" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="qq-secret-label">App Secret</label>
                    <input id="qq-secret" class="form-input mono" type="password" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="qq-aiCommand-label">AI Tool</label>
                    <select id="qq-aiCommand" class="form-select">
                      <option value="">(default)</option>
                      <option value="claude">claude</option>
                      <option value="codex">codex</option>
                      <option value="codebuddy">codebuddy</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="qq-allowedUserIds-label">Allowed User IDs</label>
                    <textarea id="qq-allowedUserIds" class="form-textarea mono"></textarea>
                  </div>
                  <div class="form-help" id="qq-help">Get credentials: visit QQ Open Platform, create a bot, and copy the App ID / App Secret</div>
                  <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    <button id="test-qq" class="btn btn-secondary btn-sm" type="button">Test Configuration</button>
                  </div>
                  <div id="test-qq-result" class="mt-4"></div>
                </div>
              </div>

              <!-- WeWork -->
              <div class="platform-card">
                <div class="platform-header">
                  <h3 class="platform-title">WeWork</h3>
                  <label class="toggle">
                    <input type="checkbox" id="wework-enabled" class="toggle-input">
                    <span class="toggle-switch"></span>
                    <span class="toggle-label" id="wework-label">Enabled</span>
                  </label>
                </div>
                <div class="platform-body">
                  <p class="form-hint" id="wework-description">Corp ID and secret for enterprise delivery</p>
                  <div class="form-group">
                    <label class="form-label" id="wework-corpId-label">Corp ID / Bot ID</label>
                    <input id="wework-corpId" class="form-input mono" type="text" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="wework-secret-label">Secret</label>
                    <input id="wework-secret" class="form-input mono" type="password" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="wework-aiCommand-label">AI Tool</label>
                    <select id="wework-aiCommand" class="form-select">
                      <option value="">(default)</option>
                      <option value="claude">claude</option>
                      <option value="codex">codex</option>
                      <option value="codebuddy">codebuddy</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="wework-allowedUserIds-label">Allowed User IDs</label>
                    <textarea id="wework-allowedUserIds" class="form-textarea mono"></textarea>
                  </div>
                  <div class="form-help" id="wework-help">Get credentials: visit WeWork Admin Console, create an app, and copy the Bot ID (Corp ID) / Secret</div>
                  <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    <button id="test-wework" class="btn btn-secondary btn-sm" type="button">Test Configuration</button>
                  </div>
                  <div id="test-wework-result" class="mt-4"></div>
                </div>
              </div>

              <!-- DingTalk -->
              <div class="platform-card">
                <div class="platform-header">
                  <h3 class="platform-title">DingTalk</h3>
                  <label class="toggle">
                    <input type="checkbox" id="dingtalk-enabled" class="toggle-input">
                    <span class="toggle-switch"></span>
                    <span class="toggle-label" id="dingtalk-label">Enabled</span>
                  </label>
                </div>
                <div class="platform-body">
                  <p class="form-hint" id="dingtalk-description">Client credentials plus optional card template</p>
                  <div class="form-group">
                    <label class="form-label" id="dingtalk-clientId-label">Client ID / AppKey</label>
                    <input id="dingtalk-clientId" class="form-input mono" type="password" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="dingtalk-clientSecret-label">Client Secret / AppSecret</label>
                    <input id="dingtalk-clientSecret" class="form-input mono" type="password" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="dingtalk-cardTemplateId-label">Card Template ID (optional)</label>
                    <input id="dingtalk-cardTemplateId" class="form-input mono" type="password" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="dingtalk-aiCommand-label">AI Tool</label>
                    <select id="dingtalk-aiCommand" class="form-select">
                      <option value="">(default)</option>
                      <option value="claude">claude</option>
                      <option value="codex">codex</option>
                      <option value="codebuddy">codebuddy</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="dingtalk-allowedUserIds-label">Allowed User IDs</label>
                    <textarea id="dingtalk-allowedUserIds" class="form-textarea mono"></textarea>
                  </div>
                  <div class="form-help" id="dingtalk-help">Get credentials: Create an enterprise internal app on DingTalk Open Platform, enable Stream Mode, and get Client ID / Client Secret</div>
                  <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    <button id="test-dingtalk" class="btn btn-secondary btn-sm" type="button">Test Configuration</button>
                  </div>
                  <div id="test-dingtalk-result" class="mt-4"></div>
                </div>
              </div>
            </div>
          </section>

          <!-- AI Section -->
          <section class="section" id="aiSection">
            <div class="section-header">
              <h2 class="section-title" id="aiTitle">AI Tooling</h2>
              <p class="section-description" id="aiHint">Configure AI tool settings</p>
            </div>

            <div class="ai-grid">
              <div class="ai-card">
                <div class="card-header">
                  <h3 class="card-title" id="aiCommonTitle">General Settings</h3>
                </div>
                <div class="ai-card-body">
                  <div class="form-group">
                    <label class="form-label" id="ai-aiCommand-label">Default AI Tool</label>
                    <select id="ai-aiCommand" class="form-select">
                      <option value="claude">claude</option>
                      <option value="codex">codex</option>
                      <option value="codebuddy">codebuddy</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="ai-claudeWorkDir-label">Work Directory</label>
                    <input id="ai-claudeWorkDir" class="form-input mono" type="text" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="ai-hookPort-label">Hook Port</label>
                    <input id="ai-hookPort" class="form-input" type="number" min="1" />
                  </div>
                  <div class="form-group">
                    <label class="form-label" id="ai-logLevel-label">Log Level</label>
                    <select id="ai-logLevel" class="form-select">
                      <option value="default">default</option>
                      <option value="DEBUG">DEBUG</option>
                      <option value="INFO">INFO</option>
                      <option value="WARN">WARN</option>
                      <option value="ERROR">ERROR</option>
                    </select>
                  </div>
                </div>
              </div>

              <div class="ai-card">
                <div class="card-header">
                  <div class="tabs" id="aiToolSwitcher">
                    <button class="tab active" data-tool="claude" type="button">Claude</button>
                    <button class="tab" data-tool="codex" type="button">Codex</button>
                    <button class="tab" data-tool="codebuddy" type="button">CodeBuddy</button>
                  </div>
                </div>
                <div class="ai-card-body">
                  <div id="ai-tool-claude" class="ai-tool-panel active" data-tool-panel="claude">
                    <div class="form-group">
                      <label class="form-label" id="ai-claudeTimeoutMs-label">Timeout (ms)</label>
                      <input id="ai-claudeTimeoutMs" class="form-input" type="number" min="1" />
                    </div>
                    <div class="form-group">
                      <label class="form-label" id="ai-claudeProxy-label">Proxy (optional)</label>
                      <input id="ai-claudeProxy" class="form-input mono" type="text" />
                      <div class="form-hint" id="ai-claudeProxy-hint">HTTP proxy for API requests (e.g., http://127.0.0.1:7890)</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label" id="ai-claudeConfigPath-label">Config File Location</label>
                      <input id="ai-claudeConfigPath" class="form-input mono" type="text" readonly style="background: var(--bg-secondary);" />
                      <div class="form-hint" id="ai-claudeConfigPath-hint">Environment variables are saved to ~/.claude/settings.json</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label" id="ai-claudeAuthToken-label">ANTHROPIC_AUTH_TOKEN</label>
                      <input id="ai-claudeAuthToken" class="form-input mono" type="password" />
                      <div class="form-hint" id="ai-claudeAuthToken-hint">Auth token for API access (optional, overrides env)</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label" id="ai-claudeBaseUrl-label">ANTHROPIC_BASE_URL</label>
                      <input id="ai-claudeBaseUrl" class="form-input mono" type="text" />
                      <div class="form-hint" id="ai-claudeBaseUrl-hint">Custom API base URL (optional, overrides env)</div>
                    </div>
                    <div class="form-group">
                      <label class="form-label" id="ai-claudeModel-label">ANTHROPIC_MODEL</label>
                      <input id="ai-claudeModel" class="form-input mono" type="text" />
                      <div class="form-hint" id="ai-claudeModel-hint">Model name (optional, overrides env)</div>
                    </div>
                  </div>

                  <div id="ai-tool-codex" class="ai-tool-panel" data-tool-panel="codex">
                    <div class="form-group">
                      <label class="form-label" id="ai-codexCliPath-label">CLI Path</label>
                      <input id="ai-codexCliPath" class="form-input mono" type="text" />
                    </div>
                    <div class="form-group">
                      <label class="form-label" id="ai-codexTimeoutMs-label">Timeout (ms)</label>
                      <input id="ai-codexTimeoutMs" class="form-input" type="number" min="1" />
                    </div>
                    <div class="form-group">
                      <label class="form-label" id="ai-codexProxy-label">Proxy (optional)</label>
                      <input id="ai-codexProxy" class="form-input mono" type="text" />
                    </div>
                  </div>

                  <div id="ai-tool-codebuddy" class="ai-tool-panel" data-tool-panel="codebuddy">
                    <div class="form-group">
                      <label class="form-label" id="ai-codebuddyCliPath-label">CLI Path</label>
                      <input id="ai-codebuddyCliPath" class="form-input mono" type="text" />
                    </div>
                    <div class="form-group">
                      <label class="form-label" id="ai-codebuddyTimeoutMs-label">Timeout (ms)</label>
                      <input id="ai-codebuddyTimeoutMs" class="form-input" type="number" min="1" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- Service Section -->
          <section class="section" id="serviceSection">
            <div class="section-header">
              <h2 class="section-title" id="serviceTitle">Service Control</h2>
              <p class="section-description" id="serviceHint">Manage the bridge service</p>
            </div>

            <div class="card">
              <div class="card-body">
                <div style="display: flex; gap: 12px; flex-wrap: wrap;" style="justify-content: center; gap: 16px;">
                  <button id="validateButton" class="btn btn-warning btn-lg">Validate</button>
                  <button id="saveButton" class="btn btn-secondary btn-lg">Save Config</button>
                  <button id="startButton" class="btn btn-primary btn-lg">Start Bridge</button>
                  <button id="stopButton" class="btn btn-danger btn-lg">Stop Bridge</button>
                </div>
                <div class="text-center mt-6">
                  <div id="message" class="message hidden" aria-live="polite"></div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
    <script>
`;

export const PAGE_HTML_SUFFIX = String.raw`    </script>
  </body>
</html>`;
