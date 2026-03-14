export const PAGE_SCRIPT = String.raw`      const platformDefinitions = [
        { key: "telegram", label: "Telegram", fields: ["aiCommand", "botToken", "proxy", "allowedUserIds"], testFields: ["botToken", "proxy"], requiredFields: ["botToken"] },
        { key: "feishu", label: "Feishu", fields: ["aiCommand", "appId", "appSecret", "allowedUserIds"], testFields: ["appId", "appSecret"], requiredFields: ["appId", "appSecret"] },
        { key: "qq", label: "QQ", fields: ["aiCommand", "appId", "secret", "allowedUserIds"], testFields: ["appId", "secret"], requiredFields: ["appId", "secret"] },
        { key: "wework", label: "WeWork", fields: ["aiCommand", "corpId", "secret", "allowedUserIds"], testFields: ["corpId", "secret"], requiredFields: ["corpId", "secret"] },
        { key: "dingtalk", label: "DingTalk", fields: ["aiCommand", "clientId", "clientSecret", "cardTemplateId", "allowedUserIds"], testFields: ["clientId", "clientSecret"], requiredFields: ["clientId", "clientSecret"] },
      ];
      const platformKeys = platformDefinitions.map((platform) => platform.key);
      const aiTools = ["claude", "codex", "cursor", "codebuddy"];
      const STORAGE_KEY_LANG = "open-im-web-lang";
      const POLLING_INTERVAL = 10000;
      const toolLabels = { claude: "Claude", codex: "Codex", cursor: "Cursor", codebuddy: "CodeBuddy" };
      const ids = platformDefinitions.flatMap((platform) => ["enabled", ...platform.fields].map((field) => platform.key + "-" + field)).concat(["ai-aiCommand","ai-claudeCliPath","ai-claudeWorkDir","ai-claudeSkipPermissions","ai-claudeTimeoutMs","ai-codexTimeoutMs","ai-codebuddyTimeoutMs","ai-claudeModel","ai-cursorCliPath","ai-codexCliPath","ai-codebuddyCliPath","ai-codexProxy","ai-hookPort","ai-logLevel","ai-useSdkMode"]);
      const el = (id) => document.getElementById(id);
      const texts = __PAGE_TEXTS__;
      let currentMeta = null;
      let cachedDashboardData = null;
      let cachedServiceData = null;
      let currentLang = (localStorage.getItem(STORAGE_KEY_LANG) || "").startsWith("zh") ? "zh" : ((navigator.language || "").startsWith("zh") ? "zh" : "en");
      const t = (key, params={}) => {
        const source = texts[currentLang] || texts.en;
        const template = source[key] || texts.en[key] || key;
        return Object.keys(params).reduce((result, name) => result.replaceAll("{" + name + "}", String(params[name])), template);
      };
      const setText = (id, value) => { const node = el(id); if (node) node.textContent = value; };
      const getValue = (id) => el(id).value;
      const getChecked = (id) => el(id).checked;
      const getNumber = (id) => Number(getValue(id) || "0");
      const setValue = (id, value) => { const node = el(id); if (node) node.value = value ?? ""; };
      const setChecked = (id, value) => { const node = el(id); if (node) node.checked = Boolean(value); };
      const setMessage = (text, type="") => { const node = el("message"); node.textContent = text; node.className = ("message " + type).trim(); };
      const setBusy = (busy) => ["validateButton","saveButton","startButton","stopButton","langButton"].forEach((id) => { el(id).disabled = busy; });
      const getActiveAiTool = () => el("ai-aiCommand").value || "claude";
      const readPlatformConfig = (platform) => platform.testFields.reduce((config, field) => {
        config[field] = getValue(platform.key + "-" + field);
        return config;
      }, {});
      const countCompletedFields = (platform, fields) => fields.reduce((count, field) => count + (getValue(platform.key + "-" + field).trim() ? 1 : 0), 0);
      const fillPlatform = (platform, values) => {
        setChecked(platform.key + "-enabled", values.enabled);
        platform.fields.forEach((field) => setValue(platform.key + "-" + field, values[field]));
      };
      function updatePlatformCardState(platform) {
        const active = el(platform.key + "-enabled").checked;
        const requiredCount = platform.requiredFields.length;
        const completedCount = countCompletedFields(platform, platform.requiredFields);
        const stateNode = el(platform.key + "-state");
        const progressNode = el(platform.key + "-progress");
        const panelNode = el(platform.key + "-panel");
        if (progressNode) {
          progressNode.textContent = t("credentialProgress", { done: completedCount, total: requiredCount });
        }
        if (!stateNode || !panelNode) return;
        stateNode.classList.remove("is-ready", "is-off");
        if (!active) {
          stateNode.textContent = t("disabled");
          stateNode.classList.add("is-off");
          return;
        }
        if (completedCount >= requiredCount) {
          stateNode.textContent = t("readyState");
          stateNode.classList.add("is-ready");
          return;
        }
        stateNode.textContent = t("setupRequired");
      }
      // Data-driven language update mapping
      const LANGUAGE_UPDATES = {
        simpleText: [
          { id: "heroBadge", value: "open-im" },
          { id: "heroTitle", value: "open-im" },
          { id: "heroKicker", key: "heroKicker" },
          { id: "heroRepo", value: "GitHub" },
          { id: "langButton", key: "langButton" },
          { id: "sidebarNoteTitle", key: "sidebarNoteTitle" },
          { id: "sidebarNoteBody", key: "sidebarNoteBody" },
          { id: "platformsTitle", key: "platformsTitle" },
          { id: "platformsHint", key: "platformsHint" },
          { id: "aiTitle", key: "aiTitle" },
          { id: "serviceTitle", key: "serviceTitle" },
          { id: "serviceHint", key: "serviceHint" },
          { id: "overviewTitle", key: "overviewTitle" },
          { id: "overviewBody", key: "overviewBody" },
          { id: "dashboardTitle", key: "dashboardTitle" },
          { id: "dashboardSubtitle", key: "dashboardSubtitleFull" },
          { id: "quickActionsTitle", key: "quickActionsTitle" },
          { id: "statConfiguredLabel", key: "statConfiguredLabel" },
          { id: "statConfiguredMeta", key: "statConfiguredMeta" },
          { id: "statEnabledLabel", key: "statEnabledLabel" },
          { id: "statEnabledMeta", key: "statEnabledMeta" },
          { id: "statServiceLabel", key: "statServiceLabel" },
          { id: "dashboardToPlatforms", key: "openPlatforms" },
          { id: "dashboardToService", key: "openService" },
          { id: "refreshHealth", key: "refreshHealth" },
        ],
        querySelectorText: [
          { query: ".nav-group-label", key: "controlCenter" },
        ],
        innerHtml: [
          { id: "claudeNote", key: "claudeNote" },
        ],
        platformLabels: [
          { suffix: "enabled-label", key: "enabled" },
          { suffix: "summary", keys: { telegram: "telegramSummary", feishu: "feishuSummary", qq: "qqSummary", wework: "weworkSummary", dingtalk: "dingtalkSummary" } },
          { suffix: "aiCommand-label", key: "platformAiTool" },
        ],
        platformHelp: [
          { platform: "telegram", key: "telegramHelp" },
          { platform: "feishu", key: "feishuHelp" },
          { platform: "qq", key: "qqHelp" },
          { platform: "wework", key: "weworkHelp" },
          { platform: "dingtalk", key: "dingtalkHelp" },
        ],
        aiLabels: [
          { id: "aiCommonTitle", key: "aiCommonTitle" },
          { id: "aiCommonHint", key: "aiCommonHint" },
          { id: "aiToolConfigTitle", key: "aiToolConfigTitle" },
          { id: "aiToolConfigHint", key: "aiToolConfigHint" },
          { id: "ai-aiCommand-label", key: "aiTool" },
          { id: "ai-claudeWorkDir-label", key: "workDir" },
          { id: "ai-claudeCliPath-label", key: "claudeCli" },
          { id: "ai-cursorCliPath-label", key: "cursorCli" },
          { id: "ai-codexCliPath-label", key: "codexCli" },
          { id: "ai-codebuddyCliPath-label", key: "codebuddyCli" },
          { id: "ai-codexProxy-label", key: "codexProxy" },
          { id: "ai-claudeTimeoutMs-label", key: "claudeTimeout" },
          { id: "ai-codexTimeoutMs-label", key: "codexTimeout" },
          { id: "ai-codebuddyTimeoutMs-label", key: "codebuddyTimeout" },
          { id: "ai-claudeModel-label", key: "claudeModel" },
          { id: "ai-hookPort-label", key: "hookPort" },
          { id: "ai-logLevel-label", key: "logLevel" },
          { id: "ai-claudeSkipPermissions-label", key: "autoApprove" },
          { id: "ai-useSdkMode-label", key: "sdkMode" },
        ],
        aiSectionLabels: [
          { id: "ai-claudeSectionLabel", value: "Claude" },
          { id: "ai-codexSectionLabel", value: "Codex" },
          { id: "ai-cursorSectionLabel", value: "Cursor" },
          { id: "ai-codebuddySectionLabel", value: "CodeBuddy" },
        ],
        buttons: [
          { id: "validateButton", key: "validate" },
          { id: "saveButton", key: "save" },
          { id: "startButton", key: "start" },
          { id: "stopButton", key: "stop" },
        ],
        platformFieldLabels: [
          { platform: "telegram", fields: [{ field: "botToken", key: "botToken" }, { field: "proxy", key: "proxy" }, { field: "allowedUserIds", key: "allowedUserIds" }] },
          { platform: "feishu", fields: [{ field: "appId", key: "appId" }, { field: "appSecret", key: "appSecret" }, { field: "allowedUserIds", key: "allowedUserIds" }] },
          { platform: "qq", fields: [{ field: "appId", key: "qqAppId" }, { field: "secret", key: "qqAppSecret" }, { field: "allowedUserIds", key: "allowedUserIds" }] },
          { platform: "wework", fields: [{ field: "corpId", key: "corpId" }, { field: "secret", key: "secret" }, { field: "allowedUserIds", key: "allowedUserIds" }] },
          { platform: "dingtalk", fields: [{ field: "clientId", key: "clientId" }, { field: "clientSecret", key: "clientSecret" }, { field: "cardTemplateId", key: "cardTemplateId" }, { field: "allowedUserIds", key: "allowedUserIds" }] },
        ],
        placeholders: [
          { ids: ["telegram-allowedUserIds", "feishu-allowedUserIds", "qq-allowedUserIds", "wework-allowedUserIds", "dingtalk-allowedUserIds"], key: "commaSeparatedIds" },
          { ids: ["dingtalk-cardTemplateId", "ai-codexProxy", "ai-claudeModel"], key: "optional" },
        ],
        sharedLabels: [
          { id: "platformCredentialsTitle", key: "platformCredentialsTitle" },
          { id: "platformAccessTitle", key: "platformAccessTitle" },
          { id: "platformTestNote", key: "platformTestNote" },
        ],
        navButtons: [
          { id: "navOverviewBtn", key: "dashboardTitle" },
          { id: "navPlatformsBtn", key: "platformsTitle" },
          { id: "navAiBtn", key: "aiTitle" },
          { id: "navServiceBtn", key: "serviceTitle" },
        ],
      };

      function applyLanguage(meta) {
        if (meta) currentMeta = meta;
        const isZh = currentLang === "zh";
        document.documentElement.lang = isZh ? "zh-CN" : "en";
        document.title = t("pageTitle");
        el("heroBody").textContent = t("heroBodyFull");
        el("heroBody").style.display = "block";

        // Simple text updates
        LANGUAGE_UPDATES.simpleText.forEach(({ id, value, key }) => {
          const node = el(id);
          if (node) node.textContent = value ?? t(key);
        });

        // QuerySelector text updates
        LANGUAGE_UPDATES.querySelectorText.forEach(({ query, key }) => {
          const node = document.querySelector(query);
          if (node) node.textContent = t(key);
        });

        // InnerHTML updates
        LANGUAGE_UPDATES.innerHtml.forEach(({ id, key }) => {
          const node = el(id);
          if (node) node.innerHTML = t(key);
        });

        // Platform labels
        LANGUAGE_UPDATES.platformLabels.forEach(({ suffix, key, keys }) => {
          platformKeys.forEach((platform) => {
            const node = el(platform + "-" + suffix);
            if (node) node.textContent = keys ? t(keys[platform]) : t(key);
          });
        });

        // Platform help
        LANGUAGE_UPDATES.platformHelp.forEach(({ platform, key }) => {
          const node = el(platform + "-help");
          if (node) node.innerHTML = t(key);
        });

        // AI labels
        LANGUAGE_UPDATES.aiLabels.forEach(({ id, key }) => {
          const node = el(id);
          if (node) node.textContent = t(key);
        });

        // AI section labels
        LANGUAGE_UPDATES.aiSectionLabels.forEach(({ id, value }) => {
          const node = el(id);
          if (node) node.textContent = value;
        });

        // Platform field labels
        LANGUAGE_UPDATES.platformFieldLabels.forEach(({ platform, fields }) => {
          fields.forEach(({ field, key }) => {
            const node = el(platform + "-" + field + "-label");
            if (node) node.textContent = t(key);
          });
        });

        // Shared labels
        LANGUAGE_UPDATES.sharedLabels.forEach(({ id, key }) => {
          const node = el(id);
          if (node) node.textContent = t(key);
        });

        // Placeholders
        LANGUAGE_UPDATES.placeholders.forEach(({ ids, key }) => {
          ids.forEach((id) => {
            const node = el(id);
            if (node) node.placeholder = t(key);
          });
        });

        // AI select option
        const aiHint = t("aiHint");
        const aiHintNode = el("aiHint");
        if (aiHintNode) {
          aiHintNode.textContent = aiHint;
          aiHintNode.style.display = aiHint ? "block" : "none";
        }

        // Platform AI command select options
        platformKeys.forEach((platform) => {
          const select = el(platform + "-aiCommand");
          if (select?.options?.length) {
            select.options[0].text = t("inheritDefaultAi");
          }
        });

        // Log level options
        const logLevelSelect = el("ai-logLevel");
        if (logLevelSelect?.options) {
          logLevelSelect.options[0].text = t("logLevelDefault");
          if (!logLevelSelect.value) logLevelSelect.value = "default";
        }

        // Tool switcher buttons
        document.querySelectorAll("[data-tool]").forEach((button) => {
          button.textContent = button.getAttribute("data-tool");
        });

        // Service buttons
        LANGUAGE_UPDATES.buttons.forEach(({ id, key }) => {
          const node = el(id);
          if (node) node.textContent = t(key);
        });

        // Test buttons
        platformKeys.forEach((platform) => {
          const testBtn = el("test-" + platform);
          if (testBtn) testBtn.textContent = t("test");
        });

        // Nav buttons
        LANGUAGE_UPDATES.navButtons.forEach(({ id, key }) => {
          const node = el(id);
          if (node) node.textContent = t(key);
        });

        // Mode badge
        if (currentMeta) {
          el("modeBadge").textContent = t("mode") + ": " + currentMeta.mode;
        }
      }
      function updateAiToolVisibility() {
        const activeTool = getActiveAiTool();
        aiTools.forEach((tool) => {
          const panel = document.querySelector('[data-tool-panel="' + tool + '"]');
          if (panel) {
            panel.hidden = tool !== activeTool;
          }
        });
        document.querySelectorAll("[data-tool]").forEach((button) => {
          button.classList.toggle("active", button.getAttribute("data-tool") === activeTool);
        });
        const toolLabels = { claude: "Claude", codex: "Codex", cursor: "Cursor", codebuddy: "CodeBuddy" };
        el("aiConfigSummary").textContent = t("aiConfigSummary", { tool: toolLabels[activeTool] || activeTool });
      }
      function updateVisualState() {
        const enabled = [];
        platformDefinitions.forEach((platform) => {
          const active = el(platform.key + "-enabled").checked;
          el(platform.key + "-panel").classList.toggle("off", !active);
          updatePlatformCardState(platform);
          if (active) enabled.push(platform.label);
        });
        const aiTool = el("ai-aiCommand").value;
        el("liveSummary").textContent = enabled.length
          ? t("summaryEnabled", { platforms: enabled.join(t("listSeparator")), tool: aiTool })
          : t("summaryEmpty", { tool: aiTool });
        updateAiToolVisibility();
      }
      async function updateDashboard() {
        try {
          const data = await request("/api/health");
          const platforms = data.platforms || {};
          const serviceStatus = data.serviceStatus || {};
          let configuredCount = 0;
          let enabledCount = 0;

          // Hash for change detection
          const currentStateHash = JSON.stringify({ platforms, serviceStatus });

          platformKeys.forEach((platform) => {
            const statusDiv = el("health-" + platform + "-status");
            const messageDiv = el("health-" + platform + "-message");
            const panelDiv = el("health-" + platform);

            if (!statusDiv || !messageDiv || !panelDiv) return;

            const platformData = platforms[platform] || {};
            if (platformData.configured) configuredCount += 1;
            if (platformData.enabled) enabledCount += 1;
            let statusText = "";
            let statusClass = "";
            let messageText = platformData.message || "";

            if (!platformData.configured) {
              statusText = t("notConfigured");
              statusClass = "off";
              panelDiv.classList.add("off");
            } else if (!platformData.enabled) {
              statusText = t("disabled");
              statusClass = "off";
              panelDiv.classList.add("off");
            } else if (platformData.healthy) {
              statusText = t("healthy");
              statusClass = "success";
              panelDiv.classList.remove("off");
            } else {
              statusText = t("unhealthy");
              statusClass = "error";
              panelDiv.classList.remove("off");
            }

            // Only update if text changed
            if (statusDiv.textContent !== statusText) {
              statusDiv.textContent = statusText;
            }
            if (statusClass === "success") {
              statusDiv.style.backgroundColor = "var(--green)";
            } else if (statusClass === "error") {
              statusDiv.style.backgroundColor = "var(--red)";
            } else if (statusClass === "off") {
              statusDiv.style.backgroundColor = "var(--muted)";
            } else {
              statusDiv.style.backgroundColor = "var(--orange)";
            }
            if (messageDiv.textContent !== messageText) {
              messageDiv.textContent = messageText;
            }
          });

          // Update stats with change detection
          const configuredText = configuredCount + "/" + platformKeys.length;
          const enabledText = String(enabledCount);
          const serviceText = serviceStatus.running ? t("serviceRunningShort") : t("serviceIdleShort");
          const serviceMetaText = serviceStatus.running ? t("serviceRunningMeta") : t("serviceIdleMeta");

          if (el("statConfiguredValue").textContent !== configuredText) {
            el("statConfiguredValue").textContent = configuredText;
          }
          if (el("statEnabledValue").textContent !== enabledText) {
            el("statEnabledValue").textContent = enabledText;
          }
          if (el("statServiceValue").textContent !== serviceText) {
            el("statServiceValue").textContent = serviceText;
          }
          if (el("statServiceMeta").textContent !== serviceMetaText) {
            el("statServiceMeta").textContent = serviceMetaText;
          }

          return data;
        } catch (error) {
          console.error("Failed to update dashboard:", error);
        }
      }
      function setActiveNav(target) {
        ["navOverviewBtn","navPlatformsBtn","navAiBtn","navServiceBtn"].forEach((id) => {
          el(id)?.classList.toggle("active", id === target);
        });
      }
      function scrollToSection(id, navId) {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
        setActiveNav(navId);
      }
      function showDashboard() {
        scrollToSection("dashboardSection", "navOverviewBtn");
        updateDashboard();
      }
      function showConfig() {
        scrollToSection("configSection", "navPlatformsBtn");
      }
      const payload = () => ({
        platforms: Object.fromEntries(platformDefinitions.map((platform) => [
          platform.key,
          {
            enabled: getChecked(platform.key + "-enabled"),
            ...platform.fields.reduce((values, field) => {
              values[field] = getValue(platform.key + "-" + field);
              return values;
            }, {}),
          },
        ])),
        ai: {
          aiCommand: getValue("ai-aiCommand"),
          claudeCliPath: getValue("ai-claudeCliPath"),
          claudeWorkDir: getValue("ai-claudeWorkDir"),
          claudeSkipPermissions: getChecked("ai-claudeSkipPermissions"),
          claudeTimeoutMs: getNumber("ai-claudeTimeoutMs"),
          codexTimeoutMs: getNumber("ai-codexTimeoutMs"),
          codebuddyTimeoutMs: getNumber("ai-codebuddyTimeoutMs"),
          claudeModel: getValue("ai-claudeModel"),
          cursorCliPath: getValue("ai-cursorCliPath"),
          codexCliPath: getValue("ai-codexCliPath"),
          codebuddyCliPath: getValue("ai-codebuddyCliPath"),
          codexProxy: getValue("ai-codexProxy"),
          hookPort: getNumber("ai-hookPort"),
          logLevel: getValue("ai-logLevel"),
          useSdkMode: getChecked("ai-useSdkMode"),
        },
      });
      async function request(path, options={}) { const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Request failed"); return body; }
      // AI field mappings for data-driven fill
      const AI_FIELD_MAPPINGS = [
        { id: "ai-aiCommand", key: "aiCommand", isCheckbox: false },
        { id: "ai-claudeCliPath", key: "claudeCliPath", isCheckbox: false },
        { id: "ai-claudeWorkDir", key: "claudeWorkDir", isCheckbox: false },
        { id: "ai-claudeTimeoutMs", key: "claudeTimeoutMs", isCheckbox: false, toString: true },
        { id: "ai-codexTimeoutMs", key: "codexTimeoutMs", isCheckbox: false, toString: true },
        { id: "ai-codebuddyTimeoutMs", key: "codebuddyTimeoutMs", isCheckbox: false, toString: true },
        { id: "ai-claudeModel", key: "claudeModel", isCheckbox: false },
        { id: "ai-cursorCliPath", key: "cursorCliPath", isCheckbox: false },
        { id: "ai-codexCliPath", key: "codexCliPath", isCheckbox: false },
        { id: "ai-codebuddyCliPath", key: "codebuddyCliPath", isCheckbox: false },
        { id: "ai-codexProxy", key: "codexProxy", isCheckbox: false },
        { id: "ai-hookPort", key: "hookPort", isCheckbox: false, toString: true },
        { id: "ai-claudeSkipPermissions", key: "claudeSkipPermissions", isCheckbox: true },
        { id: "ai-useSdkMode", key: "useSdkMode", isCheckbox: true },
      ];

      function fill(data, meta) {
        el("configPath").textContent = meta.configPath;
        applyLanguage(meta);
        platformDefinitions.forEach((platform) => fillPlatform(platform, data.platforms[platform.key]));
        // Data-driven AI field fill
        AI_FIELD_MAPPINGS.forEach(({ id, key, isCheckbox, toString }) => {
          const value = data.ai[key];
          if (isCheckbox) {
            setChecked(id, value);
          } else {
            setValue(id, toString ? String(value ?? "") : value ?? "");
          }
        });
        setValue("ai-logLevel", data.ai.logLevel || "default");
        updateVisualState();
      }
      async function refreshStatus() {
        const data = await request("/api/service/status");
        // Change detection - only update if state changed
        const serviceStateText = data.running ? t("bridgeRunning", { pid: data.pid }) : t("bridgeStopped");
        const statusMetaText = data.running ? t("bridgeActive") : t("bridgeInactive");
        if (el("serviceState").textContent !== serviceStateText) {
          el("serviceState").textContent = serviceStateText;
        }
        if (el("statusMeta").textContent !== statusMetaText) {
          el("statusMeta").textContent = statusMetaText;
        }
        return data;
      }
      async function boot() {
        setBusy(true);
        try {
          applyLanguage();
          const data = await request("/api/config");
          fill(data.payload, data.meta);
          await refreshStatus();
          setActiveNav("navOverviewBtn");
          await updateDashboard();
          setMessage(t("ready"), "success");
        } catch (error) {
          setMessage(error.message || String(error), "error");
        } finally {
          setBusy(false);
        }
        setInterval(() => {
          // Run API calls in parallel for efficiency
          Promise.all([
            refreshStatus().catch((err) => console.warn("[config-web] Failed to refresh status:", err)),
            updateDashboard().catch((err) => console.warn("[config-web] Failed to update dashboard:", err)),
          ]);
        }, POLLING_INTERVAL);
        ids.forEach((id) => {
          const node = el(id);
          if (node) {
            node.addEventListener("input", updateVisualState);
            node.addEventListener("change", updateVisualState);
          }
        });
        document.querySelectorAll("[data-tool]").forEach((button) => {
          button.addEventListener("click", () => {
            const tool = button.getAttribute("data-tool");
            if (!tool) return;
            setValue("ai-aiCommand", tool);
            updateVisualState();
          });
        });
      }
      async function validate() { setBusy(true); try { await request("/api/config/validate", { method: "POST", body: JSON.stringify(payload()) }); setMessage(t("validationOk"), "success"); } catch (error) { setMessage(error.message || String(error), "error"); } finally { setBusy(false); } }
      async function save() { setBusy(true); try { await request("/api/config/save?final=1", { method: "POST", body: JSON.stringify(payload()) }); setMessage(t("saveOk"), "success"); } catch (error) { setMessage(error.message || String(error), "error"); } finally { setBusy(false); } }
      async function startService() { setBusy(true); try { await request("/api/config/save", { method: "POST", body: JSON.stringify(payload()) }); await request("/api/service/start", { method: "POST" }); await refreshStatus(); setMessage(t("startOk"), "success"); } catch (error) { setMessage(error.message || String(error), "error"); } finally { setBusy(false); } }
      async function stopService() { setBusy(true); try { await request("/api/service/stop", { method: "POST" }); await refreshStatus(); setMessage(t("stopOk"), "success"); } catch (error) { setMessage(error.message || String(error), "error"); } finally { setBusy(false); } }
      async function testPlatform(platform) {
        const resultDiv = el("test-" + platform + "-result");
        const testBtn = el("test-" + platform);
        if (!resultDiv || !testBtn) return;

        const originalText = testBtn.textContent;
        testBtn.textContent = t("testing");
        testBtn.disabled = true;
        resultDiv.textContent = "";
        resultDiv.className = "message";

        try {
          const platformDefinition = platformDefinitions.find((item) => item.key === platform);
          if (!platformDefinition) {
            throw new Error("Unknown platform");
          }
          const platformConfig = readPlatformConfig(platformDefinition);

          const result = await request("/api/config/test", {
            method: "POST",
            body: JSON.stringify({ platform, config: platformConfig })
          });

          if (result.success) {
            resultDiv.textContent = result.message || t("testSuccess");
            resultDiv.className = "message success";
          } else {
            resultDiv.textContent = t("testFailed", { error: result.error || "Unknown error" });
            resultDiv.className = "message error";
          }
        } catch (error) {
          resultDiv.textContent = t("testFailed", { error: error.message || String(error) });
          resultDiv.className = "message error";
        } finally {
          testBtn.textContent = originalText;
          testBtn.disabled = false;
        }
      }
      el("langButton").onclick = () => { currentLang = currentLang === "zh" ? "en" : "zh"; localStorage.setItem(STORAGE_KEY_LANG, currentLang); applyLanguage(); updateVisualState(); refreshStatus().catch((err) => console.warn("[config-web] Failed to refresh status after language change:", err)); };
      el("validateButton").onclick = validate; el("saveButton").onclick = save; el("startButton").onclick = startService; el("stopButton").onclick = stopService;
      platformKeys.forEach((platform) => {
        const testBtn = el("test-" + platform);
        if (testBtn) {
          testBtn.onclick = () => testPlatform(platform);
        }
      });
      el("refreshHealth").onclick = () => { updateDashboard(); };
      el("dashboardToPlatforms").onclick = () => { showConfig(); };
      el("dashboardToService").onclick = () => { scrollToSection("serviceSection", "navServiceBtn"); };
      el("navOverviewBtn").onclick = () => showDashboard();
      el("navPlatformsBtn").onclick = () => showConfig();
      el("navAiBtn").onclick = () => scrollToSection("aiSection", "navAiBtn");
      el("navServiceBtn").onclick = () => scrollToSection("serviceSection", "navServiceBtn");
      boot();
`;
