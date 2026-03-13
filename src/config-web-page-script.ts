export const PAGE_SCRIPT = String.raw`      const ids = ["telegram-enabled","telegram-botToken","telegram-proxy","telegram-allowedUserIds","feishu-enabled","feishu-appId","feishu-appSecret","feishu-allowedUserIds","qq-enabled","qq-appId","qq-secret","qq-allowedUserIds","wework-enabled","wework-corpId","wework-secret","wework-allowedUserIds","dingtalk-enabled","dingtalk-clientId","dingtalk-clientSecret","dingtalk-cardTemplateId","dingtalk-allowedUserIds","ai-aiCommand","ai-claudeCliPath","ai-claudeWorkDir","ai-claudeSkipPermissions","ai-claudeTimeoutMs","ai-claudeModel","ai-cursorCliPath","ai-codexCliPath","ai-codexProxy","ai-hookPort","ai-logLevel","ai-useSdkMode"];
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
      const setMessage = (text, type="") => { const node = el("message"); node.textContent = text; node.className = ("message " + type).trim(); };
      const setBusy = (busy) => ["validateButton","saveButton","startButton","stopButton","langButton"].forEach((id) => { el(id).disabled = busy; });
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
        setText("telegram-enabled-label", t("enabled"));
        setText("feishu-enabled-label", t("enabled"));
        setText("qq-enabled-label", t("enabled"));
        setText("wework-enabled-label", t("enabled"));
        setText("dingtalk-enabled-label", t("enabled"));
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
        setText("ai-aiCommand-label", t("aiTool"));
        setText("ai-claudeWorkDir-label", t("workDir"));
        setText("ai-claudeCliPath-label", t("claudeCli"));
        setText("ai-cursorCliPath-label", t("cursorCli"));
        setText("ai-codexCliPath-label", t("codexCli"));
        setText("ai-codexProxy-label", t("codexProxy"));
        setText("ai-claudeTimeoutMs-label", t("claudeTimeout"));
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
      function updateVisualState() {
        const enabled = [];
        [["telegram","Telegram"],["feishu","Feishu"],["qq","QQ"],["wework","WeWork"],["dingtalk","DingTalk"]].forEach(([key,label]) => {
          const active = el(key + "-enabled").checked;
          el(key + "-panel").classList.toggle("off", !active);
          if (active) enabled.push(label);
        });
        const aiTool = el("ai-aiCommand").value;
        el("liveSummary").textContent = enabled.length
          ? t("summaryEnabled", { platforms: enabled.join(t("listSeparator")), tool: aiTool })
          : t("summaryEmpty", { tool: aiTool });
      }
      async function updateDashboard() {
        try {
          const data = await request("/api/health");
          const platforms = data.platforms || {};
          const serviceStatus = data.serviceStatus || {};
          const platformKeys = ["telegram","feishu","qq","wework","dingtalk"];
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

          // 更新服务状态
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
      const payload = () => ({ platforms: { telegram: { enabled: el("telegram-enabled").checked, botToken: el("telegram-botToken").value, proxy: el("telegram-proxy").value, allowedUserIds: el("telegram-allowedUserIds").value }, feishu: { enabled: el("feishu-enabled").checked, appId: el("feishu-appId").value, appSecret: el("feishu-appSecret").value, allowedUserIds: el("feishu-allowedUserIds").value }, qq: { enabled: el("qq-enabled").checked, appId: el("qq-appId").value, secret: el("qq-secret").value, allowedUserIds: el("qq-allowedUserIds").value }, wework: { enabled: el("wework-enabled").checked, corpId: el("wework-corpId").value, secret: el("wework-secret").value, allowedUserIds: el("wework-allowedUserIds").value }, dingtalk: { enabled: el("dingtalk-enabled").checked, clientId: el("dingtalk-clientId").value, clientSecret: el("dingtalk-clientSecret").value, cardTemplateId: el("dingtalk-cardTemplateId").value, allowedUserIds: el("dingtalk-allowedUserIds").value } }, ai: { aiCommand: el("ai-aiCommand").value, claudeCliPath: el("ai-claudeCliPath").value, claudeWorkDir: el("ai-claudeWorkDir").value, claudeSkipPermissions: el("ai-claudeSkipPermissions").checked, claudeTimeoutMs: Number(el("ai-claudeTimeoutMs").value || "0"), claudeModel: el("ai-claudeModel").value, cursorCliPath: el("ai-cursorCliPath").value, codexCliPath: el("ai-codexCliPath").value, codexProxy: el("ai-codexProxy").value, hookPort: Number(el("ai-hookPort").value || "0"), logLevel: el("ai-logLevel").value, useSdkMode: el("ai-useSdkMode").checked } });
      async function request(path, options={}) { const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Request failed"); return body; }
      function fill(data, meta) { el("configPath").textContent = meta.configPath; applyLanguage(meta); el("telegram-enabled").checked = data.platforms.telegram.enabled; el("telegram-botToken").value = data.platforms.telegram.botToken; el("telegram-proxy").value = data.platforms.telegram.proxy; el("telegram-allowedUserIds").value = data.platforms.telegram.allowedUserIds; el("feishu-enabled").checked = data.platforms.feishu.enabled; el("feishu-appId").value = data.platforms.feishu.appId; el("feishu-appSecret").value = data.platforms.feishu.appSecret; el("feishu-allowedUserIds").value = data.platforms.feishu.allowedUserIds; el("qq-enabled").checked = data.platforms.qq.enabled; el("qq-appId").value = data.platforms.qq.appId; el("qq-secret").value = data.platforms.qq.secret; el("qq-allowedUserIds").value = data.platforms.qq.allowedUserIds; el("wework-enabled").checked = data.platforms.wework.enabled; el("wework-corpId").value = data.platforms.wework.corpId; el("wework-secret").value = data.platforms.wework.secret; el("wework-allowedUserIds").value = data.platforms.wework.allowedUserIds; el("dingtalk-enabled").checked = data.platforms.dingtalk.enabled; el("dingtalk-clientId").value = data.platforms.dingtalk.clientId; el("dingtalk-clientSecret").value = data.platforms.dingtalk.clientSecret; el("dingtalk-cardTemplateId").value = data.platforms.dingtalk.cardTemplateId; el("dingtalk-allowedUserIds").value = data.platforms.dingtalk.allowedUserIds; el("ai-aiCommand").value = data.ai.aiCommand; el("ai-claudeCliPath").value = data.ai.claudeCliPath; el("ai-claudeWorkDir").value = data.ai.claudeWorkDir; el("ai-claudeSkipPermissions").checked = data.ai.claudeSkipPermissions; el("ai-claudeTimeoutMs").value = String(data.ai.claudeTimeoutMs); el("ai-claudeModel").value = data.ai.claudeModel; el("ai-cursorCliPath").value = data.ai.cursorCliPath; el("ai-codexCliPath").value = data.ai.codexCliPath; el("ai-codexProxy").value = data.ai.codexProxy; el("ai-hookPort").value = String(data.ai.hookPort); el("ai-logLevel").value = data.ai.logLevel || "default"; el("ai-useSdkMode").checked = data.ai.useSdkMode; updateVisualState(); }
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
          let platformConfig = {};

          switch (platform) {
            case "telegram":
              platformConfig = {
                botToken: el("telegram-botToken").value,
                proxy: el("telegram-proxy").value
              };
              break;
            case "feishu":
              platformConfig = {
                appId: el("feishu-appId").value,
                appSecret: el("feishu-appSecret").value
              };
              break;
            case "qq":
              platformConfig = {
                appId: el("qq-appId").value,
                secret: el("qq-secret").value
              };
              break;
            case "wework":
              platformConfig = {
                corpId: el("wework-corpId").value,
                secret: el("wework-secret").value
              };
              break;
            case "dingtalk":
              platformConfig = {
                clientId: el("dingtalk-clientId").value,
                clientSecret: el("dingtalk-clientSecret").value
              };
              break;
          }

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
      ["telegram","feishu","qq","wework","dingtalk"].forEach((platform) => {
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
