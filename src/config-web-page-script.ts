export const PAGE_SCRIPT = String.raw`      const platformDefinitions = [
        { key: "telegram", label: "Telegram", fields: ["aiCommand", "botToken", "proxy", "allowedUserIds"], testFields: ["botToken", "proxy"], requiredFields: ["botToken"] },
        { key: "feishu", label: "Feishu", fields: ["aiCommand", "appId", "appSecret", "allowedUserIds"], testFields: ["appId", "appSecret"], requiredFields: ["appId", "appSecret"] },
        { key: "qq", label: "QQ", fields: ["aiCommand", "appId", "secret", "allowedUserIds"], testFields: ["appId", "secret"], requiredFields: ["appId", "secret"] },
        { key: "wework", label: "WeWork", fields: ["aiCommand", "corpId", "secret", "allowedUserIds"], testFields: ["corpId", "secret"], requiredFields: ["corpId", "secret"] },
        { key: "dingtalk", label: "DingTalk", fields: ["aiCommand", "clientId", "clientSecret", "cardTemplateId", "allowedUserIds"], testFields: ["clientId", "clientSecret"], requiredFields: ["clientId", "clientSecret"] },
        { key: "workbuddy", label: "WorkBuddy", fields: ["aiCommand", "accessToken", "refreshToken", "userId", "baseUrl", "allowedUserIds"], testFields: ["accessToken", "refreshToken", "userId"], requiredFields: ["accessToken", "refreshToken", "userId"] },
      ];
      const platformKeys = platformDefinitions.map((platform) => platform.key);
      const aiTools = ["claude", "codex", "codebuddy"];
      const STORAGE_KEY_LANG = "open-im-web-lang";
      const STORAGE_KEY_DARK_MODE = "open-im-web-dark-mode";
      const POLLING_INTERVAL = 10000;
      const toolLabels = { claude: "Claude", codex: "Codex", codebuddy: "CodeBuddy" };

      // Dark mode handling
      const getSystemDarkMode = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
      const getSavedDarkMode = () => {
        const saved = localStorage.getItem(STORAGE_KEY_DARK_MODE);
        if (saved === "true") return true;
        if (saved === "false") return false;
        return null; // auto mode
      };
      const setDarkMode = (isDark) => {
        if (isDark) {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
        const sunIcon = el("darkModeToggle")?.querySelector(".sun-icon");
        const moonIcon = el("darkModeToggle")?.querySelector(".moon-icon");
        if (sunIcon && moonIcon) {
          sunIcon.style.display = isDark ? "none" : "block";
          moonIcon.style.display = isDark ? "block" : "none";
        }
      };
      const updateDarkMode = () => {
        const saved = getSavedDarkMode();
        const isDark = saved !== null ? saved : getSystemDarkMode();
        setDarkMode(isDark);
      };
      const toggleDarkMode = () => {
        const currentDark = document.documentElement.classList.contains("dark");
        const systemDark = getSystemDarkMode();
        // Toggle: auto -> off -> on -> auto
        let nextMode;
        const saved = getSavedDarkMode();
        if (saved === null) {
          nextMode = !systemDark; // auto -> force opposite of system
        } else if (saved === true) {
          nextMode = null; // on -> auto
        } else {
          nextMode = true; // off -> on
        }
        localStorage.setItem(STORAGE_KEY_DARK_MODE, nextMode === null ? "auto" : String(nextMode));
        updateDarkMode();
      };

      // Listen for system theme changes
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (getSavedDarkMode() === null) {
          updateDarkMode();
        }
      });

      const el = (id) => document.getElementById(id);
      const texts = __PAGE_TEXTS__;
      let currentMeta = null;
      let cachedServiceData = null;
      let lastHealthPayload = null;
      let currentLang = (localStorage.getItem(STORAGE_KEY_LANG) || "").startsWith("zh") ? "zh" : ((navigator.language || "").startsWith("zh") ? "zh" : "en");

      // Translation helper
      const t = (key, params={}) => {
        const source = texts[currentLang] || texts.en;
        const template = source[key] || texts.en[key] || key;
        return Object.keys(params).reduce((result, name) => result.replaceAll("{" + name + "}", String(params[name])), template);
      };

      // DOM helpers
      const setText = (id, value) => { const node = el(id); if (node) node.textContent = value; };
      const getValue = (id) => el(id)?.value ?? "";
      const getChecked = (id) => el(id)?.checked ?? false;
      const getNumber = (id) => Number(getValue(id) || "0");
      const setValue = (id, value) => { const node = el(id); if (node) node.value = value ?? ""; };
      const setChecked = (id, value) => { const node = el(id); if (node) node.checked = Boolean(value); };

      // Message display
      const setMessage = (text, type="") => {
        const node = el("message");
        if (!node) return;
        node.textContent = text;
        node.className = "message";
        if (type) node.classList.add("message-" + type);
        node.classList.remove("hidden");
      };

      const clearMessage = () => {
        const node = el("message");
        if (node) {
          node.textContent = "";
          node.classList.add("hidden");
        }
      };

      // Button state
      const setBusy = (busy) => {
        [
          "headerValidateButton",
          "headerSaveButton",
          "headerStartButton",
          "headerStopButton",
          "langButton",
        ].forEach((id) => {
          const node = el(id);
          if (node) node.disabled = busy;
        });
      };

      // Track current AI tool panel separately from default AI tool selection
      let currentAiToolPanel = "claude";
      const getActiveAiTool = () => currentAiToolPanel;

      // Platform config helpers
      const readPlatformConfig = (platform) => platform.testFields.reduce((config, field) => {
        config[field] = getValue(platform.key + "-" + field);
        return config;
      }, {});

      const countCompletedFields = (platform, fields) => fields.reduce((count, field) => count + (getValue(platform.key + "-" + field).trim() ? 1 : 0), 0);

      const fillPlatform = (platform, values) => {
        setChecked(platform.key + "-enabled", values.enabled);
        platform.fields.forEach((field) => setValue(platform.key + "-" + field, values[field]));
      };

      // Update platform card state (disabled/enabled visual)
      function updatePlatformCardState(platform) {
        const active = getChecked(platform.key + "-enabled");
        const requiredCount = platform.requiredFields.length;
        const completedCount = countCompletedFields(platform, platform.requiredFields);
        const panelNode = el(platform.key + "-panel");

        if (panelNode) {
          panelNode.classList.toggle("disabled", !active);
        }
      }

      // Language update mapping for new HTML structure
      const LANGUAGE_UPDATES = {
        simpleText: [
          { id: "mainTitle", key: "dashboardTitle" },
          { id: "navOverviewText", key: "dashboardTitle" },
          { id: "navPlatformsText", key: "platformsTitle" },
          { id: "navConfigFilesText", key: "navConfigFiles" },
          { id: "navAiText", key: "aiTitle" },
          { id: "footerGithubText", value: "GitHub" },
          { id: "platformsTitle", key: "platformsTitle" },
          { id: "platformsHint", key: "platformsHint" },
          { id: "aiTitle", key: "aiTitle" },
          { id: "aiHint", key: "aiHint" },
          { id: "overviewTitle", key: "overviewTitle" },
          { id: "overviewBody", key: "overviewBody" },
          { id: "statConfiguredLabel", key: "statConfiguredLabel" },
          { id: "statEnabledLabel", key: "statEnabledLabel" },
          { id: "statServiceLabel", key: "statServiceLabel" },
          { id: "configFilesTitle", key: "configFilesTitle" },
          { id: "configFilesHint", key: "configFilesHint" },
          { id: "openImConfigCardTitle", key: "configJson" },
          { id: "openImConfigCardHint", key: "openImConfigCardHint" },
          { id: "claudeSettingsCardTitle", key: "claudeSettingsLabel" },
          { id: "claudeSettingsCardHint", key: "claudeSettingsCardHint" },
          { id: "claudeJsonShortcutHint", key: "claudeJsonShortcutHint" },
          { id: "formatJsonButtonText", key: "formatJson" },
          { id: "resetJsonButtonText", key: "resetJson" },
          { id: "saveClaudeSettingsBtnText", key: "saveBtn" },
          { id: "saveOpenImConfigBtnText", key: "saveBtn" },
        ],
        platformLabels: {
          enabled: { suffix: "-label", key: "enabled" },
          description: { suffix: "-description", keys: { telegram: "telegramSummary", feishu: "feishuSummary", qq: "qqSummary", wework: "weworkSummary", dingtalk: "dingtalkSummary", workbuddy: "workbuddySummary" } },
          fieldLabel: {
            "telegram-botToken": { key: "botToken" },
            "telegram-proxy": { key: "proxy" },
            "telegram-aiCommand": { key: "platformAiTool" },
            "telegram-allowedUserIds": { key: "allowedUserIds" },
            "telegram-allowedUserIds-hint": { key: "leaveEmptyAllUsers" },
            "feishu-appId": { key: "appId" },
            "feishu-appSecret": { key: "appSecret" },
            "feishu-aiCommand": { key: "platformAiTool" },
            "feishu-allowedUserIds": { key: "allowedUserIds" },
            "qq-appId": { key: "qqAppId" },
            "qq-secret": { key: "qqAppSecret" },
            "qq-aiCommand": { key: "platformAiTool" },
            "qq-allowedUserIds": { key: "allowedUserIds" },
            "wework-corpId": { key: "corpId" },
            "wework-secret": { key: "secret" },
            "wework-aiCommand": { key: "platformAiTool" },
            "wework-allowedUserIds": { key: "allowedUserIds" },
            "dingtalk-clientId": { key: "clientId" },
            "dingtalk-clientSecret": { key: "clientSecret" },
            "dingtalk-cardTemplateId": { key: "cardTemplateId" },
            "dingtalk-aiCommand": { key: "platformAiTool" },
            "dingtalk-allowedUserIds": { key: "allowedUserIds" },
            "workbuddy-accessToken": { key: "workbuddyAccessToken" },
            "workbuddy-refreshToken": { key: "workbuddyRefreshToken" },
            "workbuddy-userId": { key: "workbuddyUserId" },
            "workbuddy-baseUrl": { key: "workbuddyBaseUrl" },
            "workbuddy-aiCommand": { key: "platformAiTool" },
            "workbuddy-allowedUserIds": { key: "allowedUserIds" },
          }
        },
        platformHelp: [
          { platform: "telegram", key: "telegramHelp" },
          { platform: "feishu", key: "feishuHelp" },
          { platform: "qq", key: "qqHelp" },
          { platform: "wework", key: "weworkHelp" },
          { platform: "dingtalk", key: "dingtalkHelp" },
          { platform: "workbuddy", key: "workbuddyHelp" },
        ],
        aiLabels: [
          { id: "aiCommonTitle", key: "aiCommonTitle" },
          { id: "ai-aiCommand-label", key: "aiTool" },
          { id: "ai-claudeWorkDir-label", key: "workDir" },
          { id: "ai-claudeConfigPath-label", key: "claudeConfigPath" },
          { id: "ai-claudeProxy-label", key: "claudeProxy" },
          { id: "ai-codexCliPath-label", key: "codexCli" },
          { id: "ai-codexProxy-label", key: "codexProxy" },
          { id: "ai-codebuddyCliPath-label", key: "codebuddyCli" },
          { id: "ai-hookPort-label", key: "hookPort" },
          { id: "ai-logLevel-label", key: "logLevel" },
        ],
        buttons: [
          { id: "headerValidateButton", key: "validate" },
          { id: "headerSaveButton", key: "save" },
          { id: "headerStartButton", key: "start" },
          { id: "headerStopButton", key: "stop" },
        ],
        testButtons: [
          { prefix: "test-", key: "test" },
        ]
      };

      function applyLanguage(meta) {
        if (meta) currentMeta = meta;
        const isZh = currentLang === "zh";
        document.documentElement.lang = isZh ? "zh-CN" : "en";
        document.title = t("pageTitle");

        // Simple text updates
        LANGUAGE_UPDATES.simpleText.forEach(({ id, value, key }) => {
          setText(id, value ?? t(key));
        });

        // Platform enabled labels
        platformKeys.forEach((platform) => {
          const label = el(platform + LANGUAGE_UPDATES.platformLabels.enabled.suffix);
          if (label) label.textContent = t(LANGUAGE_UPDATES.platformLabels.enabled.key);

          const desc = el(platform + LANGUAGE_UPDATES.platformLabels.description.suffix);
          const descKey = LANGUAGE_UPDATES.platformLabels.description.keys[platform];
          if (desc && descKey) desc.textContent = t(descKey);
        });

        // Platform field labels
        Object.entries(LANGUAGE_UPDATES.platformLabels.fieldLabel).forEach(([id, { key }]) => {
          const label = el(id + "-label");
          if (label) label.textContent = t(key);
        });

        // Platform hints
        Object.entries(LANGUAGE_UPDATES.platformLabels.fieldLabel).forEach(([id, { key }]) => {
          const hint = el(id + "-hint");
          if (hint && key === "allowedUserIds") hint.textContent = t("leaveEmptyAllUsers");
        });

        // Platform help blocks
        LANGUAGE_UPDATES.platformHelp.forEach(({ platform, key }) => {
          const helpBlock = el(platform + "-help");
          if (helpBlock) helpBlock.innerHTML = t(key);
        });

        // Short per-field tips (HTML)
        [
          ["telegram-botToken-tip", "tipTelegramToken"],
          ["feishu-appId-tip", "tipFeishuAppId"],
          ["feishu-appSecret-tip", "tipFeishuSecret"],
          ["qq-appId-tip", "tipQqAppId"],
          ["qq-secret-tip", "tipQqSecret"],
          ["wework-corpId-tip", "tipWeworkCorp"],
          ["dingtalk-clientId-tip", "tipDingtalkClient"],
          ["workbuddy-accessToken-tip", "tipWorkbuddyToken"],
        ].forEach(([tipId, tipKey]) => {
          const tipEl = el(tipId);
          if (tipEl) tipEl.innerHTML = t(tipKey);
        });

        // AI labels
        LANGUAGE_UPDATES.aiLabels.forEach(({ id, key }) => {
          const label = el(id + "-label");
          if (label) label.textContent = t(key);
        });

        // Buttons
        LANGUAGE_UPDATES.buttons.forEach(({ id, key }) => {
          const btn = el(id);
          if (btn) btn.textContent = t(key);
        });

        // Test buttons
        LANGUAGE_UPDATES.testButtons.forEach(({ prefix, key }) => {
          platformKeys.forEach((platform) => {
            const btn = el(prefix + platform);
            if (btn) btn.textContent = t(key);
          });
        });

        // Language button
        el("langButton").textContent = isZh ? "EN" : "中文";

        // Dark mode toggle aria-label
        const darkModeToggle = el("darkModeToggle");
        if (darkModeToggle) darkModeToggle.setAttribute("aria-label", t("darkModeToggle"));

        const headerToolbar = el("headerToolbar");
        if (headerToolbar) headerToolbar.setAttribute("aria-label", t("headerToolbarAria"));
      }

      // AI tool switcher
      function updateAiToolVisibility() {
        const activeTool = getActiveAiTool();
        aiTools.forEach((tool) => {
          const panel = el("ai-tool-" + tool);
          const tab = document.querySelector('.tab[data-tool="' + tool + '"]');
          if (panel) {
            panel.classList.toggle("active", tool === activeTool);
          }
          if (tab) {
            tab.classList.toggle("active", tool === activeTool);
          }
        });
      }

      function updateVisualState() {
        const enabled = [];
        platformDefinitions.forEach((platform) => {
          const active = getChecked(platform.key + "-enabled");
          updatePlatformCardState(platform);
          if (active) enabled.push(platform.label);
        });
        const aiTool = el("ai-aiCommand")?.value;
        const summary = enabled.length
          ? t("summaryEnabled", { platforms: enabled.join(t("listSeparator")), tool: aiTool })
          : t("summaryEmpty", { tool: aiTool });
        const liveSummary = el("liveSummary");
        if (liveSummary) liveSummary.textContent = summary;
        updateAiToolVisibility();
      }

      function collectClientValidationErrors() {
        const errors = [];
        const anyEnabled = platformDefinitions.some((p) => getChecked(p.key + "-enabled"));
        if (!anyEnabled) {
          errors.push(t("validationNoPlatformEnabled"));
        }
        platformDefinitions.forEach((platform) => {
          if (!getChecked(platform.key + "-enabled")) return;
          const missing = platform.requiredFields.filter((field) => !getValue(platform.key + "-" + field).trim());
          if (missing.length > 0) {
            errors.push(t("validationPlatformIncomplete", { platform: platform.label, fields: missing.join(", ") }));
          }
        });
        const cmd = getValue("ai-aiCommand");
        if (cmd === "codex" && !getValue("ai-codexCliPath").trim()) {
          errors.push(t("validationAiCodexNoCli"));
        }
        if (cmd === "codebuddy" && !getValue("ai-codebuddyCliPath").trim()) {
          errors.push(t("validationAiCodebuddyNoCli"));
        }
        return errors;
      }

      function validateClientSideOrAbort() {
        const errors = collectClientValidationErrors();
        if (errors.length > 0) {
          setMessage(errors.join(" "), "error");
          return false;
        }
        return true;
      }

      // Update dashboard with health status
      async function updateDashboard() {
        try {
          const data = await request("/api/health");
          const platforms = data.platforms || {};
          const serviceStatus = data.serviceStatus || {};
          let configuredCount = 0;
          let enabledCount = 0;

          platformKeys.forEach((platform) => {
            const platformData = platforms[platform] || {};
            if (platformData.configured) configuredCount += 1;
            if (platformData.enabled) enabledCount += 1;

            // Only update health cards if they exist
            const statusBadge = el("health-" + platform + "-status");
            const messageDiv = el("health-" + platform + "-message");
            const cardDiv = el("health-" + platform);

            if (!statusBadge || !messageDiv || !cardDiv) return;

            let badgeClass = "badge-default";
            let statusText = "";
            let messageText = platformData.message || "";

            if (!platformData.configured) {
              statusText = t("notConfigured");
              badgeClass = "badge-default";
              cardDiv.classList.add("disabled");
            } else if (!platformData.enabled) {
              statusText = t("disabled");
              badgeClass = "badge-default";
              cardDiv.classList.add("disabled");
            } else if (platformData.healthy) {
              statusText = t("healthy");
              badgeClass = "badge-success";
              cardDiv.classList.remove("disabled");
            } else {
              statusText = t("unhealthy");
              badgeClass = "badge-error";
              cardDiv.classList.remove("disabled");
            }

            statusBadge.textContent = statusText;
            statusBadge.className = "badge " + badgeClass;
            messageDiv.textContent = messageText;
          });

          // Update stats
          el("statConfiguredValue").textContent = configuredCount + "/" + platformKeys.length;
          el("statEnabledValue").textContent = String(enabledCount);
          el("statServiceValue").textContent = serviceStatus.running ? t("serviceRunningShort") : t("serviceIdleShort");

          lastHealthPayload = data;

          return data;
        } catch (error) {
          console.error("Failed to update dashboard:", error);
        }
      }

      // Navigation
      function setActiveNav(targetId) {
        ["navOverviewBtn","navPlatformsBtn","navConfigFilesBtn","navAiBtn"].forEach((id) => {
          const btn = el(id);
          if (btn) btn.classList.toggle("active", id === targetId);
        });
      }

      function scrollToSection(sectionId, navId) {
        el(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
        setActiveNav(navId);
      }

      // API request helper
      async function request(path, options={}) {
        const response = await fetch(path, {
          headers: { "content-type": "application/json" },
          ...options
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Request failed");
        return body;
      }

      async function loadClaudeSettings() {
        const textarea = document.getElementById("claudeSettingsEditor");
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        try {
          const data = await request("/api/claude/settings");
          const raw = (data.contents || "").trim();
          const target = raw || "{\n}\n";
          try {
            const parsed = JSON.parse(target);
            textarea.value = JSON.stringify(parsed, null, 2) + "\n";
          } catch {
            // 如果后端返回的不是合法 JSON，就原样展示，方便用户手动修
            textarea.value = target;
          }
        } catch (error) {
          setMessage(error.message || String(error), "error");
        }
      }

      async function saveClaudeSettings() {
        const textarea = document.getElementById("claudeSettingsEditor");
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        const edited = textarea.value;
        // Validate JSON before sending
        try {
          const parsed = JSON.parse(edited);
          textarea.value = JSON.stringify(parsed, null, 2) + "\n";
        } catch (err) {
          setMessage("Invalid JSON: " + (err && err.message ? err.message : String(err)), "error");
          return;
        }

        try {
          await request("/api/claude/settings", {
            method: "POST",
            body: JSON.stringify({ contents: edited }),
          });
          setMessage("Claude settings.json saved.", "success");
        } catch (error) {
          setMessage(error.message || String(error), "error");
        }
      }

      // Open-im Config Editor functions
      let originalConfigJson = "";

      async function loadOpenImConfig() {
        const textarea = document.getElementById("configJson");
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        try {
          const data = await request("/api/config/file");
          const raw = (data.contents || "").trim();
          originalConfigJson = raw;
          try {
            const parsed = JSON.parse(raw);
            textarea.value = JSON.stringify(parsed, null, 2) + "\n";
          } catch {
            textarea.value = raw;
          }
          validateJson();
        } catch (error) {
          showJsonValidationMessage(error.message || String(error), "error");
        }
      }

      function validateJson() {
        const textarea = document.getElementById("configJson");
        const message = document.getElementById("jsonValidationMessage");
        if (!(textarea instanceof HTMLTextAreaElement) || !message) return;

        const json = textarea.value;
        try {
          JSON.parse(json);
          showJsonValidationMessage("Valid JSON", "success");
        } catch (err) {
          showJsonValidationMessage("Invalid JSON: " + (err.message || String(err)), "error");
        }
      }

      function showJsonValidationMessage(text, type) {
        const message = document.getElementById("jsonValidationMessage");
        if (!message) return;
        message.textContent = text;
        message.className = "message";
        if (type) message.classList.add("message-" + type);
        message.classList.remove("hidden");
      }

      function formatJson() {
        const textarea = document.getElementById("configJson");
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        try {
          const parsed = JSON.parse(textarea.value);
          textarea.value = JSON.stringify(parsed, null, 2) + "\n";
          validateJson();
        } catch (err) {
          showJsonValidationMessage("Cannot format: Invalid JSON", "error");
        }
      }

      function resetJson() {
        const textarea = document.getElementById("configJson");
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        textarea.value = originalConfigJson;
        validateJson();
      }

      // Fill form with data
      const AI_FIELD_MAPPINGS = [
        { id: "ai-aiCommand", key: "aiCommand" },
        { id: "ai-claudeWorkDir", key: "claudeWorkDir" },
        { id: "ai-claudeConfigPath", key: "claudeConfigPath" },
        { id: "ai-claudeProxy", key: "claudeProxy" },
        { id: "ai-codexCliPath", key: "codexCliPath" },
        { id: "ai-codexProxy", key: "codexProxy" },
        { id: "ai-codebuddyCliPath", key: "codebuddyCliPath" },
        { id: "ai-hookPort", key: "hookPort" },
        { id: "ai-logLevel", key: "logLevel" },
      ];

      function fill(data, meta) {
        el("configPath").textContent = meta.configPath;
        applyLanguage(meta);
        platformDefinitions.forEach((platform) => fillPlatform(platform, data.platforms[platform.key]));

        AI_FIELD_MAPPINGS.forEach(({ id, key }) => {
          const value = data.ai[key];
          if (key === "logLevel") {
            setValue(id, value || "default");
          } else {
            setValue(id, value ?? "");
          }
        });

        // Load JSON editor content
        void loadOpenImConfig();

        updateVisualState();
      }

      // Refresh service status
      async function refreshStatus() {
        const data = await request("/api/service/status");
        const serviceStateText = data.running ? t("bridgeRunning", { pid: data.pid }) : t("bridgeStopped");
        const serviceState = el("serviceState");
        if (serviceState) {
          serviceState.textContent = serviceStateText;
          serviceState.className = "badge " + (data.running ? "badge-success" : "badge-default");
        }
        return data;
      }

      // Boot function
      async function boot() {
        setBusy(true);
        try {
          applyLanguage();
          const data = await request("/api/config");
          fill(data.payload, data.meta);
          await loadClaudeSettings();
          // Initialize current AI tool panel from dropdown value
          currentAiToolPanel = el("ai-aiCommand")?.value || "claude";
          await refreshStatus();
          setActiveNav("navOverviewBtn");
          await updateDashboard();
          clearMessage();
        } catch (error) {
          setMessage(error.message || String(error), "error");
        } finally {
          setBusy(false);
        }

        // Polling
        setInterval(() => {
          Promise.all([
            refreshStatus().catch((err) => console.warn("[config-web] Failed to refresh status:", err)),
            updateDashboard().catch((err) => console.warn("[config-web] Failed to update dashboard:", err)),
          ]);
        }, POLLING_INTERVAL);

        // Event listeners for inputs
        platformDefinitions.forEach((platform) => {
          ["enabled", ...platform.fields].forEach((field) => {
            const input = el(platform.key + "-" + field);
            if (input) {
              input.addEventListener("input", updateVisualState);
              input.addEventListener("change", updateVisualState);
            }
          });
        });

        AI_FIELD_MAPPINGS.forEach(({ id }) => {
          const input = el(id);
          if (input) {
            input.addEventListener("input", updateVisualState);
            input.addEventListener("change", updateVisualState);
          }
        });

        el("saveClaudeSettingsBtn").onclick = async () => {
          try {
            await saveClaudeSettings();
          } catch (e) {
            setMessage(e && e.message ? e.message : String(e), "error");
          }
        };
        el("saveOpenImConfigBtn").onclick = async () => {
          try {
            await saveOpenImConfig();
            setMessage(t("saveOk"), "success");
          } catch (e) {
            setMessage(e && e.message ? e.message : String(e), "error");
          }
        };

        // AI tool switcher
        document.querySelectorAll(".tab[data-tool]").forEach((tab) => {
          tab.addEventListener("click", () => {
            const tool = tab.getAttribute("data-tool");
            if (tool) {
              currentAiToolPanel = tool;
              updateVisualState();
            }
          });
        });

        // Config editor JSON textarea
        const configJsonTextarea = document.getElementById("configJson");
        if (configJsonTextarea) {
          configJsonTextarea.addEventListener("input", validateJson);
        }

        // Config editor buttons
        const formatJsonButton = document.getElementById("formatJsonButton");
        if (formatJsonButton) {
          formatJsonButton.addEventListener("click", formatJson);
        }

        const resetJsonButton = document.getElementById("resetJsonButton");
        if (resetJsonButton) {
          resetJsonButton.addEventListener("click", resetJson);
        }


        // Navigation
        el("navOverviewBtn").onclick = () => scrollToSection("dashboardSection", "navOverviewBtn");
        el("navPlatformsBtn").onclick = () => scrollToSection("configSection", "navPlatformsBtn");
        el("navConfigFilesBtn").onclick = () => scrollToSection("configFilesSection", "navConfigFilesBtn");
        el("navAiBtn").onclick = () => scrollToSection("aiSection", "navAiBtn");

        // Language toggle
        el("langButton").onclick = () => {
          currentLang = currentLang === "zh" ? "en" : "zh";
          localStorage.setItem(STORAGE_KEY_LANG, currentLang);
          applyLanguage();
          updateVisualState();
          refreshStatus().catch((err) => console.warn("[config-web] Failed to refresh status after language change:", err));
        };

        // Dark mode toggle
        el("darkModeToggle").onclick = toggleDarkMode;
        updateDarkMode(); // Initialize dark mode on load

        // Service buttons (page footer + sticky header toolbar)
        const onSaveClick = async () => {
          if (!validateClientSideOrAbort()) return;
          await saveClaudeSettings();
          await save();
        };
        const onStartClick = async () => {
          if (!validateClientSideOrAbort()) return;
          await saveClaudeSettings();
          await startService();
        };
        el("headerValidateButton").onclick = validate;
        el("headerSaveButton").onclick = onSaveClick;
        el("headerStartButton").onclick = onStartClick;
        el("headerStopButton").onclick = stopService;

        // Platform test buttons
        platformKeys.forEach((platform) => {
          const testBtn = el("test-" + platform);
          if (testBtn) {
            testBtn.onclick = () => testPlatform(platform);
          }
        });

      }

      // Actions
      async function validate() {
        setBusy(true);
        try {
          if (!validateClientSideOrAbort()) return;
          await request("/api/config/validate", { method: "POST", body: JSON.stringify(payload()) });
          setMessage(t("validationOk"), "success");
        } catch (error) {
          setMessage(error.message || String(error), "error");
        } finally {
          setBusy(false);
        }
      }

      async function save() {
        setBusy(true);
        try {
          if (!validateClientSideOrAbort()) return;
          // First save JSON editor content if changed
          await saveOpenImConfig();
          // Then save form data
          await request("/api/config/save?final=1", { method: "POST", body: JSON.stringify(payload()) });
          setMessage(t("saveOk"), "success");
        } catch (error) {
          setMessage(error.message || String(error), "error");
        } finally {
          setBusy(false);
        }
      }

      async function saveOpenImConfig() {
        const textarea = document.getElementById("configJson");
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        const json = textarea.value.trim();
        if (!json) return;

        // Validate JSON
        try {
          JSON.parse(json);
        } catch (err) {
          showJsonValidationMessage("Invalid JSON: " + (err.message || String(err)), "error");
          throw new Error("Invalid JSON: " + (err.message || String(err)));
        }

        try {
          await request("/api/config/file", {
            method: "POST",
            body: JSON.stringify({ contents: json }),
          });
          originalConfigJson = json;
        } catch (error) {
          showJsonValidationMessage(error.message || String(error), "error");
          throw error;
        }
      }

      async function startService() {
        setBusy(true);
        try {
          if (!validateClientSideOrAbort()) return;
          await request("/api/config/save", { method: "POST", body: JSON.stringify(payload()) });
          await request("/api/service/start", { method: "POST" });
          await refreshStatus();
          await updateDashboard();
          setMessage(t("startOk"), "success");
        } catch (error) {
          setMessage(error.message || String(error), "error");
        } finally {
          setBusy(false);
        }
      }

      async function stopService() {
        setBusy(true);
        try {
          await request("/api/service/stop", { method: "POST" });
          await refreshStatus();
          setMessage(t("stopOk"), "success");
        } catch (error) {
          setMessage(error.message || String(error), "error");
        } finally {
          setBusy(false);
        }
      }

      // Platform test
      async function testPlatform(platform) {
        const resultDiv = el("test-" + platform + "-result");
        const testBtn = el("test-" + platform);
        if (!resultDiv || !testBtn) return;

        const originalText = testBtn.textContent;
        testBtn.textContent = t("testing");
        testBtn.disabled = true;
        resultDiv.textContent = "";
        resultDiv.className = "";

        try {
          const platformDefinition = platformDefinitions.find((item) => item.key === platform);
          if (!platformDefinition) throw new Error("Unknown platform");
          const platformConfig = readPlatformConfig(platformDefinition);

          const result = await request("/api/config/test", {
            method: "POST",
            body: JSON.stringify({ platform, config: platformConfig })
          });

          if (result.success) {
            resultDiv.textContent = result.message || t("testSuccess");
            resultDiv.className = "message message-success mt-4";
          } else {
            resultDiv.textContent = t("testFailed", { error: result.error || "Unknown error" });
            resultDiv.className = "message message-error mt-4";
          }
        } catch (error) {
          resultDiv.textContent = t("testFailed", { error: error.message || String(error) });
          resultDiv.className = "message message-error mt-4";
        } finally {
          testBtn.textContent = originalText;
          testBtn.disabled = false;
        }
      }

      // Payload builder
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
          claudeWorkDir: getValue("ai-claudeWorkDir"),
          claudeConfigPath: getValue("ai-claudeConfigPath"),
          claudeProxy: getValue("ai-claudeProxy"),
          codexCliPath: getValue("ai-codexCliPath"),
          codexProxy: getValue("ai-codexProxy"),
          codebuddyCliPath: getValue("ai-codebuddyCliPath"),
          hookPort: getNumber("ai-hookPort"),
          logLevel: getValue("ai-logLevel"),
        },
      });

      boot();
`;
