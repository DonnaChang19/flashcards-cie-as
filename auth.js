// ============================================================
// AuthGate：Key 登录 / 首次激活 / 设备绑定
// Phase 2 使用：先弹出登录层，校验通过后才显示原有闪卡界面。
// 设计原则：Supabase 不可用时自动降级为本地模式，不影响现有功能。
// ============================================================

(function() {
  'use strict';

  const AUTH_SESSION_KEY = '__flash_session_v1';
  const DEVICE_ID_KEY = '__flash_device_id';

  const AuthGate = {
    deck: null,
    onSuccess: null,
    loginModal: null,

    // 设备指纹：根据浏览器特征确定性计算（不依赖 localStorage）
    // 这样清除浏览器缓存 / 重装后指纹不变，仍能识别为同一设备；
    // 只有真正更换浏览器 / 设备才会变，触发“新设备”拒绝。
    getDeviceFp() {
      try {
        const parts = [
          navigator.userAgent || '',
          navigator.language || '',
          (typeof screen !== 'undefined') ? (screen.width + 'x' + screen.height + 'x' + (screen.colorDepth || 0)) : '',
          (typeof Intl !== 'undefined' && Intl.DateTimeFormat) ? (Intl.DateTimeFormat().resolvedOptions().timeZone || '') : '',
          (navigator.hardwareConcurrency || ''),
          (navigator.platform || '')
        ];
        let canvasSig = '';
        try {
          const c = document.createElement('canvas');
          const ctx = c.getContext('2d');
          ctx.textBaseline = 'top';
          ctx.font = '14px Arial';
          ctx.fillStyle = '#f60';
          ctx.fillText('flashcard-fp', 2, 2);
          canvasSig = c.toDataURL().slice(-40);
        } catch (e) {}
        const raw = parts.join('|') + '|' + canvasSig;
        let h = 0;
        for (let i = 0; i < raw.length; i++) {
          h = (h * 31 + raw.charCodeAt(i)) >>> 0;
        }
        return 'fp-' + h.toString(36);
      } catch (e) {
        return 'fp-fallback';
      }
    },

    getDeviceInfo() {
      try {
        return JSON.stringify({
          ua: navigator.userAgent,
          lang: navigator.language,
          screen: (typeof screen !== 'undefined') ? (screen.width + 'x' + screen.height) : 'unknown',
          platform: navigator.platform || 'unknown'
        });
      } catch(e) {
        return '{}';
      }
    },

    // 保存/读取登录会话
    saveSession(userId, key, studentName) {
      try {
        localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
          userId, key, studentName,
          deck: this.deck,
          loginAt: Date.now()
        }));
      } catch(e) {}
    },

    loadSession() {
      try {
        const raw = localStorage.getItem(AUTH_SESSION_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        return (s && s.deck === this.deck) ? s : null;
      } catch(e) { return null; }
    },

    clearSession() {
      try { localStorage.removeItem(AUTH_SESSION_KEY); } catch(e) {}
    },

    // 在页面顶部注入登录浮层
    injectModal() {
      if (this.loginModal) return;
      const wrap = document.createElement('div');
      wrap.id = 'authGateModal';
      wrap.innerHTML = `
        <div class="auth-backdrop"></div>
        <div class="auth-card">
          <h2>🔐 学习 Key 登录</h2>
          <p class="auth-desc">请输入老师分配的 Key 开始学习。每个 Key 首次登录后会绑定当前浏览器，换设备/浏览器需重新申请 Key。</p>
          <div class="auth-form">
            <input type="text" id="authKeyInput" placeholder="例如：ABC123" autocomplete="off" />
            <input type="text" id="authNameInput" placeholder="你的名字（可选，用于老师后台识别）" autocomplete="off" />
            <button id="authLoginBtn" class="btn primary">进入学习</button>
          </div>
          <div id="authError" class="auth-error" style="display:none"></div>
          <div class="auth-hint">老师后台可查看学习进度、完成率与高频错词。<br>🎁 <b>免费试用</b>仅开放每套的第一章节，复习功能需解锁。</div>
          <div class="auth-local" style="margin-top:12px;text-align:center;">
            <button id="authLocalBtn" class="btn ghost small">🎁 免费试用（仅开放第一章节）</button>
          </div>
        </div>
      `;
      document.body.insertBefore(wrap, document.body.firstChild);
      this.loginModal = wrap;

      // 绑定事件
      const btn = document.getElementById('authLoginBtn');
      const input = document.getElementById('authKeyInput');
      const nameInput = document.getElementById('authNameInput');
      const err = document.getElementById('authError');
      const localBtn = document.getElementById('authLocalBtn');

      const doLogin = () => this.handleLogin(input.value.trim(), nameInput.value.trim(), err);
      btn.onclick = doLogin;
      input.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
      nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
      localBtn.onclick = () => this.enterLocalMode();

      // 注入样式
      if (!document.getElementById('authGateStyles')) {
        const style = document.createElement('style');
        style.id = 'authGateStyles';
        style.textContent = `
          #authGateModal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
          .auth-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px)}
          .auth-card{position:relative;background:#fff;padding:28px 26px;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);width:min(420px,92vw);max-width:100%}
          .auth-card h2{margin:0 0 8px;font-size:22px;color:#1f2937}
          .auth-desc{color:#6b7280;font-size:14px;line-height:1.5;margin:0 0 18px}
          .auth-form{display:flex;flex-direction:column;gap:12px}
          .auth-form input{padding:12px 14px;border:1px solid #d1d5db;border-radius:10px;font-size:15px;outline:none}
          .auth-form input:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.12)}
          .auth-form .btn{width:100%;padding:12px;font-size:16px;border:none;border-radius:10px;cursor:pointer;font-weight:600}
          .auth-form .btn.primary{background:#4f46e5;color:#fff}
          .auth-form .btn.primary:hover{background:#4338ca}
          .auth-form .btn.ghost{background:transparent;color:#6b7280;border:1px solid #e5e7eb}
          .auth-form .btn.ghost:hover{background:#f9fafb}
          .auth-form .btn.small{padding:8px 12px;font-size:13px}
          .auth-error{color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;font-size:13px;margin-top:12px}
          .auth-hint{color:#9ca3af;font-size:12px;text-align:center;margin-top:14px}
          .auth-local button{background:transparent;border:none;color:#6b7280;font-size:13px;cursor:pointer;text-decoration:underline}
          .auth-local button:hover{color:#4f46e5}
          @media (prefers-color-scheme: dark){
            .auth-card{background:#1f2937}
            .auth-card h2{color:#f9fafb}
            .auth-desc,.auth-hint,.auth-local button{color:#9ca3af}
            .auth-form input{background:#111827;color:#f9fafb;border-color:#374151}
            .auth-form input:focus{border-color:#818cf8;box-shadow:0 0 0 3px rgba(129,140,248,.15)}
            .auth-error{color:#fca5a5;background:#450a0a;border-color:#7f1d1d}
          }
        `;
        document.head.appendChild(style);
      }
    },

    showError(msg) {
      const el = document.getElementById('authError');
      if (!el) return;
      el.textContent = msg;
      el.style.display = '';
    },

    hideModal() {
      if (this.loginModal) this.loginModal.style.display = 'none';
    },

    // 进入免费试用模式（仅开放第一章节）
    enterLocalMode() {
      window.__TRIAL__ = true;
      this.hideModal();
      if (typeof toast === 'function') toast('试用模式：仅开放第一章节，进度仅存本机');
      if (typeof window.startTrialObserver === 'function') window.startTrialObserver();
      if (this.onSuccess) this.onSuccess({ localOnly: true, trialMode: true });
    },

    // 处理登录按钮
    async handleLogin(key, name, errEl) {
      errEl.style.display = 'none';
      if (!key) {
        this.showError('请输入 Key');
        return;
      }
      const btn = document.getElementById('authLoginBtn');
      const originalText = btn.textContent;
      btn.textContent = '校验中...';
      btn.disabled = true;

      try {
        // 1. 匿名登录获取 uid
        const signInRes = await CloudStore.signInAnonymously();
        if (signInRes.error) throw new Error('匿名登录失败：' + signInRes.error.message);

        // 2. RPC 校验 key 与设备
        const deviceFp = this.getDeviceFp();
        const deviceInfo = this.getDeviceInfo();
        const result = await CloudStore.loginOrActivate(key, deviceFp, deviceInfo);

        if (result.action === 'denied') {
          await CloudStore.signOut();
          this.showError(result.message || '该 Key 已在其他设备激活，不能重复使用。');
          return;
        }
        if (result.action === 'error') {
          await CloudStore.signOut();
          this.showError(result.message || '登录失败，请检查网络或 Key。');
          return;
        }

        // 3. 成功：保存会话、更新 CloudStore、进入主界面
        const user = result.user || {};
        const userId = user.id || (signInRes.data && signInRes.data.user && signInRes.data.user.id);
        const studentName = name || user.student_name || null;

        // 如果用户填写了名字且数据库里没有，顺便更新
        if (name && user.id && !user.student_name) {
          try {
            await CloudStore.sb.from('users').update({ student_name: name }).eq('id', user.id);
          } catch(e) {}
        }

        this.saveSession(userId, key, studentName);
        CloudStore.setUser(userId, key, studentName);
        this.updateHeaderUser(key, studentName);
        this.hideModal();
        if (typeof toast === 'function') toast('登录成功，开始学习！');
        if (this.onSuccess) this.onSuccess({ userId, key, studentName });

      } catch(err) {
        console.error('[AuthGate] login error', err);
        this.showError('网络或服务器错误：' + (err.message || '请稍后再试'));
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    },

    // 在页面顶部显示当前登录用户
    updateHeaderUser(key, name) {
      if (!key) return;
      const header = document.querySelector('header.top');
      if (!header) return;
      let el = document.getElementById('authUserPill');
      if (!el) {
        el = document.createElement('div');
        el.id = 'authUserPill';
        el.className = 'pill';
        el.style.marginLeft = 'auto';
        const toprow = header.querySelector('.toprow');
        if (toprow) toprow.appendChild(el);
      }
      el.textContent = '👤 ' + (name ? `${name} · ` : '') + key;
      el.title = '已登录，进度会自动同步';
    },

    // 入口：启动时检查登录态
    async start(options) {
      options = options || {};
      this.deck = options.deck || window.DECK_SLUG || null;
      this.onSuccess = options.onSuccess || null;

      if (!this.deck) {
        console.error('[AuthGate] DECK_SLUG not set');
        if (this.onSuccess) this.onSuccess({ localOnly: true });
        return;
      }

      CloudStore.init(this.deck);

      // 未启用 Supabase 或 SDK 加载失败 → 本地模式
      if (!CloudStore.enabled || !CloudStore.sb) {
        console.info('[AuthGate] Supabase not available, entering restricted trial mode.');
        window.__TRIAL__ = true;
        if (typeof window.startTrialObserver === 'function') window.startTrialObserver();
        if (this.onSuccess) this.onSuccess({ localOnly: true, trialMode: true });
        return;
      }

      // 尝试恢复已有 Supabase 匿名会话
      const { data: sessionData, error: sessionError } = await CloudStore.getSession();
      const saved = this.loadSession();

      if (sessionData && sessionData.session && saved && saved.userId) {
        // 会话有效且本地有记录 → 直接进
        CloudStore.setUser(saved.userId, saved.key, saved.studentName);
        this.updateHeaderUser(saved.key, saved.studentName);
        if (this.onSuccess) this.onSuccess({ userId: saved.userId, key: saved.key, studentName: saved.studentName });
        return;
      }

      // 没有有效会话 → 显示登录层
      this.injectModal();
    }
  };

  // 暴露到全局
  if (typeof window !== 'undefined') {
    window.AuthGate = AuthGate;
  }
})();
