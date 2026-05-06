// Tue Mar 24 2026 12:24:01 GMT+0000 (Coordinated Universal Time)
// Base: https://github.com/echo094/decode-js
// Modify: https://github.com/smallfawn/decode_action

// Gemini 前端代理增强脚本 —— 用于伪装浏览器指纹、劫持网络请求、
// 注入快捷菜单（换车/导出/删除/主题切换等）、以及对话时间线导航。

(function () {
  "use strict";

  // ==================== 全局状态 ====================
  let isGeminiAdvanceExport = false;
  const ctx = { fpChanged: false };
  var themeBaseUrl = "/",
    isEnabledChatBuySub = false,
    isBuyCrossGeminiChat = false;
  const layer = window.layer || createLayerFallback();

  ensureDateFormat();

  function createLayerFallback() {
    let nextId = 1;
    const active = new Map();

    function mount(el) {
      const root = document.body || document.documentElement;
      const id = nextId++;
      root.appendChild(el);
      active.set(id, el);
      return id;
    }

    function remove(id) {
      const el = active.get(id);
      if (!el) return;
      active.delete(id);
      el.remove();
    }

    function plainText(input) {
      const tmp = document.createElement("div");
      tmp.innerHTML = String(input || "");
      return (tmp.textContent || tmp.innerText || "").trim();
    }

    function createShade() {
      const shade = document.createElement("div");
      shade.style.cssText =
        "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;";
      return shade;
    }

    function msg(message, opts = {}) {
      const toast = document.createElement("div");
      toast.textContent = plainText(message);
      toast.style.cssText =
        "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:2147483647;max-width:min(80vw,560px);padding:10px 14px;border-radius:10px;background:rgba(17,24,39,0.92);color:#fff;font:14px/1.4 sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.28);";
      const id = mount(toast);
      const timeout = typeof opts.time === "number" ? opts.time : 2500;
      if (timeout > 0) {
        setTimeout(() => remove(id), timeout);
      }
      return id;
    }

    function load(_type, opts = {}) {
      const shade = createShade();
      const panel = document.createElement("div");
      panel.style.cssText =
        "min-width:180px;max-width:min(80vw,420px);padding:16px 20px;border-radius:12px;background:#111827;color:#fff;font:14px/1.4 sans-serif;box-shadow:0 12px 32px rgba(0,0,0,0.3);text-align:center;";
      panel.textContent = plainText(opts.text || opts.content || "Loading...");
      shade.appendChild(panel);
      return mount(shade);
    }

    function close(id) {
      remove(id);
    }

    function closeAll() {
      Array.from(active.keys()).forEach(remove);
    }

    function confirm(message, _opts, yes) {
      if (window.confirm(plainText(message)) && typeof yes === "function") {
        yes();
      }
    }

    function open(opts = {}) {
      let id = 0;
      const shade = createShade();
      const panel = document.createElement("div");
      panel.style.cssText =
        "position:relative;width:min(90vw,640px);max-height:85vh;overflow:auto;border-radius:16px;background:#fff;color:#111827;box-shadow:0 18px 50px rgba(0,0,0,0.35);";

      if (opts.title !== false) {
        const header = document.createElement("div");
        header.style.cssText =
          "padding:14px 18px;border-bottom:1px solid rgba(17,24,39,0.08);font:600 16px/1.4 sans-serif;";
        header.textContent = plainText(opts.title || "");
        panel.appendChild(header);
      }

      if (opts.closeBtn) {
        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.textContent = "x";
        closeBtn.style.cssText =
          "position:absolute;top:10px;right:12px;border:0;background:transparent;color:#6b7280;font:20px/1 sans-serif;cursor:pointer;";
        closeBtn.addEventListener("click", () => close(id));
        panel.appendChild(closeBtn);
      }

      const body = document.createElement("div");
      body.style.cssText = "padding:18px;";
      if (opts.type === 2) {
        const iframe = document.createElement("iframe");
        iframe.src = String(opts.content || "");
        iframe.style.cssText = "width:100%;height:min(75vh,720px);border:0;";
        body.appendChild(iframe);
      } else {
        body.innerHTML = String(opts.content || "");
      }
      panel.appendChild(body);
      shade.appendChild(panel);

      if (opts.shadeClose) {
        shade.addEventListener("click", (event) => {
          if (event.target === shade) {
            close(id);
          }
        });
      }

      id = mount(shade);
      return id;
    }

    return { msg, load, close, closeAll, confirm, open };
  }

  function ensureDateFormat() {
    if (typeof Date.prototype.Format === "function") return;
    Date.prototype.Format = function (fmt) {
      const year = String(this.getFullYear());
      const month = String(this.getMonth() + 1).padStart(2, "0");
      const day = String(this.getDate()).padStart(2, "0");
      const hour = String(this.getHours()).padStart(2, "0");
      const minute = String(this.getMinutes()).padStart(2, "0");
      const second = String(this.getSeconds()).padStart(2, "0");
      return String(fmt || "yyyy-MM-dd HH:mm:ss")
        .replace(/yyyy/g, year)
        .replace(/MM/g, month)
        .replace(/dd/g, day)
        .replace(/HH/g, hour)
        .replace(/mm/g, minute)
        .replace(/ss/g, second);
    };
  }

  function setLoading(message) {
    try {
      if (window.layer && typeof window.layer.load === "function") {
        return window.layer.load(2, { shade: [0.3, "#000"] });
      }
    } catch (err) {}
    return layer.load(2, { text: message });
  }

  function downloadTextAsFile(content, filename, mimeType) {
    const blob = new Blob([content], {
      type: mimeType || "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function showIframeDialog(title, src, width, height, type) {
    return layer.open({
      type: type || 2,
      title: title || false,
      content: src || "",
      area: [(width || 710) + "px", (height || 1125) + "px"],
      shadeClose: true,
      closeBtn: 1,
      maxmin: true,
    });
  }

  // ==================== 浏览器指纹伪装数据 ====================
  const windowsFingerprint = {
    appCodeName: "Mozilla",
    appName: "Netscape",
    vendor: "Google Inc.",
    product: "Gecko",
    productSub: "20030107",
    appVersion:
      "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    platform: "Win32",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    userAgentData: null,
    language: "en-US",
    languages: ["en-US"],
    deviceMemory: 8,
    hardwareConcurrency: 16,
  };

  const iphoneFingerprint = {
    appCodeName: "Mozilla",
    appName: "Netscape",
    vendor: "Google Inc.",
    product: "Gecko",
    productSub: "20030107",
    appVersion:
      "5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
    platform: "iPhone",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
    userAgentData: null,
    language: "en-US",
    languages: ["en-US"],
    deviceMemory: 8,
    hardwareConcurrency: 16,
  };

  // ==================== 禁用 Service Worker ====================
  function disableServiceWorker() {
    try {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (let reg of registrations) {
            reg.unregister();
          }
        });
        delete Navigator.prototype.serviceWorker;
      }
    } catch (err) {
      console.error("Failed to disable service worker:", err);
    }
  }

  // ==================== 指纹替换工具集 ====================
  function createFingerprintTools() {
    function replaceSimpleNavigator(fingerprintData) {
      ctx.fpChanged = true;
      for (let prop in fingerprintData) {
        let descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, prop);
        if (!descriptor?.get) continue;
        let value = fingerprintData[prop];
        if (value === null) {
          delete Navigator.prototype[prop];
          continue;
        }
        let getter = () => value;
        getter.toString = descriptor.get.toString.bind(descriptor.get);
        Object.defineProperty(Navigator.prototype, prop, {
          set: undefined,
          enumerable: true,
          configurable: true,
          get: getter,
        });
      }
    }

    function replaceTimezone(locale, timezone) {
      ctx.fpChanged = true;
      if (Intl?.DateTimeFormat?.prototype?.resolvedOptions) {
        let originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
        Intl.DateTimeFormat.prototype.resolvedOptions = function () {
          return {
            ...originalResolvedOptions.call(this),
            locale: locale,
            timeZone: timezone,
          };
        };
      }
      let dateProto = Date.prototype;
      let offsetMinutes = getTimezoneOffset(timezone);
      dateProto.getTimezoneOffset = () => offsetMinutes;
      dateProto.getTimezoneOffset.toString = () =>
        "function getTimezoneOffset() { [native code] }";
      dateProto.toString = function () {
        return getUSDateString(this);
      };
      dateProto.toString.toString = () => "function toString() { [native code] }";
    }

    function getTimezoneOffset(tz = "UTC", date = new Date()) {
      let utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
      let tzDate = new Date(date.toLocaleString("en-US", { timeZone: tz }));
      return (tzDate.getTime() - utcDate.getTime()) / -60000;
    }

    // PLACEHOLDER_CHUNK_2

    function getUSDateString(date) {
      if (Number.isNaN(date.valueOf())) return "Invalid Date";
      try {
        let formatted = new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          month: "short",
          year: "numeric",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "long",
          timeZone: "America/Los_Angeles",
          hour12: false,
        })
          .format(date)
          .replace(" at ", ", ");
        let [weekday, monthDay, year, timePart] = formatted.split(", ");
        let time = timePart.slice(0, 8);
        let tzName = timePart.slice(9);
        return [weekday, monthDay, year, time, "GMT-0700", "(" + tzName + ")"].join(" ");
      } catch (err) {
        throw new Error("getUSDateString failed: " + err.message, { cause: err });
      }
    }

    function replacePerformance(perfData) {
      ctx.fpChanged = true;
      if (window.performance) {
        overridePrototypeProps(window.performance, perfData);
      } else {
        window.performance = perfData;
      }
    }

    function replaceScreen(screenData) {
      ctx.fpChanged = true;
      overridePrototypeProps(window.screen, screenData);
    }

    function replaceNavigator(navData) {
      ctx.fpChanged = true;
      if (navData.userAgent) {
        let parts = navData.userAgent.split("/");
        navData.appVersion = parts.slice(1).join("/");
        navData.appCodeName = parts[0];
      }
      let customGetters = {
        userAgentData: () => ({
          ...navData.userAgentData,
          toJSON: () => navData.userAgentData,
          getHighEntropyValues: async () => navData.userAgentData,
        }),
      };
      overridePrototypeProps(window.navigator, navData, customGetters);
    }

    // PLACEHOLDER_CHUNK_3

    function overridePrototypeProps(target, props, customGetters = {}) {
      let proto = Object.getPrototypeOf(target);
      for (let [key, value] of Object.entries(props)) {
        let getter = customGetters[key] || (() => value);
        getter.toString = () => "function get " + key + "() { [native code] }";
        Object.defineProperty(proto, key, {
          get: getter,
          set: undefined,
          enumerable: true,
          configurable: true,
        });
      }
    }

    return {
      replacePerformance,
      replaceScreen,
      replaceNavigator,
      replaceTimezone,
      getUSDateString,
      replaceSimple: replaceSimpleNavigator.bind(null, windowsFingerprint),
      replaceSimpleIphone: replaceSimpleNavigator.bind(null, iphoneFingerprint),
    };
  }

  // ==================== 初始化环境伪装 ====================
  function initEnvironmentSpoof() {
    disableServiceWorker();
    createFingerprintTools();

    function spoofLocation() {
      const targetUrl = new URL("https://gemini.google.com/app");

      // 伪装 Performance entries 中的 URL
      if ("getEntriesByType" in Performance.prototype) {
        const originalGetEntries = Performance.prototype.getEntriesByType;
        Performance.prototype.getEntriesByType = function (type) {
          return originalGetEntries.apply(this, [type]).map((entry) => {
            return (
              Object.defineProperty(entry, "name", {
                value: targetUrl.href,
                configurable: true,
                enumerable: true,
              }),
              entry
            );
          });
        };
      }

      // PLACEHOLDER_CHUNK_4

      // 伪造 location 对象
      let fakeLocation = {
        ...window.location,
        host: targetUrl.host,
        origin: targetUrl.origin,
        href: targetUrl.href,
        get pathname() {
          return targetUrl.pathname;
        },
        get hostname() {
          return targetUrl.hostname;
        },
        toString: () => targetUrl.toString(),
        valueOf: () => fakeLocation,
      };

      // 代理 document，拦截 location 和 URL 属性
      let docMethodCache = new WeakMap();
      let fakeDocument = new Proxy(document, {
        get(target, prop) {
          let key = String(prop);
          if (key === "location") return fakeLocation;
          if (key === "URL") return targetUrl.href;
          let value = Reflect.get(target, prop);
          if (typeof value == "function") {
            if (!docMethodCache.has(value))
              docMethodCache.set(value, value.bind(target));
            return docMethodCache.get(value);
          }
          return value;
        },
        set(target, prop, val) {
          return Reflect.set(target, prop, val);
        },
      });

      // 代理 window，拦截 location 和 document
      let winMethodCache = new WeakMap();
      let fakeWindow = new Proxy(window, {
        get(target, prop) {
          let key = String(prop);
          if (key === "location") return fakeLocation;
          if (key === "document") return fakeDocument;
          let value = Reflect.get(target, prop);
          if (typeof value == "function") {
            if (!winMethodCache.has(value)) {
              winMethodCache.set(value, value.bind(target));
            }
            return winMethodCache.get(value);
          }
          return value;
        },
        set(target, prop, val) {
          return Reflect.set(target, prop, val);
        },
      });

      // PLACEHOLDER_CHUNK_5

      // 创建 iframe window 代理（拦截 self/window/parent/top）
      let iframeMethodCache = new WeakMap();
      function createFakeIframeWindow(iframeWin) {
        return new Proxy(iframeWin, {
          get(target, prop) {
            let key = String(prop);
            if (key === "self" || key === "window") return fakeWindow;
            if (key === "parent" || key === "top") return fakeWindow;
            let value = Reflect.get(target, prop);
            if (typeof value == "function") {
              if (!iframeMethodCache.has(value))
                iframeMethodCache.set(value, value.bind(target));
              return iframeMethodCache.get(value);
            }
            return Reflect.get(target, prop);
          },
          set(target, prop, val) {
            return Reflect.set(target, prop, val);
          },
        });
      }
      window._fiw = createFakeIframeWindow;
    }

    spoofLocation();

    // 定时修改"导出到 Google 文档"按钮文本
    setInterval(() => {
      for (let selector of [
        'button[data-test-id="export-to-docs-button"] span',
        '[aria-label="导出到 Google 文档"] span',
      ]) {
        let el = document.querySelector(selector);
        if (el) el.textContent = "导出";
      }
    }, 600);
  }

  // ==================== 判断是否中文环境 ====================
  function isChinese() {
    return navigator.language.includes("zh");
  }

  // ==================== 网络请求拦截 ====================
  function setupNetworkInterceptors() {
    const apiPatterns = ["BardFrontendService/StreamGenerate", "batchexecute"];

    const errorHandlers = {
      request_error: (msg) => {
        layer.msg(msg, { time: 3000, icon: 2 });
      },
      need_login: (msg) => {
        layer.msg(msg, { time: 3000, icon: 2 });
        setTimeout(() => {
          location.href = themeBaseUrl;
        }, 2000);
      },
      need_reload: () => {
        let message = "This conversation comes from other server, reloading the page";
        if (isChinese()) message = "此对话来自其他车队，即将刷新页面...";
        layer.msg(message, { icon: 0, time: 3000 });
        location.reload();
      },
      account_required: () => autoExportAndLeave("当前账号已失效，正在自动导出对话｜Account unavailable, exporting conversation"),
      account_disabled: () => autoExportAndLeave("当前账号已停用，正在自动导出对话｜Account disabled, exporting conversation"),
      account_has_no_cookies: () => autoExportAndLeave("当前账号缺少 Cookie，正在自动导出对话｜Account missing cookies, exporting conversation"),
      default: (msg) => {
        if (msg) layer.msg(msg, { time: 5000, icon: 2 });
      },
    };

    // 车死/停用 → 自动下载对话再回选车页
    let autoExportFired = false;
    async function autoExportAndLeave(message) {
      if (autoExportFired) return;
      autoExportFired = true;
      layer.msg(message, { icon: 0, time: 3500 });
      try {
        const convInfo = parseConversationPath();
        if (convInfo && convInfo.convId && typeof downloadConversation === "function") {
          await downloadConversation("md");
        }
      } catch (e) {
        console.error("auto export failed:", e);
      }
      setTimeout(() => { window.location.href = "/select"; }, 1800);
    }

    // 需要屏蔽的日志/错误上报路径
    const blockedPaths = ["/gemini/log", "/_/BardChatUi/jserror"];

    // 从 batchexecute 请求体里抽出 hNvQHb（打开对话）的 convID
    const OPEN_CONV_RPC_ID = "hNvQHb";
    function extractOpenConvID(rawBody) {
      try {
        const params = new URLSearchParams(rawBody);
        const fReq = params.get("f.req");
        if (!fReq) return null;
        const batches = JSON.parse(fReq);
        if (!Array.isArray(batches)) return null;
        for (const batch of batches) {
          if (!Array.isArray(batch)) continue;
          for (const call of batch) {
            if (!Array.isArray(call) || call[0] !== OPEN_CONV_RPC_ID) continue;
            const inner = typeof call[1] === "string" ? JSON.parse(call[1]) : call[1];
            if (Array.isArray(inner) && typeof inner[0] === "string" && inner[0].startsWith("c_")) {
              return inner[0];
            }
          }
        }
      } catch (e) {}
      return null;
    }

    // 防抖：同一个 convID 短时间内只查一次
    const ownerCheckCache = new Map();
    function checkConversationOwner(convID) {
      const now = Date.now();
      const last = ownerCheckCache.get(convID);
      if (last && now - last < 5000) return;
      ownerCheckCache.set(convID, now);
      fetch("/api/conversations/check-owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: convID }),
      })
        .then((res) => res.json().catch(() => ({})))
        .then((data) => {
          if (!data || data.match) return;
          if (data.switched) {
            errorHandlers.need_reload();
            return;
          }
          if (data.owner_alive === false) {
            errorHandlers.account_required();
          }
        })
        .catch(() => {});
    }

    // 拦截 XMLHttpRequest
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._url = url;
      return originalXhrOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      const pathname = (() => {
        try {
          return new URL(this._url, location.origin).pathname;
        } catch {
          return this._url;
        }
      })();

      // 屏蔽日志上报请求
      const isBlocked = blockedPaths.some((p) => pathname === p);
      if (isBlocked) return;

      // 进入对话（hNvQHb）→ 检查归属车辆，必要时切 session 或跳转
      if (this._url && this._url.includes("batchexecute") && typeof args[0] === "string") {
        const convID = extractOpenConvID(args[0]);
        if (convID) checkConversationOwner(convID);
      }

      // 监听 API 响应中的错误
      const isApiCall = apiPatterns.some((p) => this._url?.includes(p));
      if (isApiCall) {
        const onStateChange = () => {
          if (this.readyState === 4 && this.status >= 200) {
            // PLACEHOLDER_CHUNK_7
            const responseText = this.responseText;
            if (responseText && responseText.trim().startsWith('{"error"'))
              try {
                const parsed = JSON.parse(responseText);
                const error = parsed.error;
                const message = parsed.message;
                if (error && errorHandlers[error])
                  errorHandlers[error](message);
                else errorHandlers.default(message || error);
              } catch (e) {
                console.error("Error parsing XHR response:", e);
              }
          }
        };
        this.addEventListener("readystatechange", onStateChange);
        this.addEventListener("load", onStateChange);
      }
      return originalXhrSend.apply(this, args);
    };

    // 拦截 fetch —— 屏蔽日志上报
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input?.url || "";
      const pathname = (() => {
        try {
          return new URL(url, location.origin).pathname;
        } catch {
          return url;
        }
      })();
      const isBlocked = blockedPaths.some((p) => pathname === p);
      if (isBlocked) {
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      return originalFetch.apply(this, arguments);
    };

    // 拦截 sendBeacon —— 屏蔽日志上报
    const originalSendBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (url, data) {
      const pathname = (() => {
        try {
          return new URL(url, location.origin).pathname;
        } catch {
          return url;
        }
      })();
      const isBlocked = blockedPaths.some((p) => pathname === p);
      if (isBlocked) return true;
      return originalSendBeacon.apply(this, arguments);
    };
  }

  // ==================== 主题管理 ====================
  function applyTheme() {
    if (!document.body) return;
    const THEME_KEY = "Bard-Color-Theme";
    const theme = localStorage.getItem(THEME_KEY) || "";
    document.body.classList.remove("light-theme", "dark-theme");
    if (theme === "Bard-Light-Theme") {
      document.body.classList.add("light-theme");
    } else {
      document.body.classList.add("dark-theme");
    }
  }

  // PLACEHOLDER_CHUNK_8

  function toggleTheme() {
    if (!document.body) return;
    const THEME_KEY = "Bard-Color-Theme";
    const current = localStorage.getItem(THEME_KEY) || "";
    let newTheme, newClass;
    if (current === "Bard-Dark-Theme" || current === "") {
      newTheme = "Bard-Light-Theme";
      newClass = "light-theme";
    } else {
      newTheme = "Bard-Dark-Theme";
      newClass = "dark-theme";
    }
    localStorage.setItem(THEME_KEY, newTheme);
    document.body.classList.remove("light-theme", "dark-theme");
    document.body.classList.add(newClass);
    layer.msg(
      newClass === "light-theme"
        ? "已切换到浅色主题｜Switched to Light Theme"
        : "已切换到深色主题｜Switched to Dark Theme"
    );
  }

  // ==================== 确保快捷菜单存在 ====================
  function ensureRadialMenu() {
    if (!document.querySelector(".radial-menu-container")) createRadialMenu();
  }

  function startEnhanceUI() {
    applyTheme();
    ensureRadialMenu();
    setInterval(ensureRadialMenu, 100);
  }

  function whenBodyReady(fn) {
    if (document.body) {
      fn();
      return;
    }
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  // ==================== 启动入口 ====================
  initEnvironmentSpoof();
  setupNetworkInterceptors();
  whenBodyReady(startEnhanceUI);

  // PLACEHOLDER_CHUNK_9

  // PLACEHOLDER_CHUNK_10

  // ==================== 导出对话（高级模式：选择格式） ====================
  function showExportDialog() {
    if (!isGeminiAdvanceExport) return exportAsMarkdown();
    const convInfo = parseConversationPath();
    if (!convInfo || !convInfo.convId) {
      return layer.msg("当前未在对话页面｜Not conversation page"), null;
    }
    layer.open({
      type: 1,
      title: false,
      content:
        '\n      <div style="padding: 32px 40px; background: #fff; border-radius: 16px;">\n        <div style="text-align: center; margin-bottom: 28px;">\n          <p style="font-size: 18px; color: #1a1a1a; margin: 0; font-weight: 600;">选择导出格式</p>\n          <p style="font-size: 13px; color: #888; margin-top: 8px;">选择适合您需求的格式下载对话内容</p>\n        </div>\n        <div style="display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; max-width: 340px; margin: 0 auto;">\n          <div style="text-align: center; flex: 0 0 calc(50% - 8px);">\n            <button class="layui-btn layui-btn-lg" style="width: 100%; height: 90px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: none; background: #f5f7fa; color: #333; border-radius: 12px; box-shadow: none; transition: all 0.2s ease;"\n                    onmouseover="this.style.background=\'#e8f4ff\'; this.style.transform=\'translateY(-2px)\';"\n                    onmouseout="this.style.background=\'#f5f7fa\'; this.style.transform=\'translateY(0)\';"\n                    onclick="downloadConversation(\'md\')">\n              <i class="layui-icon layui-icon-file-b" style="font-size: 32px; color: #1890ff; margin-top: 4px; margin-bottom: -6px;"></i>\n              <span style="font-size: 13px; font-weight: 500;">Markdown</span>\n            </button>\n            <p style="font-size: 11px; color: #999; margin-top: 8px;">原始格式，支持再次编辑</p>\n          </div>\n          <div style="text-align: center; flex: 0 0 calc(50% - 8px);">\n            <button class="layui-btn layui-btn-lg" style="width: 100%; height: 90px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: none; background: #f5f7fa; color: #333; border-radius: 12px; box-shadow: none; transition: all 0.2s ease;"\n                    onmouseover="this.style.background=\'#fff5f2\'; this.style.transform=\'translateY(-2px)\';"\n                    onmouseout="this.style.background=\'#f5f7fa\'; this.style.transform=\'translateY(0)\';"\n                    onclick="downloadConversation(\'pdf\')">\n              <i class="layui-icon layui-icon-file" style="font-size: 32px; color: #ff5722; margin-top: 4px; margin-bottom: -6px;"></i>\n              <span style="font-size: 13px; font-weight: 500;">PDF</span>\n            </button>\n            <p style="font-size: 11px; color: #999; margin-top: 8px;">便于分享和打印阅读</p>\n          </div>\n          <div style="text-align: center; flex: 0 0 calc(50% - 8px);">\n            <button class="layui-btn layui-btn-lg" style="width: 100%; height: 90px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: none; background: #f5f7fa; color: #333; border-radius: 12px; box-shadow: none; transition: all 0.2s ease;"\n                    onmouseover="this.style.background=\'#f0fff4\'; this.style.transform=\'translateY(-2px)\';"\n                    onmouseout="this.style.background=\'#f5f7fa\'; this.style.transform=\'translateY(0)\';"\n                    onclick="downloadConversation(\'png\')">\n              <i class="layui-icon layui-icon-picture" style="font-size: 32px; color: #5FB878; margin-top: 4px; margin-bottom: -6px;"></i>\n              <span style="font-size: 13px; font-weight: 500;">图片</span>\n            </button>\n            <p style="font-size: 11px; color: #999; margin-top: 8px;">适合社交媒体分享</p>\n          </div>\n          <div style="text-align: center; flex: 0 0 calc(50% - 8px);">\n            <button class="layui-btn layui-btn-lg" style="width: 100%; height: 90px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: none; background: #f5f7fa; color: #333; border-radius: 12px; box-shadow: none; transition: all 0.2s ease;"\n                    onmouseover="this.style.background=\'#f0f4ff\'; this.style.transform=\'translateY(-2px)\';"\n                    onmouseout="this.style.background=\'#f5f7fa\'; this.style.transform=\'translateY(0)\';"\n                    onclick="downloadConversation(\'docx\')">\n              <i class="layui-icon layui-icon-template-1" style="font-size: 32px; color: #2b579a; margin-top: 4px; margin-bottom: -6px;"></i>\n              <span style="font-size: 13px; font-weight: 500;">Word</span>\n            </button>\n            <p style="font-size: 11px; color: #999; margin-top: 8px;">Office文档便于编辑</p>\n          </div>\n        </div>\n      </div>\n    ',
      area: ["600px", "auto"],
      shade: 0.4,
      shadeClose: true,
      closeBtn: 1,
      anim: 0,
      skin: "layer-export-dialog-flat",
    });
  }

  // ==================== 释放车队配额并返回首页 ====================
  function releaseQuotaAndGoHome() {
    fetch("/frontend-api/releaseGeminiFleetQuota")
      .then((res) => res.json())
      .then(() => {
        window.location.href = themeBaseUrl;
      })
      .catch(() => {
        window.location.href = themeBaseUrl;
      });
  }

  function postGatewayJSON(url) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.message || "请求失败");
        err.status = res.status;
        throw err;
      }
      return data;
    });
  }

  function switchGeminiAccount() {
    const loadingIdx = layer.load(2, { shade: [0.3, "#000"], content: "正在换车..." });
    postGatewayJSON("/api/switch-account")
      .then((data) => {
        layer.close(loadingIdx);
        layer.msg("已换车，正在进入新会话", { time: 1200 });
        setTimeout(() => {
          window.location.href = data.app_url || "/gemini.google.com/app";
        }, 600);
      })
      .catch((err) => {
        layer.close(loadingIdx);
        if (err.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (err.status === 409) {
          window.location.href = "/select";
          return;
        }
        layer.msg(err.message || "换车失败", { time: 3000, icon: 2 });
      });
  }

  function backToGeminiSelect() {
    const loadingIdx = layer.load(2, { shade: [0.3, "#000"], content: "正在返回选车..." });
    postGatewayJSON("/api/back-to-select")
      .then((data) => {
        layer.close(loadingIdx);
        window.location.href = data.select_url || "/select";
      })
      .catch((err) => {
        layer.close(loadingIdx);
        if (err.status === 401) {
          window.location.href = "/login";
          return;
        }
        layer.msg(err.message || "返回选车失败", { time: 3000, icon: 2 });
      });
  }

  // PLACEHOLDER_CHUNK_11

  // ==================== 创建径向快捷菜单 ====================
  function createRadialMenu() {
    // 注入样式
    const style = document.createElement("style");
    style.id = "radial-menu-styles";
    style.textContent = `
    .radial-menu-container {
      position: fixed; right: 20px; bottom: 100px; z-index: 1000; user-select: none;
    }
    .radial-menu-trigger {
      width: 50px; height: 50px; border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
      position: relative; z-index: 10;
    }
    .radial-menu-trigger:hover { transform: scale(1.1); box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5); }
    .radial-menu-trigger.open { transform: rotate(45deg); }
    .radial-menu-trigger svg { width: 24px; height: 24px; stroke: white; stroke-width: 2; fill: none; transition: transform 0.3s ease; }
    .radial-menu-items { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 1001; }
    .radial-menu-items.open { pointer-events: auto; }
    .radial-menu-item {
      position: absolute; width: 40px; height: 40px; border-radius: 50%;
      background: #393939; border: 2px solid transparent; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3); opacity: 0;
      transform: translate(-50%, -50%) scale(0);
      transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55),
                  opacity 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55),
                  background 0.15s ease-out, box-shadow 0.15s ease-out, border-color 0.15s ease-out;
    }
    .radial-menu-items.open .radial-menu-item { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    .radial-menu-items.open .radial-menu-item:hover { transform: translate(-50%, -50%) scale(1.12); }
    .radial-menu-item:hover { background: #4a4a4a; border-color: rgba(102, 126, 234, 0.41); box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4); }
    .radial-menu-item svg { width: 18px; height: 18px; stroke: #c9c6be; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; fill: none; transition: stroke 0.15s ease-out; }
    .radial-menu-item:hover svg { stroke: #fff; }
    .radial-menu-tooltip {
      position: absolute; right: calc(100% + 10px); top: 50%; transform: translateY(-50%);
      background: rgba(0, 0, 0, 0.9); color: white; padding: 6px 12px; border-radius: 4px;
      font-size: 12px; white-space: nowrap; pointer-events: none; opacity: 0;
      transition: opacity 0.12s ease-out; z-index: 1002;
    }
    .radial-menu-item:hover .radial-menu-tooltip { opacity: 1; }
    .radial-menu-trigger-tooltip {
      position: absolute; right: calc(100% + 10px); top: 50%; transform: translateY(-50%);
      background: rgba(0, 0, 0, 0.9); color: white; padding: 6px 12px; border-radius: 4px;
      font-size: 12px; white-space: nowrap; pointer-events: none; opacity: 0;
      transition: opacity 0.2s ease; z-index: 1002;
    }
    .radial-menu-trigger:hover .radial-menu-trigger-tooltip { opacity: 1; }
    .radial-menu-trigger.open .radial-menu-trigger-tooltip { opacity: 0; }
    .radial-menu-backdrop { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 999; display: none; }
    .radial-menu-backdrop.open { display: block; }
    `;
    document.head.appendChild(style);

    // PLACEHOLDER_CHUNK_12

    // 创建 DOM 结构
    const container = document.createElement("div");
    container.className = "radial-menu-container";

    const backdrop = document.createElement("div");
    backdrop.className = "radial-menu-backdrop";
    container.appendChild(backdrop);

    const itemsContainer = document.createElement("div");
    itemsContainer.className = "radial-menu-items";
    container.appendChild(itemsContainer);

    const triggerBtn = document.createElement("button");
    triggerBtn.className = "radial-menu-trigger";
    triggerBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>`;

    const triggerTooltip = document.createElement("span");
    triggerTooltip.className = "radial-menu-trigger-tooltip";
    triggerTooltip.textContent = "快捷菜单｜Quick Menu";
    triggerBtn.appendChild(triggerTooltip);
    container.appendChild(triggerBtn);

    // 菜单开关逻辑
    let isOpen = false;
    function toggleMenu() {
      isOpen = !isOpen;
      triggerBtn.classList.toggle("open", isOpen);
      itemsContainer.classList.toggle("open", isOpen);
      backdrop.classList.toggle("open", isOpen);
    }

    triggerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    // 触摸事件支持
    let touchStarted = false;
    triggerBtn.addEventListener("touchstart", (e) => { touchStarted = true; e.stopPropagation(); }, { passive: true });
    triggerBtn.addEventListener("touchend", (e) => {
      if (touchStarted) { touchStarted = false; e.stopPropagation(); e.preventDefault(); toggleMenu(); }
    }, { passive: false });

    backdrop.addEventListener("click", () => { if (isOpen) toggleMenu(); });
    backdrop.addEventListener("touchend", (e) => {
      if (isOpen) { e.preventDefault(); toggleMenu(); }
    }, { passive: false });

    // PLACEHOLDER_CHUNK_13

    // 菜单项定义
    const menuItems = [
      {
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
        tooltip: "一键换车｜Switch Car",
        onClick: () => switchGeminiAccount(),
      },
      {
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/><path d="M19 5v14"/></svg>',
        tooltip: "返回选车｜Select Car",
        onClick: () => backToGeminiSelect(),
      },
      // {
      //   icon: '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
      //   tooltip: "回到首页｜Back Home",
      //   onClick: () => releaseQuotaAndGoHome(),
      // },
      {
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        tooltip: "导出对话｜Export Conversation",
        onClick: () => showExportDialog(),
      },
      {
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
        tooltip: "切换主题｜Toggle Theme",
        onClick: () => toggleTheme(),
      },
      {
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>',
        tooltip: "删除对话｜Delete Conversation",
        onClick: () => deleteConversation(),
      },
    ];

    // 可选菜单项：站内购买
    const purchaseItem = {
      icon: '<svg viewBox="0 0 24 24"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
      tooltip: "站内购买｜In-Site Purchase",
      onClick: () => showIframeDialog("站内购买", "/pastel#/subscribe", 710, 1125, 2),
    };

    if (isEnabledChatBuySub) menuItems.push(purchaseItem);

    // PLACEHOLDER_CHUNK_14

    // 按径向布局排列菜单项
    const radius = 70;
    const startAngle = -90;
    const totalAngle = 180;

    menuItems.forEach((item, index) => {
      const btn = document.createElement("button");
      btn.className = "radial-menu-item";
      btn.innerHTML = item.icon;

      const angleStep = menuItems.length > 1 ? totalAngle / (menuItems.length - 1) : 0;
      const angle = startAngle - index * angleStep;
      const rad = (angle * Math.PI) / 180;
      const x = Math.cos(rad) * radius;
      const y = Math.sin(rad) * radius;

      btn.style.left = x + "px";
      btn.style.top = y + "px";
      btn.style.transitionDelay = index * 0.03 + "s";

      const tooltip = document.createElement("span");
      tooltip.className = "radial-menu-tooltip";
      tooltip.textContent = item.tooltip;
      btn.appendChild(tooltip);

      const handleClick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        item.onClick();
        toggleMenu();
      };
      btn.addEventListener("click", handleClick);

      // 触摸支持
      let itemTouchStarted = false;
      btn.addEventListener("touchstart", (e) => { itemTouchStarted = true; e.stopPropagation(); }, { passive: true });
      btn.addEventListener("touchend", (e) => {
        if (itemTouchStarted) {
          itemTouchStarted = false;
          e.stopPropagation();
          e.preventDefault();
          item.onClick();
          toggleMenu();
        }
      }, { passive: false });

      itemsContainer.appendChild(btn);
    });

    // 启用拖拽
    enableDrag(container, triggerBtn);
    document.body.appendChild(container);
  }

  // ==================== 菜单拖拽功能 ====================
  function enableDrag(container, handle) {
    let isDragging = false, startX, startY, startRight, startBottom, hasMoved = false;

    function onStart(e) {
      if (e.target !== handle && !handle.contains(e.target)) return;
      isDragging = true;
      hasMoved = false;
      const point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;
      const rect = container.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startBottom = window.innerHeight - rect.bottom;
    }

    function onMove(e) {
      if (!isDragging) return;
      const point = e.touches ? e.touches[0] : e;
      const dx = startX - point.clientX;
      const dy = startY - point.clientY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasMoved = true;
        e.preventDefault();
      }
      if (!hasMoved) return;
      let newRight = Math.max(10, Math.min(startRight + dx, window.innerWidth - 60));
      let newBottom = Math.max(10, Math.min(startBottom + dy, window.innerHeight - 60));
      container.style.right = newRight + "px";
      container.style.bottom = newBottom + "px";
    }

    // PLACEHOLDER_CHUNK_15

    function onEnd(e) {
      if (!isDragging) return;
      if (hasMoved && e.cancelable) e.preventDefault();
      isDragging = false;
      if (hasMoved) {
        localStorage.setItem(
          "radial-menu-position",
          JSON.stringify({
            right: parseInt(container.style.right),
            bottom: parseInt(container.style.bottom),
          })
        );
      }
    }

    handle.addEventListener("mousedown", onStart);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
    handle.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: false });

    // 恢复上次保存的位置
    const saved = localStorage.getItem("radial-menu-position");
    if (saved)
      try {
        const pos = JSON.parse(saved);
        container.style.right = pos.right + "px";
        container.style.bottom = pos.bottom + "px";
      } catch (e) {}
  }

  // ==================== Markdown 内容透传（无处理） ====================
  function processMarkdown(content) {
    return content;
  }

  // ==================== 导出为 PDF ====================
  function exportAsPdf(markdownContent, filename) {
    let loadingIdx = 0;
    try {
      if (!window.jspdf || !window.html2canvas) {
        layer.msg("PDF 转换库未加载，请确保已引入 jsPDF 和 html2canvas 库");
        return;
      }
      loadingIdx = layer.load(2, { shade: [0.3, "#000"] });
      const processed = processMarkdown(markdownContent);
      const tempDiv = document.createElement("div");
      tempDiv.style.cssText =
        "position: absolute; left: -9999px; top: 0; width: 794px; padding: 40px; background: white; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', '微软雅黑', sans-serif; font-size: 14px; line-height: 1.8; color: #333;";

      // 内联样式（用于 html2canvas 渲染）
      tempDiv.innerHTML = `<style>
        * { box-sizing: border-box; }
        h1, h2, h3, h4, h5, h6 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; color: #24292e; }
        h1 { font-size: 28px; } h2 { font-size: 22px; } h3 { font-size: 18px; }
        p { margin-bottom: 16px; }
        code { background: #f6f8fa; padding: 2px 4px; border-radius: 3px; font-family: Consolas, Monaco, monospace; font-size: 13px; color: #e01e5a; }
        pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow: auto; margin-bottom: 16px; border: 1px solid #e1e4e8; }
        pre code { background: none; padding: 0; color: #333 !important; font-size: 13px; line-height: 1.5; }
        blockquote { border-left: 4px solid #0366d6; padding-left: 16px; margin: 0 0 16px 0; color: #6a737d; }
        ul, ol { margin-bottom: 16px; padding-left: 32px; } li { margin-bottom: 8px; }
        table { border-collapse: collapse; margin-bottom: 16px; width: 100%; }
        th, td { border: 1px solid #dfe2e5; padding: 8px 12px; }
        th { background: #f6f8fa; font-weight: 600; }
      </style>`;

      // PLACEHOLDER_CHUNK_16

      if (window.markdownit) {
        const md = window.markdownit({ html: false, breaks: true, linkify: true });
        const header = `<div style="text-align: center; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px solid #e1e4e8;">
          <h1 style="font-size: 32px; margin: 0 0 10px 0;">${filename.replace(".pdf", "").split("_")[0]}</h1>
          <p style="color: #666; font-size: 14px; margin: 0;">导出时间：${new Date().toLocaleString("zh-CN")}</p>
        </div>`;
        tempDiv.innerHTML += header + md.render(processed);
      } else {
        tempDiv.innerHTML += processed
          .replace(/\n/g, "<br>")
          .replace(/### (.*)/g, "<h3>$1</h3>")
          .replace(/## (.*)/g, "<h2>$1</h2>")
          .replace(/# (.*)/g, "<h1>$1</h1>")
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.*?)\*/g, "<em>$1</em>")
          .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
          .replace(/`([^`]+)`/g, "<code>$1</code>");
      }

      document.body.appendChild(tempDiv);
      html2canvas(tempDiv, {
        scale: 2, useCORS: true, logging: false, backgroundColor: "#ffffff",
        windowWidth: 874, windowHeight: tempDiv.scrollHeight,
      }).then((canvas) => {
        document.body.removeChild(tempDiv);
        const { jsPDF } = window.jspdf;
        const imgData = canvas.toDataURL("image/png");
        const pageWidth = 210, pageHeight = 297;
        const contentWidth = pageWidth - 20;
        const imgHeight = (canvas.height * contentWidth) / canvas.width;
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

        let remaining = imgHeight, yOffset = 10;
        pdf.addImage(imgData, "PNG", 10, yOffset, contentWidth, imgHeight);
        remaining -= pageHeight - 20;
        while (remaining > 0) {
          yOffset = remaining - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, "PNG", 10, yOffset, contentWidth, imgHeight);
          remaining -= pageHeight - 20;
        }
        pdf.save(filename);
        layer.close(loadingIdx);
        layer.msg("PDF 导出成功！");
      }).catch((err) => {
        if (document.body.contains(tempDiv)) document.body.removeChild(tempDiv);
        layer.close(loadingIdx);
        console.error("PDF conversion error:", err);
        layer.msg("PDF 转换失败: " + err.message);
      });
    } catch (err) {
      if (loadingIdx) layer.close(loadingIdx);
      console.error("PDF conversion error:", err);
      layer.msg("PDF 转换失败: " + err.message);
    }
  }

  // PLACEHOLDER_CHUNK_17

  // ==================== 导出为 PNG 图片 ====================
  function exportAsPng(markdownContent, filename) {
    let loadingIdx = 0;
    try {
      if (!window.markdownit || !window.html2canvas) {
        layer.msg("图片转换库未加载，请确保已引入 html2canvas 和 markdown-it 库");
        return;
      }
      loadingIdx = layer.load(2, { shade: [0.3, "#000"] });
      const md = window.markdownit({ html: false, breaks: true, linkify: true, typographer: true, xhtmlOut: false });
      const processed = processMarkdown(markdownContent);
      const tempDiv = document.createElement("div");
      tempDiv.style.cssText =
        "position: absolute; left: -9999px; top: 0; width: 1200px; padding: 60px; background: white; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif; font-size: 16px; line-height: 1.8; color: #333; letter-spacing: 0.5px; word-spacing: 1px;";

      const title = filename.replace(".png", "").split("_")[0];
      tempDiv.innerHTML = `<style>
        h1, h2, h3 { margin-top: 32px; margin-bottom: 20px; font-weight: 600; line-height: 1.25; color: #24292e; }
        h1 { font-size: 36px; } h2 { font-size: 28px; } h3 { font-size: 24px; }
        p { margin-bottom: 20px; }
        code { background: #f6f8fa; padding: 3px 6px; border-radius: 3px; font-family: Consolas, Monaco, monospace; font-size: 14px; color: #e01e5a; }
        pre { background: #f6f8fa; padding: 20px; border-radius: 8px; overflow: auto; margin-bottom: 20px; border: 1px solid #e1e4e8; }
        pre code { background: none; padding: 0; color: #333 !important; font-size: 13px; line-height: 1.5; }
        blockquote { border-left: 4px solid #0366d6; padding-left: 20px; margin: 0 0 20px 0; color: #6a737d; font-style: italic; }
        ul, ol { margin-bottom: 20px; padding-left: 40px; } li { margin-bottom: 10px; }
        a { color: #0366d6; text-decoration: none; } a:hover { text-decoration: underline; }
        table { border-collapse: collapse; margin-bottom: 20px; width: 100%; }
        th, td { border: 1px solid #dfe2e5; padding: 12px 16px; } th { background: #f6f8fa; font-weight: 600; }
        hr { border: none; border-top: 2px solid #e1e4e8; margin: 32px 0; }
        img { max-width: 100%; height: auto; }
      </style>
      <div style="margin-bottom: 50px; padding-bottom: 30px; border-bottom: 2px solid #e1e4e8;">
        <h1 style="font-size: 42px; color: #24292e; margin: 0 0 10px 0;">${title}</h1>
        <p style="color: #586069; font-size: 14px; margin: 0;">
          <span style="margin-right: 20px;">📅 导出时间：${new Date().toLocaleString("zh-CN")}</span>
          <span>📄 格式：PNG 图片</span>
        </p>
      </div>
      <div style="padding-bottom: 40px;">
        ${md ? md.render(processed) : processed.replace(/\n/g, "<br>")}
      </div>
      <div style="margin-top: 50px; padding-top: 30px; border-top: 2px solid #e1e4e8; text-align: center; color: #586069; font-size: 14px;">
        <p>由 Claude Share 导出 • ${window.location.origin}</p>
      </div>`;

      document.body.appendChild(tempDiv);
      html2canvas(tempDiv, {
        scale: 2, useCORS: true, logging: false, backgroundColor: "#ffffff",
        windowWidth: 1320, windowHeight: tempDiv.scrollHeight,
      }).then((canvas) => {
        document.body.removeChild(tempDiv);
        canvas.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          layer.close(loadingIdx);
          layer.msg("图片导出成功！");
        }, "image/png");
      }).catch((err) => {
        if (document.body.contains(tempDiv)) document.body.removeChild(tempDiv);
        layer.close(loadingIdx);
        console.error("Image conversion error:", err);
        layer.msg("图片转换失败: " + err.message);
      });
    } catch (err) {
      if (loadingIdx) layer.close(loadingIdx);
      console.error("Image conversion error:", err);
      layer.msg("图片转换失败: " + err.message);
    }
  }

  // PLACEHOLDER_CHUNK_18

  // ==================== 下载对话（统一入口） ====================
  async function downloadConversation(format) {
    layer.closeAll();
    const timestamp = new Date().Format("yyyy-MM-dd HH:mm:ss");

    const convData = await getConversationContent();
    if (!convData) return;

    const content = convData.content;
    const baseFilename = "gemini-export-" + convData.title;

    if (format === "md") {
      downloadTextAsFile(content, baseFilename + "_" + timestamp + ".md");
    } else if (format === "pdf") {
      exportAsPdf(content, baseFilename + "_" + timestamp + ".pdf");
    } else if (format === "png") {
      exportAsPng(content, baseFilename + "_" + timestamp + ".png");
    } else if (format === "docx") {
      exportAsDocx(content, baseFilename + "_" + timestamp + ".doc", convData.title);
    }
  }

  // ==================== 导出为 Word 文档（markdown → Word 兼容 HTML） ====================
  function exportAsDocx(markdownContent, filename, title) {
    const body = window.markdownit
      ? window.markdownit({ html: false, breaks: true, linkify: true }).render(markdownContent)
      : markdownContent.replace(/\n/g, "<br>");
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>' + (title || "conversation") + '</title>' +
      '<style>body{font-family:"Microsoft YaHei",Arial,sans-serif;line-height:1.7;color:#222;}' +
      'h1{font-size:24pt;}h2{font-size:18pt;}h3{font-size:14pt;}' +
      'pre{background:#f6f8fa;padding:12px;border:1px solid #e1e4e8;}' +
      'code{font-family:Consolas,monospace;background:#f6f8fa;padding:1px 4px;}' +
      'blockquote{border-left:4px solid #999;padding-left:12px;color:#666;}' +
      '</style></head><body>' + body + '</body></html>';
    const blob = new Blob(["﻿", html], { type: "application/msword" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    layer.msg("Word 文档导出成功！");
  }

  // ==================== 删除对话（仅本地落库记录） ====================
  function deleteConversation() {
    const convInfo = parseConversationPath();
    const convId = convInfo && convInfo.convId;
    if (!convId) {
      layer.msg("当前未进行任何会话｜No conversation");
      return;
    }
    layer.confirm("确定删除该对话吗？此操作仅删除本地记录，无法恢复。", {
      btn: ["确定｜Confirm", "取消｜Cancel"],
    }, function () {
      const loadingIdx = setLoading("正在删除对话｜Deleting Conversation...");
      fetch("/api/conversations/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: convId }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          layer.close(loadingIdx);
          if (!res.ok) {
            if (res.status === 401) {
              window.location.href = "/login";
              return;
            }
            if (res.status === 404) {
              layer.msg("本地未找到该对话｜Not found locally");
              return;
            }
            layer.msg(data.message || "删除失败｜Delete Failed");
            return;
          }
          layer.msg("删除成功｜Deleted Successfully");
          const homePath = (convInfo && convInfo.basePrefix ? convInfo.basePrefix : "") + "/app";
          setTimeout(() => { window.location.href = homePath || "/app"; }, 1000);
        })
        .catch(() => {
          layer.close(loadingIdx);
          layer.msg("删除失败｜Delete Failed");
        });
    });
  }

  // PLACEHOLDER_CHUNK_19

  function stripProxyDomainPrefix(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return segments;
    const first = segments[0] || "";
    if (
      first.indexOf(".") > 0 &&
      /^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(first)
    ) {
      return segments.slice(1);
    }
    return segments;
  }

  // ==================== 解析当前对话路径 ====================
  function parseConversationPath() {
    const pathname = location.pathname.replace(/\/+$/, "");
    const segments = stripProxyDomainPrefix(pathname.split("/").filter(Boolean));
    if (segments.length === 0) return null;

    let basePrefix = "", userIndex = null, offset = 0;

    // 处理 /u/N/ 前缀
    if (segments[0] === "u" && /^\d+$/.test(segments[1] || "")) {
      userIndex = segments[1];
      basePrefix = "/u/" + userIndex;
      offset = 2;
    }

    // /app/{convId} 格式
    if (segments[offset] === "app" && segments[offset + 1]) {
      const convId = segments[offset + 1];
      return {
        kind: "app",
        convId,
        userIndex,
        basePrefix,
        sourcePath: basePrefix + "/app/" + convId,
      };
    }

    // /gem/{gemId}/{convId} 格式
    if (segments[offset] === "gem" && segments[offset + 1] && segments[offset + 2]) {
      const gemId = segments[offset + 1];
      const convId = segments[offset + 2];
      return {
        kind: "gem",
        gemId,
        convId,
        userIndex,
        basePrefix,
        sourcePath: basePrefix + "/gem/" + gemId + "/" + convId,
      };
    }

    return null;
  }

  // ==================== 获取对话内容 ====================
  async function getConversationContent() {
    const convInfo = parseConversationPath();
    if (!convInfo || !convInfo.convId)
      return layer.msg("当前未在对话页面｜Not conversation page"), null;
    const loadingIdx = setLoading("正在获取对话内容｜Getting Conversation Content...");
    try {
      const res = await fetch("/api/conversations/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: convInfo.convId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.code !== 1) {
        layer.msg(data.message || data.msg || "获取对话内容失败｜Failed to get conversation content");
        return null;
      }
      return data.data;
    } catch (err) {
      layer.msg("获取对话内容失败｜Failed to get conversation content");
      return null;
    } finally {
      layer.close(loadingIdx);
    }
  }

  // ==================== 简单导出为 Markdown ====================
  async function exportAsMarkdown() {
    const convInfo = parseConversationPath();
    if (!convInfo || !convInfo.convId)
      return layer.msg("当前未在对话页面｜Not conversation page"), null;
    const convData = await getConversationContent();
    if (!convData) return;
    const filename = convData.title + "_" + new Date().Format("yyyy-MM-dd HH:mm:ss") + ".md";
    downloadTextAsFile(convData.content, filename, "text/markdown");
  }

  // 暴露到全局
  window.downloadConversation = downloadConversation;

  // PLACEHOLDER_CHUNK_20

  // ==================== 对话时间线导航 ====================

  // 注入时间线样式
  function injectTimelineStyles() {
    if (document.getElementById("gemini-timeline-styles")) return;
    const style = document.createElement("style");
    style.id = "gemini-timeline-styles";
    style.textContent = `
      .gemini-timeline-bar {
        position: fixed; right: 18px; top: 80px; width: 20px;
        height: calc(100vh - 160px); max-height: 600px; min-height: 200px;
        background: rgba(248, 250, 252, 0.85); border-radius: 10px; z-index: 999;
        display: flex; flex-direction: column; align-items: center;
        backdrop-filter: blur(4px); transition: opacity 0.2s, background-color 0.3s; opacity: 0.85;
      }
      html.dark .gemini-timeline-bar,
      [data-theme="dark"] .gemini-timeline-bar,
      .theme-host.dark-theme .gemini-timeline-bar { background: rgba(2, 6, 23, 0.72); }
      .gemini-timeline-bar:hover { opacity: 1; }
      .gemini-timeline-bar.hidden { display: none; }
      .timeline-track { position: relative; width: 100%; height: 100%; overflow: visible; }
      .timeline-track-content { position: relative; width: 100%; height: 100%; }
      .timeline-dot {
        position: absolute; left: 50%; transform: translateX(-50%);
        width: 10px; height: 10px; background: #888; border-radius: 50%;
        cursor: pointer; transition: all 0.15s ease; border: none; padding: 0;
      }
      .timeline-dot:hover { background: #fff; transform: translateX(-50%) scale(1.4); box-shadow: 0 0 8px rgba(255,255,255,0.5); }
      .timeline-dot.active { background: #60a5fa; transform: translateX(-50%) scale(1.2); box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.4), 0 0 12px rgba(59, 130, 246, 0.5); }
      .timeline-tooltip {
        position: fixed; right: 36px; background: rgba(40, 40, 40, 0.95); color: #e8e8e8;
        padding: 8px 12px; border-radius: 6px; font-size: 13px; max-width: 280px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        pointer-events: none; z-index: 1001; opacity: 0; transition: opacity 0.15s;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      }
      .timeline-tooltip.visible { opacity: 1; }
      .timeline-runner {
        position: absolute; left: 50%; transform: translateX(-50%);
        width: 10px; height: 10px; border: 2px solid #8ab4f8;
        border-radius: 50%; pointer-events: none; opacity: 0;
      }
      .timeline-runner.animating { opacity: 1; }
    `;
    document.head.appendChild(style);
  }

  // PLACEHOLDER_CHUNK_21

  // 时间线控制器类
  class ConversationTimeline {
    constructor() {
      this.scrollContainer = null;
      this.conversationContainer = null;
      this.markers = [];
      this.activeTurnId = null;
      this.ui = { timelineBar: null, tooltip: null, track: null, trackContent: null };
      this.mutationObserver = null;
      this.resizeObserver = null;
      this.scrollMode = "flow";
      this.flowDuration = 650;
      this.scrollRafId = null;
      this.recalcTimer = null;
      this.recalcDelay = 200;
      this.tooltipHideTimer = null;
      this.userTurnSelector = "";
      this.onScroll = null;
      this.onTimelineClick = null;
      this.onTimelineOver = null;
      this.onTimelineOut = null;
      this.runnerEl = null;
      this.flowAnimating = false;
      this.isScrolling = false;
    }

    async init() {
      const found = await this.findCriticalElements();
      if (!found) {
        console.log("[Timeline] 未找到关键元素，跳过初始化");
        return;
      }
      this.injectUI();
      this.setupEventListeners();
      this.setupObservers();
      this.recalculateMarkers();
      console.log("[Timeline] 初始化完成");
    }

    async findCriticalElements() {
      const selectors = [
        ".user-query-bubble-with-background",
        ".user-query-bubble-container",
        ".user-query-container",
        'div[aria-label="User message"]',
      ];
      let foundEl = null, foundSelector = "";
      for (let i = 0; i < 40; i++) {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) { foundEl = el; foundSelector = sel; break; }
        }
        if (foundEl) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!foundEl) {
        this.conversationContainer = document.querySelector("main") || document.body;
        this.userTurnSelector = selectors.join(",");
      } else {
        this.conversationContainer = document.querySelector("main") || document.body;
        this.userTurnSelector = foundSelector;
      }

      // 向上查找可滚动容器
      let node = foundEl || this.conversationContainer;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          this.scrollContainer = node;
          break;
        }
        node = node.parentElement;
      }
      if (!this.scrollContainer)
        this.scrollContainer = document.scrollingElement || document.documentElement || document.body;
      return true;
    }

    // PLACEHOLDER_CHUNK_22

    injectUI() {
      let bar = document.querySelector(".gemini-timeline-bar");
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "gemini-timeline-bar";
        document.body.appendChild(bar);
      }
      this.ui.timelineBar = bar;

      let track = bar.querySelector(".timeline-track");
      if (!track) { track = document.createElement("div"); track.className = "timeline-track"; bar.appendChild(track); }
      let trackContent = track.querySelector(".timeline-track-content");
      if (!trackContent) { trackContent = document.createElement("div"); trackContent.className = "timeline-track-content"; track.appendChild(trackContent); }
      this.ui.track = track;
      this.ui.trackContent = trackContent;

      if (!this.ui.tooltip) {
        const tooltip = document.createElement("div");
        tooltip.className = "timeline-tooltip";
        tooltip.id = "gemini-timeline-tooltip";
        document.body.appendChild(tooltip);
        this.ui.tooltip = tooltip;
      }
      if (!this.runnerEl) {
        const runner = document.createElement("div");
        runner.className = "timeline-runner";
        trackContent.appendChild(runner);
        this.runnerEl = runner;
      }
    }

    setupEventListeners() {
      this.onTimelineClick = (e) => {
        const dot = e.target.closest(".timeline-dot");
        if (!dot) return;
        const idx = parseInt(dot.dataset.markerIndex, 10);
        const marker = this.markers[idx];
        if (marker && marker.element) this.smoothScrollTo(marker.element, idx);
      };
      this.ui.timelineBar.addEventListener("click", this.onTimelineClick);

      this.onTimelineOver = (e) => {
        const dot = e.target.closest(".timeline-dot");
        if (dot) this.showTooltip(dot);
      };
      this.onTimelineOut = (e) => {
        const dot = e.target.closest(".timeline-dot");
        const related = e.relatedTarget?.closest?.(".timeline-dot");
        if (dot && !related) this.hideTooltip();
      };
      this.ui.timelineBar.addEventListener("mouseover", this.onTimelineOver);
      this.ui.timelineBar.addEventListener("mouseout", this.onTimelineOut);

      this.onScroll = () => this.scheduleScrollSync();
      this.scrollContainer.addEventListener("scroll", this.onScroll, { passive: true });
    }

    setupObservers() {
      this.mutationObserver = new MutationObserver(() => this.debouncedRecalc());
      if (this.conversationContainer) {
        this.mutationObserver.observe(this.conversationContainer, { childList: true, subtree: true });
      }
      this.resizeObserver = new ResizeObserver(() => this.recalculateMarkers());
      if (this.ui.timelineBar) this.resizeObserver.observe(this.ui.timelineBar);
    }

    debouncedRecalc() {
      if (this.recalcTimer) clearTimeout(this.recalcTimer);
      this.recalcTimer = setTimeout(() => this.recalculateMarkers(), this.recalcDelay);
    }

    // PLACEHOLDER_CHUNK_23

    recalculateMarkers() {
      if (!this.conversationContainer || !this.userTurnSelector) return;
      const allTurns = this.conversationContainer.querySelectorAll(this.userTurnSelector);
      const topLevel = this.filterTopLevel(Array.from(allTurns));
      if (topLevel.length === 0) {
        this.ui.timelineBar?.classList.add("hidden");
        return;
      }
      this.ui.timelineBar?.classList.remove("hidden");
      this.markers = topLevel.map((el, i) => ({
        id: "turn-" + i,
        element: el,
        summary: this.extractSummary(el),
        n: i + 1,
      }));
      this.renderMarkers();
      if (!this.activeTurnId && this.markers.length > 0)
        this.activeTurnId = this.markers[this.markers.length - 1].id;
      this.updateActiveDot(this.getActiveIndex());
      this.scheduleScrollSync();
    }

    filterTopLevel(elements) {
      if (elements.length === 0) return [];
      const result = [];
      for (const el of elements) {
        let isNested = false;
        for (const other of elements) {
          if (other !== el && other.contains(el)) { isNested = true; break; }
        }
        if (!isNested) result.push(el);
      }
      return result;
    }

    extractSummary(el) {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      return text.length > 50 ? text.slice(0, 50) + "..." : text;
    }

    renderMarkers() {
      if (!this.ui.trackContent) return;
      this.ui.trackContent.querySelectorAll(".timeline-dot").forEach((d) => d.remove());
      if (this.markers.length === 0) return;
      this.markers.forEach((marker, i) => {
        const dot = document.createElement("button");
        dot.className = "timeline-dot";
        dot.dataset.markerIndex = String(i);
        dot.dataset.targetTurnId = marker.id;
        const pct = this.markers.length === 1 ? 50 : (i / (this.markers.length - 1)) * 100;
        dot.style.top = pct + "%";
        this.ui.trackContent.appendChild(dot);
        marker.dotElement = dot;
      });
    }

    scheduleScrollSync() {
      if (this.scrollRafId) return;
      this.scrollRafId = requestAnimationFrame(() => {
        this.scrollRafId = null;
        this.syncActiveMarker();
      });
    }

    syncActiveMarker() {
      if (!this.scrollContainer || this.markers.length === 0) return;
      if (this.isScrolling) return;
      const rect = this.scrollContainer.getBoundingClientRect();
      const threshold = rect.top + rect.height * 0.4;
      let closestIdx = 0, minDist = Infinity;
      this.markers.forEach((m, i) => {
        const r = m.element.getBoundingClientRect();
        const dist = Math.abs(r.top - threshold);
        if (dist < minDist) { minDist = dist; closestIdx = i; }
      });
      const newId = this.markers[closestIdx]?.id;
      if (newId !== this.activeTurnId) {
        this.activeTurnId = newId;
        this.updateActiveDot(closestIdx);
      }
    }

    updateActiveDot(activeIdx) {
      this.markers.forEach((m, i) => {
        if (m.dotElement) m.dotElement.classList.toggle("active", i === activeIdx);
      });
    }

    // PLACEHOLDER_CHUNK_24

    showTooltip(dotEl) {
      if (this.tooltipHideTimer) { clearTimeout(this.tooltipHideTimer); this.tooltipHideTimer = null; }
      const idx = parseInt(dotEl.dataset.markerIndex, 10);
      const marker = this.markers[idx];
      if (!marker || !this.ui.tooltip) return;
      this.ui.tooltip.textContent = "#" + marker.n + ": " + marker.summary;
      const rect = dotEl.getBoundingClientRect();
      this.ui.tooltip.style.top = rect.top + rect.height / 2 - 16 + "px";
      this.ui.tooltip.classList.add("visible");
    }

    hideTooltip() {
      this.tooltipHideTimer = setTimeout(() => {
        this.ui.tooltip?.classList.remove("visible");
      }, 100);
    }

    smoothScrollTo(element, targetIdx) {
      if (!element || !this.scrollContainer) return;
      const currentIdx = this.getActiveIndex();
      if (this.scrollMode === "flow" && currentIdx >= 0 && targetIdx >= 0 && currentIdx !== targetIdx)
        this.startRunner(currentIdx, targetIdx);
      this.activeTurnId = this.markers[targetIdx]?.id;
      this.updateActiveDot(targetIdx);
      this.isScrolling = true;
      element.scrollIntoView({ behavior: "smooth", block: "center" });

      if (this._scrollEndTimer) clearTimeout(this._scrollEndTimer);
      const finish = () => {
        this.isScrolling = false;
        if (this._scrollEndHandler) {
          this.scrollContainer.removeEventListener("scrollend", this._scrollEndHandler);
          this._scrollEndHandler = null;
        }
        if (this._scrollEndTimer) { clearTimeout(this._scrollEndTimer); this._scrollEndTimer = null; }
      };
      this._scrollEndHandler = () => finish();
      this.scrollContainer.addEventListener("scrollend", this._scrollEndHandler, { once: true });
      this._scrollEndTimer = setTimeout(() => finish(), 1000);
    }

    getActiveIndex() {
      return this.markers.findIndex((m) => m.id === this.activeTurnId);
    }

    startRunner(fromIdx, toIdx) {
      if (!this.runnerEl || this.flowAnimating) return;
      const fromDot = this.markers[fromIdx]?.dotElement;
      const toDot = this.markers[toIdx]?.dotElement;
      if (!fromDot || !toDot) return;
      const fromPct = parseFloat(fromDot.style.top) || 0;
      const toPct = parseFloat(toDot.style.top) || 0;
      this.flowAnimating = true;
      this.runnerEl.style.top = fromPct + "%";
      this.runnerEl.classList.add("animating");
      const startTime = performance.now();
      const duration = this.flowDuration;
      const animate = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = this.easeOutCubic(progress);
        this.runnerEl.style.top = fromPct + (toPct - fromPct) * eased + "%";
        if (progress < 1) requestAnimationFrame(animate);
        else { this.runnerEl.classList.remove("animating"); this.flowAnimating = false; }
      };
      requestAnimationFrame(animate);
    }

    easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    destroy() {
      if (this.mutationObserver) { this.mutationObserver.disconnect(); this.mutationObserver = null; }
      if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
      if (this.scrollContainer && this.onScroll)
        this.scrollContainer.removeEventListener("scroll", this.onScroll);
      if (this.ui.timelineBar) {
        if (this.onTimelineClick) this.ui.timelineBar.removeEventListener("click", this.onTimelineClick);
        if (this.onTimelineOver) this.ui.timelineBar.removeEventListener("mouseover", this.onTimelineOver);
        if (this.onTimelineOut) this.ui.timelineBar.removeEventListener("mouseout", this.onTimelineOut);
        this.ui.timelineBar.remove();
      }
      if (this.ui.tooltip) this.ui.tooltip.remove();
      this.markers = [];
    }
  }

  // ==================== 时间线生命周期管理 ====================
  let timelineInstance = null;
  let lastHref = location.href;

  function isConversationPage() {
    return !!parseConversationPath();
  }

  function resetTimeline() {
    if (timelineInstance) {
      try { timelineInstance.destroy(); } catch (e) {}
      timelineInstance = null;
    }
    document.querySelector(".gemini-timeline-bar")?.remove();
    document.getElementById("gemini-timeline-tooltip")?.remove();
    timelineInstance = new ConversationTimeline();
    timelineInstance.init().catch((err) => {
      console.error("[Timeline] 初始化失败:", err);
    });
  }

  function checkUrlChange() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (isConversationPage()) {
      setTimeout(resetTimeline, 500);
    } else if (timelineInstance) {
      try { timelineInstance.destroy(); } catch (e) {}
      timelineInstance = null;
    }
  }

  function initTimeline() {
    injectTimelineStyles();
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function (...args) {
      origPushState.apply(history, args);
      checkUrlChange();
    };
    history.replaceState = function (...args) {
      origReplaceState.apply(history, args);
      checkUrlChange();
    };
    window.addEventListener("popstate", checkUrlChange);
    if (isConversationPage()) setTimeout(resetTimeline, 1000);
  }
})();
