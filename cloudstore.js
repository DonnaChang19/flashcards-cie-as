// ============================================================
// CloudStore：Supabase 客户端封装 + 云端数据读写接口
// Phase 2 仅负责初始化与登录相关 RPC；Phase 3 扩展进度同步。
// 设计原则：始终保留 localStorage 兜底，没网/没配置时整套应用仍可运行。
// ============================================================

(function() {
  'use strict';

  const CloudStore = {
    // 配置
    enabled: (typeof SUPABASE_ENABLED !== 'undefined' ? SUPABASE_ENABLED : true)
             && typeof window !== 'undefined'
             && typeof SUPABASE_URL !== 'undefined'
             && typeof SUPABASE_ANON_KEY !== 'undefined',

    // Supabase 客户端实例
    sb: null,

    // 当前学习套册 slug，由页面初始化时传入
    deck: null,

    // 当前用户信息
    userId: null,
    userKey: null,
    studentName: null,

    // 初始化客户端
    init(deckSlug) {
      this.deck = deckSlug || null;

      if (!this.enabled) {
        console.info('[CloudStore] Supabase disabled; running in local-only mode.');
        return false;
      }

      if (typeof supabase === 'undefined' || !supabase.createClient) {
        console.warn('[CloudStore] supabase-js SDK not loaded; falling back to local-only mode.');
        this.enabled = false;
        return false;
      }

      try {
        this.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false
          }
        });
        console.info('[CloudStore] Supabase client initialized for deck:', this.deck);
        return true;
      } catch (err) {
        console.error('[CloudStore] Failed to create Supabase client:', err);
        this.enabled = false;
        return false;
      }
    },

    // 设置当前登录用户
    setUser(userId, userKey, studentName) {
      this.userId = userId || null;
      this.userKey = userKey || null;
      this.studentName = studentName || null;
    },

    // 是否已准备好进行云端读写
    isReady() {
      return this.enabled && this.sb && this.userId && this.deck;
    },

    // 当前是否处于仅本地模式
    isLocalOnly() {
      return !this.enabled || !this.sb || !this.userId;
    },

    // --- Phase 2：登录 / 激活 RPC ---

    // 获取当前匿名会话（如没有则返回 null）
    async getSession() {
      if (!this.sb) return { data: { session: null }, error: new Error('sb not initialized') };
      return this.sb.auth.getSession();
    },

    // 匿名登录
    async signInAnonymously() {
      if (!this.sb) return { data: { user: null, session: null }, error: new Error('sb not initialized') };
      return this.sb.auth.signInAnonymously();
    },

    // 退出登录
    async signOut() {
      if (!this.sb) return { error: null };
      return this.sb.auth.signOut();
    },

    // Key 校验 / 首次激活 / 设备绑定
    // 返回 { action: 'activated' | 'logged_in' | 'denied', user, reason? }
    async loginOrActivate(key, deviceFp, deviceInfo) {
      if (!this.sb) {
        return { action: 'error', reason: 'not_initialized', message: 'Supabase 未初始化' };
      }
      const { data, error } = await this.sb.rpc('login_or_activate', {
        p_key: key,
        p_device_fp: deviceFp,
        p_device_info: deviceInfo,
        p_deck: this.deck
      });
      if (error) {
        console.error('[CloudStore] login_or_activate RPC error:', error);
        return { action: 'error', reason: 'rpc_error', message: error.message || '服务器校验失败' };
      }
      return data;
    },

    // --- Phase 3：进度同步接口 ---
    // kind: 'word'（单词卡进度）| 'cloze'（挖空卡进度），用于区分同一卡片的两套进度

    // 从云端拉取某套某类全部进度，返回 { card_id: { state, S, D, reps, lapses, last, due } }
    async pullProgress(deckSlug, kind) {
      if (!this.isReady()) return {};
      const slug = deckSlug || this.deck;
      const k = kind || 'word';
      const { data, error } = await this.sb
        .from('progress')
        .select('card_id, status, wrong_count, last_review, due, s, d, reps')
        .eq('user_id', this.userId)
        .eq('deck', slug)
        .eq('kind', k);
      if (error) {
        console.error('[CloudStore] pullProgress error:', error);
        throw error;
      }
      const out = {};
      (data || []).forEach(row => {
        out[row.card_id] = {
          state: row.status,
          S: row.s,
          D: row.d,
          reps: row.reps,
          lapses: row.wrong_count,
          last: row.last_review,
          due: row.due
        };
      });
      return out;
    },

    // 把本地 PROG 对象整体推送/同步到云端（指定 kind）
    async pushProgress(progObj, deckSlug, kind) {
      if (!this.isReady()) return { error: new Error('not ready') };
      const slug = deckSlug || this.deck;
      const k = kind || 'word';
      const rows = Object.entries(progObj || {}).map(([cardId, p]) => ({
        user_id: this.userId,
        deck: slug,
        card_id: cardId,
        kind: k,
        status: p.state || 'new',
        wrong_count: typeof p.lapses === 'number' ? p.lapses : 0,
        last_review: p.last || null,
        due: p.due || null,
        s: typeof p.S === 'number' ? p.S : null,
        d: typeof p.D === 'number' ? p.D : null,
        reps: typeof p.reps === 'number' ? p.reps : 0,
        updated_at: new Date().toISOString()
      }));
      if (!rows.length) return { data: [], error: null };
      const { data, error } = await this.sb.from('progress').upsert(rows, {
        onConflict: 'user_id, deck, card_id, kind'
      });
      if (error) {
        console.error('[CloudStore] pushProgress error:', error);
        throw error;
      }
      return { data, error: null };
    },

    // 拉取打卡日期与每日学习次数。两者不属于单卡进度，单独存入 client_state。
    async pullClientState(deckSlug) {
      if (!this.isReady()) return null;
      const slug = deckSlug || this.deck;
      const { data, error } = await this.sb
        .from('client_state')
        .select('checkins, stats')
        .eq('user_id', this.userId)
        .eq('deck', slug)
        .maybeSingle();
      if (error) {
        console.error('[CloudStore] pullClientState error:', error);
        throw error;
      }
      return data || null;
    },

    async pushClientState(checkins, stats, deckSlug) {
      if (!this.isReady()) return { error: new Error('not ready') };
      const slug = deckSlug || this.deck;
      const row = {
        user_id: this.userId,
        deck: slug,
        checkins: Array.isArray(checkins) ? checkins : [],
        stats: stats && typeof stats === 'object' ? stats : {},
        updated_at: new Date().toISOString()
      };
      const { data, error } = await this.sb.from('client_state').upsert(row, {
        onConflict: 'user_id, deck'
      });
      if (error) {
        console.error('[CloudStore] pushClientState error:', error);
        throw error;
      }
      return { data, error: null };
    },

    async clearDeckData(deckSlug) {
      if (!this.isReady()) return { error: new Error('not ready') };
      const slug = deckSlug || this.deck;
      const progressResult = await this.sb.from('progress')
        .delete().eq('user_id', this.userId).eq('deck', slug);
      if (progressResult.error) throw progressResult.error;
      const stateResult = await this.sb.from('client_state')
        .delete().eq('user_id', this.userId).eq('deck', slug);
      if (stateResult.error) throw stateResult.error;
      return { error: null };
    }
  };

  // 暴露到全局
  if (typeof window !== 'undefined') {
    window.CloudStore = CloudStore;
  }
})();
