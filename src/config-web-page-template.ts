export const PAGE_HTML_PREFIX = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>open-im local control</title>
    <style>
      :root{--bg:#e6dfd0;--panel:rgba(255,251,242,.94);--panel-strong:#fffdf7;--ink:#13231a;--muted:#56675f;--line:rgba(19,35,26,.12);--line-strong:rgba(19,35,26,.2);--green:#1a6a44;--green-deep:#10291d;--orange:#cf6f31;--red:#9d4236;--shadow:0 28px 70px rgba(19,35,26,.14);--shadow-soft:0 14px 30px rgba(19,35,26,.08)}
      *{box-sizing:border-box}body{margin:0;font-family:Georgia,"Times New Roman",serif;color:var(--ink);background:radial-gradient(circle at top,#f4eddf 0,#e5ddce 42%,#ddd4c3 100%)}
      .shell{padding:0}.frame{max-width:none;margin:0;background:var(--panel);border:0;box-shadow:none;display:grid;grid-template-columns:300px minmax(0,1fr);position:relative;overflow:visible;align-items:start;min-height:100vh}
      .sidebar{grid-column:1;position:sticky;top:0;align-self:start;display:flex;flex-direction:column;background:linear-gradient(180deg,rgba(16,41,29,.995),rgba(19,35,26,.96));border-right:1px solid rgba(255,255,255,.08);height:100vh}
      .main-column{grid-column:2;min-width:0}
      .hero,.toolbar,.section,.footer,.nav-row{padding:24px;border-bottom:1px solid var(--line)}.hero{padding:30px 24px 28px;background:
        radial-gradient(circle at top left,rgba(242,224,178,.16),transparent 38%),
        linear-gradient(160deg,rgba(16,41,29,.99),rgba(26,106,68,.92));
        color:#f7f0df;border-bottom:1px solid rgba(255,255,255,.08);min-height:0;position:relative}
      .hero:after{content:"";position:absolute;inset:auto 22px 18px 22px;height:1px;background:linear-gradient(90deg,rgba(247,240,223,.35),transparent)}
      .hero h1,.hero p{margin:0}.hero h1{font-size:clamp(2.4rem,4vw,3.5rem);line-height:.92;letter-spacing:-.05em;margin-top:10px}.hero p{margin-top:16px;max-width:720px;color:rgba(247,240,223,.78);line-height:1.65}
      .pill{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.72);font-size:.9rem}#heroBadge{background:rgba(247,240,223,.08);border-color:rgba(247,240,223,.16);color:#f7f0df}
      .toolbar,.grid,.two-col,.footer,.actions{display:grid;gap:14px}.status-row{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between}.status-group{display:flex;flex-wrap:wrap;gap:10px}.grid{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
      .panel{padding:18px;border:1px solid var(--line);background:rgba(255,255,255,.56);box-shadow:var(--shadow-soft);transition:opacity .18s ease,transform .18s ease,border-color .18s ease}.panel:hover{transform:translateY(-1px);border-color:var(--line-strong)}.panel.off{opacity:.58}.panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.panel-head h3{color:#304338}
      h2,h3{margin:0}h2{font-size:1.55rem;letter-spacing:-.03em}h3{font-size:1.1rem}label{display:grid;gap:6px;color:var(--muted);font-size:.92rem}input,select,textarea{width:100%;padding:11px 12px;border:1px solid rgba(19,35,26,.14);background:rgba(255,255,255,.9);font:inherit;color:var(--ink)}
      .section > .panel-head:first-child h2,.footer > .panel-head:first-child h2{position:relative;padding-left:14px}
      .section > .panel-head:first-child h2:before,.footer > .panel-head:first-child h2:before{content:"";position:absolute;left:0;top:4px;bottom:4px;width:4px;border-radius:999px;background:var(--green)}
      textarea{min-height:74px;resize:vertical}.two-col{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.toggle{display:inline-flex;align-items:center;gap:10px;color:var(--ink)}.toggle input{width:18px;height:18px}
      .actions{display:flex;flex-wrap:wrap;gap:10px}button{border:0;padding:12px 16px;font:inherit;cursor:pointer;color:#fff7eb;background:var(--ink);transition:transform .16s ease,opacity .16s ease,box-shadow .16s ease}button:hover{transform:translateY(-1px);box-shadow:0 10px 18px rgba(19,35,26,.14)}button.secondary{background:var(--green)}button.warning{background:var(--orange)}button.danger{background:var(--red)}button.ghost{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.28);box-shadow:none}.overview-banner button{min-width:148px}.overview-banner button.secondary{box-shadow:0 12px 22px rgba(26,106,68,.2)}.overview-banner button:not(.secondary):not(.warning){background:rgba(19,35,26,.86)}.overview-banner button.warning{color:#fff7eb}button.nav-btn{width:100%;justify-content:flex-start;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);padding:13px 14px;color:rgba(247,240,223,.78);box-shadow:none;position:relative}button.nav-btn:before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:999px;background:transparent;transition:background .16s ease}button.nav-btn.active{background:rgba(247,240,223,.95);color:var(--ink);border-color:rgba(247,240,223,.95)}button.nav-btn.active:before{background:var(--green)}button:disabled{opacity:.5;cursor:wait;transform:none;box-shadow:none}
      .message{min-height:24px;color:var(--muted)}.message.success{color:var(--green)}.message.error{color:var(--red)}.mono{font-family:Consolas,monospace}.summary{color:var(--muted)}.note{border-left:4px solid var(--orange)}.nav-row{background:transparent;border-bottom:0;padding-top:12px;position:relative;display:flex;flex-direction:column;flex:1;min-height:0}
      .nav-row .actions{display:grid;gap:8px}
      .nav-group-label{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(247,240,223,.42);margin:0 0 12px 2px}
      .sidebar-note{margin-top:18px;padding:14px;border:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.03));border-radius:14px;color:rgba(247,240,223,.86)}.sidebar-note strong{display:block;margin-bottom:8px;font-size:.96rem}.sidebar-note .summary{color:rgba(247,240,223,.66);line-height:1.58;font-size:.92rem}
      .brand-kicker{font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(247,240,223,.52);margin-top:20px}
      .brand-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:0}
      .sidebar-spacer{flex:1}
      .sidebar-footer{padding:0 24px 24px}
      .link-chip{display:flex;align-items:center;justify-content:space-between;width:100%;padding:14px 16px;border:1px solid rgba(255,255,255,.1);border-radius:16px;color:#f7f0df;text-decoration:none;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02));transition:transform .16s ease,background .16s ease,border-color .16s ease}
      .link-chip:hover{transform:translateY(-1px);background:linear-gradient(180deg,rgba(255,255,255,.1),rgba(255,255,255,.04));border-color:rgba(255,255,255,.18)}
      .link-chip:after{content:">";font-size:1rem;color:rgba(247,240,223,.72)}
      .overview-banner{padding:20px 22px;border:1px solid rgba(26,106,68,.16);background:linear-gradient(135deg,rgba(26,106,68,.14),rgba(255,255,255,.58));margin-bottom:18px;position:relative;overflow:hidden}.overview-banner:after{content:"";position:absolute;top:-40px;right:-10px;width:160px;height:160px;border-radius:50%;background:radial-gradient(circle,rgba(242,224,178,.28),transparent 65%)}.overview-banner h3{margin-bottom:8px;position:relative}.overview-banner .summary,.overview-banner .actions{position:relative}.overview-banner .actions{margin-top:14px}
      .stats-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:16px}
      .stat-card{padding:18px;border:1px solid var(--line);background:var(--panel-strong);box-shadow:var(--shadow-soft)}
      .stat-label{font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
      .stat-value{margin-top:10px;font-size:2rem;line-height:1;font-weight:700;letter-spacing:-.05em}
      .stat-meta{margin-top:8px;color:var(--muted);font-size:.92rem}
      #healthGrid .panel{background:rgba(255,255,255,.68)}
      #healthGrid .panel.off{background:rgba(255,255,255,.38);border-style:dashed}
      #healthGrid .pill{font-size:.82rem;font-weight:700}
      #configSection .panel,#aiSection .panel,#serviceSection{background:rgba(255,253,247,.82)}
      #configSection .panel-head,#aiSection .panel-head,#serviceSection .panel-head{margin-bottom:14px}
      #configSection .panel .summary,#aiSection .panel .summary{line-height:1.58}
      #serviceSection .actions{grid-template-columns:repeat(auto-fit,minmax(170px,1fr));align-items:stretch}
      #startButton{background:var(--green);box-shadow:0 12px 22px rgba(26,106,68,.18)}
      #saveButton{background:rgba(19,35,26,.88)}
      #validateButton{background:rgba(207,111,49,.92)}
      #stopButton{background:rgba(157,66,54,.92)}
      #quickActionsSection,#configToolbar,#configSection,#aiSection,#serviceSection{border-top:1px solid var(--line)}
      @media (max-width:980px){.frame{grid-template-columns:1fr}.sidebar,.main-column{grid-column:1;grid-row:auto}.sidebar{position:static;height:auto;border-right:0}.hero,.nav-row{border-right:0}.nav-row{padding-top:16px}.sidebar-footer{padding:0 24px 24px}.stats-grid{grid-template-columns:1fr}}
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="frame">
        <aside class="sidebar">
        <section class="hero">
          <div class="status-row">
            <div class="pill" id="heroBadge">open-im</div>
            <button id="langButton" class="ghost" type="button">&#20013;&#25991;</button>
          </div>
          <div class="brand-kicker" id="heroKicker">Local AI bridge</div>
          <h1 id="heroTitle">open-im</h1>
          <p id="heroBody">Run one local bridge for Telegram, Feishu, QQ, WeWork, and DingTalk.</p>
        </section>
        <section class="nav-row">
          <div class="nav-group-label">Control center</div>
          <div class="actions">
            <button id="navOverviewBtn" class="nav-btn" type="button">Overview</button>
            <button id="navPlatformsBtn" class="nav-btn" type="button">Platforms</button>
            <button id="navAiBtn" class="nav-btn" type="button">AI Tools</button>
            <button id="navServiceBtn" class="nav-btn" type="button">Service</button>
          </div>
          <article class="sidebar-note">
            <strong id="sidebarNoteTitle">Local workflow</strong>
            <div class="summary" id="sidebarNoteBody">Configure one platform, save the config, then start the bridge.</div>
          </article>
        </section>
        <div class="sidebar-spacer"></div>
        <div class="sidebar-footer">
          <div class="brand-actions">
            <a id="heroRepo" class="link-chip" href="https://github.com/wu529778790/open-im" target="_blank" rel="noreferrer">GitHub</a>
          </div>
        </div>
        </aside>
        <main class="main-column">
        <section class="section" id="dashboardSection">
          <div class="panel-head"><h2 id="dashboardTitle">Dashboard</h2><div id="dashboardSubtitle">Platform health status</div></div>
          <article class="panel overview-banner">
            <h3 id="overviewTitle">Start here</h3>
            <div class="summary" id="overviewBody">Configure at least one platform, save the configuration, then start the bridge from the service section.</div>
            <div class="actions">
              <button id="dashboardToPlatforms" class="secondary" type="button">Open Platforms</button>
              <button id="dashboardToService" class="ghost" type="button">Open Service</button>
              <button id="refreshHealth" class="warning" type="button">Refresh Health Status</button>
            </div>
          </article>
          <div class="stats-grid">
            <article class="stat-card">
              <div class="stat-label" id="statConfiguredLabel">Configured</div>
              <div class="stat-value" id="statConfiguredValue">0/5</div>
              <div class="stat-meta" id="statConfiguredMeta">Platforms with saved credentials</div>
            </article>
            <article class="stat-card">
              <div class="stat-label" id="statEnabledLabel">Enabled</div>
              <div class="stat-value" id="statEnabledValue">0</div>
              <div class="stat-meta" id="statEnabledMeta">Platforms selected for startup</div>
            </article>
            <article class="stat-card">
              <div class="stat-label" id="statServiceLabel">Service</div>
              <div class="stat-value" id="statServiceValue">Idle</div>
              <div class="stat-meta" id="statServiceMeta">Bridge has not been started yet</div>
            </article>
          </div>
          <div class="grid" id="healthGrid" style="margin-top:16px;">
            <article class="panel" id="health-telegram">
              <div class="panel-head"><h3>Telegram</h3><div class="pill" id="health-telegram-status">Checking...</div></div>
              <div class="summary" id="health-telegram-message" style="margin-top:8px;"></div>
            </article>
            <article class="panel" id="health-feishu">
              <div class="panel-head"><h3>Feishu</h3><div class="pill" id="health-feishu-status">Checking...</div></div>
              <div class="summary" id="health-feishu-message" style="margin-top:8px;"></div>
            </article>
            <article class="panel" id="health-qq">
              <div class="panel-head"><h3>QQ</h3><div class="pill" id="health-qq-status">Checking...</div></div>
              <div class="summary" id="health-qq-message" style="margin-top:8px;"></div>
            </article>
            <article class="panel" id="health-wework">
              <div class="panel-head"><h3>WeWork</h3><div class="pill" id="health-wework-status">Checking...</div></div>
              <div class="summary" id="health-wework-message" style="margin-top:8px;"></div>
            </article>
            <article class="panel" id="health-dingtalk">
              <div class="panel-head"><h3>DingTalk</h3><div class="pill" id="health-dingtalk-status">Checking...</div></div>
              <div class="summary" id="health-dingtalk-message" style="margin-top:8px;"></div>
            </article>
          </div>
        </section>
        <section class="section" id="quickActionsSection" style="display:none;">
          <div class="panel-head"><h2 id="quickActionsTitle">Quick Actions</h2></div>
        </section>
        <section class="toolbar" id="configToolbar">
          <div class="status-group">
            <div class="pill mono" id="configPath"></div>
            <div class="pill" id="serviceState"></div>
            <div class="pill" id="modeBadge"></div>
          </div>
          <div id="statusMeta"></div>
          <div class="summary" id="liveSummary"></div>
        </section>
        <section class="section" id="configSection">
          <div class="panel-head"><h2 id="platformsTitle">Platforms</h2><div id="platformsHint">Disabled platforms keep their saved values.</div></div>
          <div class="grid">
            <article class="panel" id="telegram-panel">
              <div class="panel-head"><h3>Telegram</h3><label class="toggle"><input id="telegram-enabled" type="checkbox" /> <span id="telegram-enabled-label">Enabled</span></label></div>
              <div class="summary" id="telegram-help" style="margin-bottom:12px;color:var(--muted);font-size:0.9em;">Get credentials: visit <a href="https://t.me/BotFather" target="_blank" style="color:var(--green);text-decoration:underline;">@BotFather</a>, send /newbot, then copy the Bot Token</div>
              <label><span id="telegram-aiCommand-label">AI tool override</span><select id="telegram-aiCommand"><option value="">Use default AI tool</option><option value="claude">claude</option><option value="codex">codex</option><option value="cursor">cursor</option></select></label>
              <label><span id="telegram-botToken-label">Bot token</span><input id="telegram-botToken" type="password" autocomplete="off" placeholder="123456:ABC..." /></label>
              <label><span id="telegram-proxy-label">Proxy</span><input id="telegram-proxy" placeholder="http://127.0.0.1:7890" /></label>
              <label><span id="telegram-allowedUserIds-label">Allowed user IDs</span><textarea id="telegram-allowedUserIds" placeholder="Comma-separated IDs"></textarea></label>
              <div style="margin-top:12px;"><button id="test-telegram" class="secondary" type="button" style="width:100%;padding:8px;font-size:0.9em;">校验配置</button><div class="message" id="test-telegram-result" aria-live="polite" style="min-height:20px;margin-top:8px;"></div></div>
            </article>
            <article class="panel" id="feishu-panel">
              <div class="panel-head"><h3>Feishu</h3><label class="toggle"><input id="feishu-enabled" type="checkbox" /> <span id="feishu-enabled-label">Enabled</span></label></div>
              <div class="summary" id="feishu-help" style="margin-bottom:12px;color:var(--muted);font-size:0.9em;">Get credentials: visit <a href="https://open.feishu.cn/" target="_blank" style="color:var(--green);text-decoration:underline;">Feishu Open Platform</a>, create an app, enable the bot, and copy the App ID / App Secret</div>
              <label><span id="feishu-aiCommand-label">AI tool override</span><select id="feishu-aiCommand"><option value="">Use default AI tool</option><option value="claude">claude</option><option value="codex">codex</option><option value="cursor">cursor</option></select></label>
              <label><span id="feishu-appId-label">App ID</span><input id="feishu-appId" /></label>
              <label><span id="feishu-appSecret-label">App Secret</span><input id="feishu-appSecret" type="password" autocomplete="off" /></label>
              <label><span id="feishu-allowedUserIds-label">Allowed user IDs</span><textarea id="feishu-allowedUserIds" placeholder="Comma-separated IDs"></textarea></label>
              <div style="margin-top:12px;"><button id="test-feishu" class="secondary" type="button" style="width:100%;padding:8px;font-size:0.9em;">校验配置</button><div class="message" id="test-feishu-result" aria-live="polite" style="min-height:20px;margin-top:8px;"></div></div>
            </article>
            <article class="panel" id="qq-panel">
              <div class="panel-head"><h3>QQ</h3><label class="toggle"><input id="qq-enabled" type="checkbox" /> <span id="qq-enabled-label">Enabled</span></label></div>
              <div class="summary" id="qq-help" style="margin-bottom:12px;color:var(--muted);font-size:0.9em;">Get credentials: visit <a href="https://bot.q.qq.com" target="_blank" style="color:var(--green);text-decoration:underline;">QQ Open Platform</a>, create a bot, and copy the App ID / App Secret</div>
              <label><span id="qq-aiCommand-label">AI tool override</span><select id="qq-aiCommand"><option value="">Use default AI tool</option><option value="claude">claude</option><option value="codex">codex</option><option value="cursor">cursor</option></select></label>
              <label><span id="qq-appId-label">App ID</span><input id="qq-appId" /></label>
              <label><span id="qq-secret-label">App Secret</span><input id="qq-secret" type="password" autocomplete="off" /></label>
              <label><span id="qq-allowedUserIds-label">Allowed user IDs</span><textarea id="qq-allowedUserIds" placeholder="Comma-separated IDs"></textarea></label>
              <div style="margin-top:12px;"><button id="test-qq" class="secondary" type="button" style="width:100%;padding:8px;font-size:0.9em;">校验配置</button><div class="message" id="test-qq-result" aria-live="polite" style="min-height:20px;margin-top:8px;"></div></div>
            </article>
            <article class="panel" id="wework-panel">
              <div class="panel-head"><h3>WeWork</h3><label class="toggle"><input id="wework-enabled" type="checkbox" /> <span id="wework-enabled-label">Enabled</span></label></div>
              <div class="summary" id="wework-help" style="margin-bottom:12px;color:var(--muted);font-size:0.9em;">Get credentials: visit <a href="https://work.weixin.qq.com/" target="_blank" style="color:var(--green);text-decoration:underline;">WeWork Admin Console</a>, create an app, and copy the Bot ID (Corp ID) / Secret</div>
              <label><span id="wework-aiCommand-label">AI tool override</span><select id="wework-aiCommand"><option value="">Use default AI tool</option><option value="claude">claude</option><option value="codex">codex</option><option value="cursor">cursor</option></select></label>
              <label><span id="wework-corpId-label">Corp ID / Bot ID</span><input id="wework-corpId" /></label>
              <label><span id="wework-secret-label">Secret</span><input id="wework-secret" type="password" autocomplete="off" /></label>
              <label><span id="wework-allowedUserIds-label">Allowed user IDs</span><textarea id="wework-allowedUserIds" placeholder="Comma-separated IDs"></textarea></label>
              <div style="margin-top:12px;"><button id="test-wework" class="secondary" type="button" style="width:100%;padding:8px;font-size:0.9em;">校验配置</button><div class="message" id="test-wework-result" aria-live="polite" style="min-height:20px;margin-top:8px;"></div></div>
            </article>
            <article class="panel" id="dingtalk-panel">
              <div class="panel-head"><h3>DingTalk</h3><label class="toggle"><input id="dingtalk-enabled" type="checkbox" /> <span id="dingtalk-enabled-label">Enabled</span></label></div>
              <div class="summary" id="dingtalk-help" style="margin-bottom:12px;color:var(--muted);font-size:0.9em;">Get credentials: create an enterprise internal app on DingTalk Open Platform, enable Stream Mode, and copy the Client ID / Client Secret</div>
              <label><span id="dingtalk-aiCommand-label">AI tool override</span><select id="dingtalk-aiCommand"><option value="">Use default AI tool</option><option value="claude">claude</option><option value="codex">codex</option><option value="cursor">cursor</option></select></label>
              <label><span id="dingtalk-clientId-label">Client ID / AppKey</span><input id="dingtalk-clientId" /></label>
              <label><span id="dingtalk-clientSecret-label">Client Secret / AppSecret</span><input id="dingtalk-clientSecret" type="password" autocomplete="off" /></label>
              <label><span id="dingtalk-cardTemplateId-label">Card template ID</span><input id="dingtalk-cardTemplateId" placeholder="Optional" /></label>
              <label><span id="dingtalk-allowedUserIds-label">Allowed user IDs</span><textarea id="dingtalk-allowedUserIds" placeholder="Comma-separated IDs"></textarea></label>
              <div style="margin-top:12px;"><button id="test-dingtalk" class="secondary" type="button" style="width:100%;padding:8px;font-size:0.9em;">校验配置</button><div class="message" id="test-dingtalk-result" aria-live="polite" style="min-height:20px;margin-top:8px;"></div></div>
            </article>
          </div>
        </section>
        <section class="section" id="aiSection">
          <div class="panel-head"><h2 id="aiTitle">AI Tooling</h2><div id="aiHint">WeChat is intentionally excluded from this first version.</div></div>
          <article class="panel note" id="claudeNote">Claude credentials are still read from environment variables or ~/.claude/settings.json. This page manages local bridge config, not Claude account auth.</article>
          <article class="panel">
            <div class="two-col">
              <label><span id="ai-aiCommand-label">Default AI tool</span><select id="ai-aiCommand"><option value="claude">claude</option><option value="codex">codex</option><option value="cursor">cursor</option></select></label>
              <label><span id="ai-claudeWorkDir-label">Default work directory</span><input id="ai-claudeWorkDir" class="mono" /></label>
              <label><span id="ai-claudeCliPath-label">Claude CLI path</span><input id="ai-claudeCliPath" class="mono" /></label>
              <label><span id="ai-cursorCliPath-label">Cursor CLI path</span><input id="ai-cursorCliPath" class="mono" /></label>
              <label><span id="ai-codexCliPath-label">Codex CLI path</span><input id="ai-codexCliPath" class="mono" /></label>
              <label><span id="ai-codexProxy-label">Codex proxy</span><input id="ai-codexProxy" class="mono" placeholder="Optional" /></label>
              <label><span id="ai-claudeTimeoutMs-label">Claude timeout (ms)</span><input id="ai-claudeTimeoutMs" type="number" min="1" /></label>
              <label><span id="ai-codexTimeoutMs-label">Codex timeout (ms)</span><input id="ai-codexTimeoutMs" type="number" min="1" /></label>
              <label><span id="ai-claudeModel-label">Claude model</span><input id="ai-claudeModel" placeholder="Optional" /></label>
              <label><span id="ai-hookPort-label">Hook port</span><input id="ai-hookPort" type="number" min="1" /></label>
              <label><span id="ai-logLevel-label">Log level</span><select id="ai-logLevel"><option value="default">default</option><option value="DEBUG">DEBUG</option><option value="INFO">INFO</option><option value="WARN">WARN</option><option value="ERROR">ERROR</option></select></label>
            </div>
            <div class="actions" style="margin-top:14px">
              <label class="toggle"><input id="ai-claudeSkipPermissions" type="checkbox" /> <span id="ai-claudeSkipPermissions-label">Auto-approve tool permissions</span></label>
              <label class="toggle"><input id="ai-useSdkMode" type="checkbox" /> <span id="ai-useSdkMode-label">Use Claude SDK mode</span></label>
            </div>
          </article>
        </section>
        <section class="footer" id="serviceSection">
          <div class="panel-head"><h2 id="serviceTitle">Service Control</h2><div id="serviceHint">Validate, save, start, and stop the local bridge from one place.</div></div>
          <div class="actions">
            <button id="validateButton" class="warning">Validate</button>
            <button id="saveButton" class="secondary">Save config</button>
            <button id="startButton">Start bridge</button>
            <button id="stopButton" class="danger">Stop bridge</button>
          </div>
          <div class="message" id="message" aria-live="polite"></div>
        </section>
        </main>
      </div>
    </div>
    <script>
`;

export const PAGE_HTML_SUFFIX = String.raw`    </script>
  </body>
</html>`;
