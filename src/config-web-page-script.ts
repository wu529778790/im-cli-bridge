export const PAGE_SCRIPT = String.raw`      const platformDefinitions = [
        { key: "telegram", label: "Telegram", fields: ["aiCommand", "botToken", "proxy", "allowedUserIds"], testFields: ["botToken", "proxy"], requiredFields: ["botToken"] },
        { key: "feishu", label: "Feishu", fields: ["aiCommand", "appId", "appSecret", "allowedUserIds"], testFields: ["appId", "appSecret"], requiredFields: ["appId", "appSecret"] },
        { key: "qq", label: "QQ", fields: ["aiCommand", "appId", "secret", "allowedUserIds"], testFields: ["appId", "secret"], requiredFields: ["appId", "secret"] },
        { key: "wework", label: "WeWork", fields: ["aiCommand", "corpId", "secret", "allowedUserIds"], testFields: ["corpId", "secret"], requiredFields: ["corpId", "secret"] },
        { key: "dingtalk", label: "DingTalk", fields: ["aiCommand", "clientId", "clientSecret", "cardTemplateId", "allowedUserIds"], testFields: ["clientId", "clientSecret"], requiredFields: ["clientId", "clientSecret"] },
      ];
      const platformKeys = platformDefinitions.map((platform) => platform.key);
      const aiTools = ["claude", "codex", "cursor", "codebuddy"];
      const ids = platformDefinitions.flatMap((platform) => ["enabled", ...platform.fields].map((field) => platform.key + "-" + field)).concat(["ai-aiCommand","ai-claudeCliPath","ai-claudeWorkDir","ai-claudeSkipPermissions","ai-claudeTimeoutMs","ai-codexTimeoutMs","ai-codebuddyTimeoutMs","ai-claudeModel","ai-cursorCliPath","ai-codexCliPath","ai-codebuddyCliPath","ai-codexProxy","ai-hookPort","ai-logLevel","ai-useSdkMode"]);
      const el = (id) => document.getElementById(id);
      const storageKey = "open-im-web-lang";
      const texts = __PAGE_TEXTS__;
      let currentMeta = null;
      let currentLang = (localStorage.getItem(storageKey) || "").startsWith("zh") ? "zh" : ((navigator.language || "").startsWith("zh") ? "zh" : "en");
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
      function applyLanguage(meta) {
        if (meta) currentMeta = meta;
        const isZh = currentLang === "zh";
        document.documentElement.lang = isZh ? "zh-CN" : "en";
        document.title = t("pageTitle");
        el("heroBadge").textContent = "open-im";
        el("heroTitle").textContent = "open-im";
        el("heroBody").textContent = t("heroBodyFull");
        el("heroBody").style.display = "block";
        el("heroKicker").textContent = t("heroKicker");
        el("heroRepo").textContent = "GitHub";
        el("langButton").textContent = t("langButton");
        document.querySelector(".nav-group-label").textContent = t("controlCenter");
        el("sidebarNoteTitle").textContent = t("sidebarNoteTitle");
        el("sidebarNoteBody").textContent = t("sidebarNoteBody");
        el("platformsTitle").textContent = t("platformsTitle");
        el("platformsHint").textContent = t("platformsHint");
        el("aiTitle").textContent = t("aiTitle");
        el("aiHint").textContent = t("aiHint");
        el("aiHint").style.display = t("aiHint") ? "block" : "none";
        el("claudeNote").textContent = t("claudeNote");
        setText("aiCommonTitle", t("aiCommonTitle"));
        setText("aiCommonHint", t("aiCommonHint"));
        setText("aiToolConfigTitle", t("aiToolConfigTitle"));
        setText("aiToolConfigHint", t("aiToolConfigHint"));
        setText("ai-claudeSectionLabel", "Claude");
        setText("ai-codexSectionLabel", "Codex");
        setText("ai-cursorSectionLabel", "Cursor");
        setText("ai-codebuddySectionLabel", "CodeBuddy");
        setText("telegram-enabled-label", t("enabled"));
        setText("feishu-enabled-label", t("enabled"));
        setText("qq-enabled-label", t("enabled"));
        setText("wework-enabled-label", t("enabled"));
        setText("dingtalk-enabled-label", t("enabled"));
        setText("telegram-summary", t("telegramSummary"));
        setText("feishu-summary", t("feishuSummary"));
        setText("qq-summary", t("qqSummary"));
        setText("wework-summary", t("weworkSummary"));
        setText("dingtalk-summary", t("dingtalkSummary"));
        setText("platformCredentialsTitle", t("platformCredentialsTitle"));
        setText("platformAccessTitle", t("platformAccessTitle"));
        setText("platformTestNote", t("platformTestNote"));
        setText("telegram-aiCommand-label", t("platformAiTool"));
        setText("feishu-aiCommand-label", t("platformAiTool"));
        setText("qq-aiCommand-label", t("platformAiTool"));
        setText("wework-aiCommand-label", t("platformAiTool"));
        setText("dingtalk-aiCommand-label", t("platformAiTool"));
        setText("telegram-botToken-label", t("botToken"));
        setText("telegram-proxy-label", t("proxy"));
        setText("telegram-allowedUserIds-label", t("allowedUserIds"));
        el("telegram-help").innerHTML = t("telegramHelp");
        setText("feishu-appId-label", t("appId"));
        setText("feishu-appSecret-label", t("appSecret"));
        setText("feishu-allowedUserIds-label", t("allowedUserIds"));
        el("feishu-help").innerHTML = t("feishuHelp");
        setText("qq-appId-label", t("qqAppId"));
        setText("qq-secret-label", t("qqAppSecret"));
        setText("qq-allowedUserIds-label", t("allowedUserIds"));
        el("qq-help").innerHTML = t("qqHelp");
        setText("wework-corpId-label", t("corpId"));
        setText("wework-secret-label", t("secret"));
        setText("wework-allowedUserIds-label", t("allowedUserIds"));
        el("wework-help").innerHTML = t("weworkHelp");
        setText("dingtalk-clientId-label", t("clientId"));
        setText("dingtalk-clientSecret-label", t("clientSecret"));
        setText("dingtalk-cardTemplateId-label", t("cardTemplateId"));
        setText("dingtalk-allowedUserIds-label", t("allowedUserIds"));
        el("dingtalk-help").innerHTML = t("dingtalkHelp");
        el("telegram-allowedUserIds").placeholder = t("commaSeparatedIds");
        el("feishu-allowedUserIds").placeholder = t("commaSeparatedIds");
        el("qq-allowedUserIds").placeholder = t("commaSeparatedIds");
        el("wework-allowedUserIds").placeholder = t("commaSeparatedIds");
        el("dingtalk-allowedUserIds").placeholder = t("commaSeparatedIds");
        el("dingtalk-cardTemplateId").placeholder = t("optional");
        ["telegram","feishu","qq","wework","dingtalk"].forEach((platform) => {
          const select = el(platform + "-aiCommand");
          if (select?.options?.length) {
            select.options[0].text = t("inheritDefaultAi");
          }
        });
        setText("ai-aiCommand-label", t("aiTool"));
        setText("ai-claudeWorkDir-label", t("workDir"));
        setText("ai-claudeCliPath-label", t("claudeCli"));
        setText("ai-cursorCliPath-label", t("cursorCli"));
        setText("ai-codexCliPath-label", t("codexCli"));
        setText("ai-codebuddyCliPath-label", t("codebuddyCli"));
        setText("ai-codexProxy-label", t("codexProxy"));
        setText("ai-claudeTimeoutMs-label", t("claudeTimeout"));
        setText("ai-codexTimeoutMs-label", t("codexTimeout"));
        setText("ai-codebuddyTimeoutMs-label", t("codebuddyTimeout"));
        setText("ai-claudeModel-label", t("claudeModel"));
        setText("ai-hookPort-label", t("hookPort"));
        setText("ai-logLevel-label", t("logLevel"));
        const logLevelOptions = el("ai-logLevel").options;
        logLevelOptions[0].text = t("logLevelDefault");
        logLevelOptions[1].text = "DEBUG";
        logLevelOptions[2].text = "INFO";
        logLevelOptions[3].text = "WARN";
        logLevelOptions[4].text = "ERROR";
        if (!el("ai-logLevel").value) {
          el("ai-logLevel").value = "default";
        }
        el("ai-codexProxy").placeholder = t("optional");
        el("ai-claudeModel").placeholder = t("optional");
        setText("ai-claudeSkipPermissions-label", t("autoApprove"));
        setText("ai-useSdkMode-label", t("sdkMode"));
        document.querySelectorAll("[data-tool]").forEach((button) => {
          button.textContent = button.getAttribute("data-tool");
        });
        el("validateButton").textContent = t("validate");
        el("saveButton").textContent = t("save");
        el("startButton").textContent = t("start");
        el("stopButton").textContent = t("stop");
        ["telegram","feishu","qq","wework","dingtalk"].forEach((platform) => {
          const testBtn = el("test-" + platform);
          if (testBtn) {
            testBtn.textContent = t("test");
          }
        });
        if (currentMeta) {
          el("modeBadge").textContent = t("mode") + ": " + currentMeta.mode;
        }
        el("dashboardTitle").textContent = t("dashboardTitle");
        el("dashboardSubtitle").textContent = t("dashboardSubtitleFull");
        el("quickActionsTitle").textContent = t("quickActionsTitle");
        el("serviceTitle").textContent = t("serviceTitle");
        el("serviceHint").textContent = t("serviceHint");
        el("overviewTitle").textContent = t("overviewTitle");
        el("overviewBody").textContent = t("overviewBody");
        el("dashboardToPlatforms").textContent = t("openPlatforms");
        el("dashboardToService").textContent = t("openService");
        el("refreshHealth").textContent = t("refreshHealth");
        el("statConfiguredLabel").textContent = t("statConfiguredLabel");
        el("statConfiguredMeta").textContent = t("statConfiguredMeta");
        el("statEnabledLabel").textContent = t("statEnabledLabel");
        el("statEnabledMeta").textContent = t("statEnabledMeta");
        el("statServiceLabel").textContent = t("statServiceLabel");
        el("navOverviewBtn").textContent = t("dashboardTitle");
        el("navPlatformsBtn").textContent = t("platformsTitle");
        el("navAiBtn").textContent = t("aiTitle");
        el("navServiceBtn").textContent = t("serviceTitle");
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

            statusDiv.textContent = statusText;
            if (statusClass === "success") {
              statusDiv.style.backgroundColor = "var(--green)";
            } else if (statusClass === "error") {
              statusDiv.style.backgroundColor = "var(--red)";
            } else if (statusClass === "off") {
              statusDiv.style.backgroundColor = "var(--muted)";
            } else {
              statusDiv.style.backgroundColor = "var(--orange)";
            }
            messageDiv.textContent = messageText;
          });

          // 鏇存柊鏈嶅姟鐘舵€?
          el("statConfiguredValue").textContent = configuredCount + "/" + platformKeys.length;
          el("statEnabledValue").textContent = String(enabledCount);
          el("statServiceValue").textContent = serviceStatus.running
            ? t("serviceRunningShort")
            : t("serviceIdleShort");
          el("statServiceMeta").textContent = serviceStatus.running
            ? t("serviceRunningMeta")
            : t("serviceIdleMeta");
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
      function fill(data, meta) {
        el("configPath").textContent = meta.configPath;
        applyLanguage(meta);
        platformDefinitions.forEach((platform) => fillPlatform(platform, data.platforms[platform.key]));
        setValue("ai-aiCommand", data.ai.aiCommand);
        setValue("ai-claudeCliPath", data.ai.claudeCliPath);
        setValue("ai-claudeWorkDir", data.ai.claudeWorkDir);
        setChecked("ai-claudeSkipPermissions", data.ai.claudeSkipPermissions);
        setValue("ai-claudeTimeoutMs", String(data.ai.claudeTimeoutMs));
        setValue("ai-codexTimeoutMs", String(data.ai.codexTimeoutMs));
        setValue("ai-codebuddyTimeoutMs", String(data.ai.codebuddyTimeoutMs));
        setValue("ai-claudeModel", data.ai.claudeModel);
        setValue("ai-cursorCliPath", data.ai.cursorCliPath);
        setValue("ai-codexCliPath", data.ai.codexCliPath);
        setValue("ai-codebuddyCliPath", data.ai.codebuddyCliPath);
        setValue("ai-codexProxy", data.ai.codexProxy);
        setValue("ai-hookPort", String(data.ai.hookPort));
        setValue("ai-logLevel", data.ai.logLevel || "default");
        setChecked("ai-useSdkMode", data.ai.useSdkMode);
        updateVisualState();
      }
      async function refreshStatus() { const data = await request("/api/service/status"); el("serviceState").textContent = data.running ? t("bridgeRunning", { pid: data.pid }) : t("bridgeStopped"); el("statusMeta").textContent = data.running ? t("bridgeActive") : t("bridgeInactive"); }
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
          refreshStatus().catch((err) => console.warn("[config-web] Failed to refresh status:", err));
          updateDashboard().catch((err) => console.warn("[config-web] Failed to update dashboard:", err));
        }, 10000);
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
      el("langButton").onclick = () => { currentLang = currentLang === "zh" ? "en" : "zh"; localStorage.setItem(storageKey, currentLang); applyLanguage(); updateVisualState(); refreshStatus().catch((err) => console.warn("[config-web] Failed to refresh status after language change:", err)); };
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
