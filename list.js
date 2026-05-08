// gemini-share list: 快捷菜单 / 主题切换 / 导出 / 删除。
//
// 本文件随镜像出厂为默认版本，但 docker-compose 通过 bind mount
// 把宿主机的 list.js 覆盖到 /app/js/list.js —— 客户可以热改本文件
// 来调整菜单项、文案、样式、主题色、导出格式等，不需要重新打镜像。
//
// 本文件不依赖 core.js，core.js 也不依赖本文件，加载顺序无所谓。
// 唯一的跨文件接口是：本文件挂 window.downloadConversation，
// core.js 在账号失效时调用它做自动导出再跳转。

(function () {
  "use strict";

  // ==================== 全局状态 ====================
  // 导出对话框开启高级模式：弹窗里同时给 Markdown 和 PDF 两个选择。
  // 关掉的话点"导出"会直接落 Markdown，不弹框。
  let isGeminiAdvanceExport = true;
  var themeBaseUrl = "/";

  // ==================== 用户首页（用户中心）地址 ====================
  // "返回首页"按钮的目标 URL。优先级：
  //   1. URL 参数 ?shareUrl=https://...   ← 用户中心给链接里带上
  //   2. document.referrer 的 origin     ← 来自用户中心的跳转
  //   3. localStorage 缓存               ← 之前两步成功过就一直用
  // 任何来源都必须是 http/https 协议（防 javascript:、data: 之类的注入）。
  // 必须在 IIFE 顶部立刻执行 —— Gemini SPA 启动后会 replaceState 把 URL
  // 改成 /app，query string 就丢了，等到按钮 onClick 再读就太晚。
  const HOME_URL_KEY = "gateway_home_url";

  (function captureHomeOnLoad() {
    function isSafeUrl(u) {
      return typeof u === "string" && /^https?:\/\//i.test(u);
    }
    // Method 1: URL ?shareUrl=
    try {
      const param = new URLSearchParams(window.location.search).get("shareUrl");
      if (isSafeUrl(param)) {
        localStorage.setItem(HOME_URL_KEY, param);
        return;
      }
    } catch (e) {}
    // Method 2: document.referrer 跨域 origin（仅当还没缓存过）
    try {
      const cached = localStorage.getItem(HOME_URL_KEY);
      if (cached && isSafeUrl(cached)) return;
      if (!document.referrer) return;
      const r = new URL(document.referrer);
      if (r.origin === window.location.origin) return;
      if (r.protocol !== "http:" && r.protocol !== "https:") return;
      localStorage.setItem(HOME_URL_KEY, r.origin);
    } catch (e) {}
  })();

  function getHomeUrl() {
    try {
      const v = localStorage.getItem(HOME_URL_KEY);
      if (v && /^https?:\/\//i.test(v)) return v;
    } catch (e) {}
    return null;
  }

  function backToHome() {
    const url = getHomeUrl();
    if (!url) {
      layer.msg("未识别到首页地址，请从用户中心重新进入｜Home URL unavailable, please re-enter from user center", { time: 3500 });
      return;
    }
    window.location.href = url;
  }

  // ==================== 工具函数（自带一份，不共享） ====================
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
      if (timeout > 0) setTimeout(() => remove(id), timeout);
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

    function close(id) { remove(id); }
    function closeAll() { Array.from(active.keys()).forEach(remove); }

    function confirm(message, _opts, yes) {
      if (window.confirm(plainText(message)) && typeof yes === "function") yes();
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
          if (event.target === shade) close(id);
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
    const blob = new Blob([content], { type: mimeType || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function stripProxyDomainPrefix(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return segments;
    const first = segments[0] || "";
    if (first.indexOf(".") > 0 && /^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(first)) {
      return segments.slice(1);
    }
    return segments;
  }

  function parseConversationPath() {
    const pathname = location.pathname.replace(/\/+$/, "");
    const segments = stripProxyDomainPrefix(pathname.split("/").filter(Boolean));
    if (segments.length === 0) return null;

    let basePrefix = "", userIndex = null, offset = 0;
    if (segments[0] === "u" && /^\d+$/.test(segments[1] || "")) {
      userIndex = segments[1];
      basePrefix = "/u/" + userIndex;
      offset = 2;
    }
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

  // ==================== 主题管理 ====================
  function applyTheme() {
    if (!document.body) return;
    const THEME_KEY = "Bard-Color-Theme";
    const theme = localStorage.getItem(THEME_KEY) || "";
    document.body.classList.remove("light-theme", "dark-theme");
    if (theme === "Bard-Light-Theme") document.body.classList.add("light-theme");
    else document.body.classList.add("dark-theme");
  }

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

  // ==================== 释放配额 / 网关请求 / 换车 / 返回选车 ====================
  function releaseQuotaAndGoHome() {
    fetch("/frontend-api/releaseGeminiFleetQuota")
      .then((res) => res.json())
      .then(() => { window.location.href = themeBaseUrl; })
      .catch(() => { window.location.href = themeBaseUrl; });
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
        if (err.status === 401) { window.location.href = "/login"; return; }
        if (err.status === 409) { window.location.href = "/select"; return; }
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
        if (err.status === 401) { window.location.href = "/login"; return; }
        layer.msg(err.message || "返回选车失败", { time: 3000, icon: 2 });
      });
  }

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
        '\n      <div style="padding: 32px 40px; background: #fff; border-radius: 16px;">\n        <div style="text-align: center; margin-bottom: 28px;">\n          <p style="font-size: 18px; color: #1a1a1a; margin: 0; font-weight: 600;">选择导出格式</p>\n          <p style="font-size: 13px; color: #888; margin-top: 8px;">选择适合您需求的格式下载对话内容</p>\n        </div>\n        <div style="display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; max-width: 340px; margin: 0 auto;">\n          <div style="text-align: center; flex: 0 0 calc(50% - 8px);">\n            <button class="layui-btn layui-btn-lg" style="width: 100%; height: 90px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: none; background: #f5f7fa; color: #333; border-radius: 12px; box-shadow: none; transition: all 0.2s ease;"\n                    onmouseover="this.style.background=\'#e8f4ff\'; this.style.transform=\'translateY(-2px)\';"\n                    onmouseout="this.style.background=\'#f5f7fa\'; this.style.transform=\'translateY(0)\';"\n                    onclick="downloadConversation(\'md\')">\n              <i class="layui-icon layui-icon-file-b" style="font-size: 32px; color: #1890ff; margin-top: 4px; margin-bottom: -6px;"></i>\n              <span style="font-size: 13px; font-weight: 500;">Markdown</span>\n            </button>\n            <p style="font-size: 11px; color: #999; margin-top: 8px;">原始格式，支持再次编辑</p>\n          </div>\n          <div style="text-align: center; flex: 0 0 calc(50% - 8px);">\n            <button class="layui-btn layui-btn-lg" style="width: 100%; height: 90px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: none; background: #f5f7fa; color: #333; border-radius: 12px; box-shadow: none; transition: all 0.2s ease;"\n                    onmouseover="this.style.background=\'#fff5f2\'; this.style.transform=\'translateY(-2px)\';"\n                    onmouseout="this.style.background=\'#f5f7fa\'; this.style.transform=\'translateY(0)\';"\n                    onclick="downloadConversation(\'pdf\')">\n              <i class="layui-icon layui-icon-file" style="font-size: 32px; color: #ff5722; margin-top: 4px; margin-bottom: -6px;"></i>\n              <span style="font-size: 13px; font-weight: 500;">PDF</span>\n            </button>\n            <p style="font-size: 11px; color: #999; margin-top: 8px;">便于分享和打印阅读</p>\n          </div>\n        </div>\n      </div>\n    ',
      area: ["600px", "auto"],
      shade: 0.4,
      shadeClose: true,
      closeBtn: 1,
      anim: 0,
      skin: "layer-export-dialog-flat",
    });
  }

  // ==================== 创建径向快捷菜单 ====================
  function ensureRadialMenu() {
    if (!document.querySelector(".radial-menu-container")) createRadialMenu();
  }

  function createRadialMenu() {
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

    let touchStarted = false;
    triggerBtn.addEventListener("touchstart", (e) => { touchStarted = true; e.stopPropagation(); }, { passive: true });
    triggerBtn.addEventListener("touchend", (e) => {
      if (touchStarted) { touchStarted = false; e.stopPropagation(); e.preventDefault(); toggleMenu(); }
    }, { passive: false });

    backdrop.addEventListener("click", () => { if (isOpen) toggleMenu(); });
    backdrop.addEventListener("touchend", (e) => {
      if (isOpen) { e.preventDefault(); toggleMenu(); }
    }, { passive: false });

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
      {
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
        tooltip: "返回首页｜Back to Home",
        onClick: () => backToHome(),
      },
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

    enableDrag(container, triggerBtn);
    document.body.appendChild(container);
  }

  // ==================== 菜单拖拽 ====================
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

    const saved = localStorage.getItem("radial-menu-position");
    if (saved)
      try {
        const pos = JSON.parse(saved);
        container.style.right = pos.right + "px";
        container.style.bottom = pos.bottom + "px";
      } catch (e) {}
  }

  // ==================== 导出实现 ====================
  function processMarkdown(content) { return content; }

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
    }
  }

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
            if (res.status === 401) { window.location.href = "/login"; return; }
            if (res.status === 404) { layer.msg("本地未找到该对话｜Not found locally"); return; }
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

  async function exportAsMarkdown() {
    const convInfo = parseConversationPath();
    if (!convInfo || !convInfo.convId)
      return layer.msg("当前未在对话页面｜Not conversation page"), null;
    const convData = await getConversationContent();
    if (!convData) return;
    const filename = convData.title + "_" + new Date().Format("yyyy-MM-dd HH:mm:ss") + ".md";
    downloadTextAsFile(convData.content, filename, "text/markdown");
  }

  // 暴露给 core.js 的 autoExportAndLeave 调用
  window.downloadConversation = downloadConversation;

  // ==================== 启动 ====================
  function startListUI() {
    applyTheme();
    ensureRadialMenu();
    setInterval(ensureRadialMenu, 100);
  }

  function whenBodyReady(fn) {
    if (document.body) { fn(); return; }
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  whenBodyReady(startListUI);
})();
