window.__ModuleLoader__.load({
  id: '@local/dsh-session-hub',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;

    const CHANNEL = '/dsh-session-hub';
    const NS = 'dsh-session-hub';
    const REFRESH_MS = 10_000;
    const CSS_ID = '@local/dsh-session-hub/tab.css';

    const zh = {
      tab: '会话中心',
      'section.waiting': '等你回答',
      'section.running': '正在跑',
      'section.favorites': '收藏',
      'section.recent': '最近',
      'state.waiting': '等你回答',
      'empty.waiting': '没有在等你的会话。',
      'empty.running': '当前没有正在运行的会话。',
      'empty.favorites': '点条目上的星标即可收藏。',
      'empty.recent': '还没有会话。',
      'meta.untitled': '未命名会话'
    };
    const en = {
      tab: 'Session Hub',
      'section.waiting': 'Waiting for you',
      'section.running': 'Running',
      'section.favorites': 'Starred',
      'section.recent': 'Recent',
      'state.waiting': 'waiting',
      'empty.waiting': 'Nothing is waiting on you.',
      'empty.running': 'No sessions are running right now.',
      'empty.favorites': 'Star a session to pin it here.',
      'empty.recent': 'No sessions yet.',
      'meta.untitled': 'Untitled session'
    };

    injectCss(CSS_ID, `
      .dsh-hub { display: flex; flex-direction: column; gap: 14px; padding: 18px 26px 44px; overflow-y: auto; height: 100%; box-sizing: border-box; max-width: 820px; }
      .dsh-hub-top { display: flex; align-items: baseline; gap: 10px; padding: 0 4px 2px; }
      .dsh-hub-top-title { font-size: 17px; font-weight: 600; color: var(--dsw-alias-label-primary, #f0f1f3); }
      .dsh-hub-top-sub { font-size: 12px; color: var(--dsw-alias-label-tertiary, #8a8f98); }
      .dsh-hub-section { background: var(--dsw-alias-fill-secondary, rgba(127,127,127,.06)); border: 1px solid var(--dsw-alias-border, rgba(127,127,127,.10)); border-radius: 12px; padding: 10px 12px 8px; }
      .dsh-hub-head { display: flex; align-items: center; gap: 8px; padding: 2px 4px 8px; color: var(--dsw-alias-label-secondary, #9aa0a6); font-size: 12px; font-weight: 600; letter-spacing: .05em; }
      .dsh-hub-count { min-width: 20px; text-align: center; border-radius: 999px; padding: 0 7px; line-height: 17px; background: var(--dsw-alias-fill-tertiary, rgba(127,127,127,.14)); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }
      .dsh-hub-waiting .dsh-hub-count { background: rgba(235, 90, 70, .16); color: #f16a55; }
      .dsh-hub-running .dsh-hub-count { background: rgba(63, 185, 111, .16); color: #4ec27e; }
      .dsh-hub-favorites .dsh-hub-count { background: rgba(232, 163, 61, .16); color: #e8a33d; }
      .dsh-hub-rows { display: flex; flex-direction: column; }
      .dsh-hub-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 9px; cursor: pointer; transition: background .12s ease; }
      .dsh-hub-row:hover { background: var(--dsw-alias-fill-tertiary, rgba(127,127,127,.09)); }
      .dsh-hub-star { flex: none; border: 0; background: transparent; color: var(--dsw-alias-label-tertiary, #7d828a); font-size: 15px; line-height: 1; padding: 2px 4px; border-radius: 5px; cursor: pointer; opacity: .55; transition: opacity .12s ease, color .12s ease; }
      .dsh-hub-row:hover .dsh-hub-star { opacity: 1; }
      .dsh-hub-row.fav .dsh-hub-star { color: #e8a33d; opacity: 1; }
      .dsh-hub-star:hover { color: #e8a33d; }
      .dsh-hub-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
      .dsh-hub-title { color: var(--dsw-alias-label-primary, #e6e8ea); font-size: 13px; font-weight: 500; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsh-hub-row:hover .dsh-hub-title { color: var(--dsw-alias-label-primary, #ffffff); }
      .dsh-hub-meta { color: var(--dsw-alias-label-tertiary, #7d828a); font-size: 11px; display: flex; gap: 7px; align-items: center; }
      .dsh-hub-meta .dsh-hub-cwd { padding: 0 7px; line-height: 16px; background: var(--dsw-alias-fill-tertiary, rgba(127,127,127,.12)); border-radius: 4px; font-size: 10.5px; }
      .dsh-hub-dot { width: 7px; height: 7px; border-radius: 50%; background: #3fb96f; animation: dsh-hub-pulse 1.6s ease-in-out infinite; }
      .dsh-hub-dot.waiting { background: #eb5a46; animation: none; }
      @keyframes dsh-hub-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
      .dsh-hub-badge { flex: none; font-size: 11px; color: #f16a55; background: rgba(235,90,70,.12); border-radius: 999px; padding: 1px 9px; line-height: 17px; }
      .dsh-hub-empty { color: var(--dsw-alias-label-tertiary, #6d7178); font-size: 12px; padding: 6px 10px 10px; }
      .dsh-hub-error { color: #eb5a46; font-size: 12px; padding: 12px; }
    `)

    function injectCss(id, css) {
      if (document.getElementById(id) !== null) return;
      const style = document.createElement('style');
      style.id = id;
      style.textContent = css;
      document.head.appendChild(style);
    }

    async function call(signal, endpoint, body) {
      const response = await fetch(`/api${CHANNEL}/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal
      });
      let envelope;
      try {
        envelope = await response.json();
      } catch {
        throw new Error(`${endpoint}: HTTP ${response.status}`);
      }
      if (envelope === null || typeof envelope !== 'object') throw new Error(`${endpoint}: unexpected response`);
      if (envelope.ok !== true) {
        const detail = envelope.error !== null && typeof envelope.error === 'object' ? envelope.error.message : undefined;
        throw new Error(typeof detail === 'string' ? detail : `${endpoint}: HTTP ${response.status}`);
      }
      return envelope.value;
    }

    function formatTime(ts) {
      if (typeof ts !== 'number' || ts <= 0) return '';
      const delta = Date.now() - ts;
      const minute = 60_000;
      if (delta < minute) return '刚刚';
      if (delta < 60 * minute) return Math.floor(delta / minute) + ' 分钟前';
      if (delta < 24 * 60 * minute) return Math.floor(delta / (60 * minute)) + ' 小时前';
      return Math.floor(delta / (24 * 60 * minute)) + ' 天前';
    }

    function workspaceTail(cwd) {
      if (typeof cwd !== 'string' || cwd === '') return '';
      const parts = cwd.split(/[\\/]/).filter(Boolean);
      return parts[parts.length - 1] ?? cwd;
    }

    function Row(props) {
      const { item, onOpen, onStar } = props;
      const starred = item.favorite === true;
      const classes = ['dsh-hub-row'];
      if (starred) classes.push('fav');
      const onOpenClick = (event) => {
        event.stopPropagation();
        onOpen(item);
      };
      return h('div', { className: classes.join(' '), onClick: () => onOpen(item) }, [
        h('button', {
          key: 'star',
          className: 'dsh-hub-star',
          title: starred ? '取消收藏' : '收藏',
          onClick: onStar
        }, starred ? '★' : '☆'),
        h('div', { className: 'dsh-hub-main' }, [
          h('div', { className: 'dsh-hub-title' }, item.title || '未命名会话'),
          h('div', { className: 'dsh-hub-meta' }, [
            props.live === true && props.state === 'running' ? h('span', { key: 'dot', className: 'dsh-hub-dot' }) : null,
            props.live === true && props.state === 'waiting' ? h('span', { key: 'dotw', className: 'dsh-hub-dot waiting' }) : null,
            h('span', { key: 'time' }, formatTime(item.lastTime)),
            workspaceTail(item.cwd) ? h('span', { key: 'cwd', className: 'dsh-hub-cwd' }, workspaceTail(item.cwd)) : null
          ])
        ]),
        props.state === 'waiting' ? h('span', { key: 'badge', className: 'dsh-hub-badge' }, '等你回答') : null,
      ]);
    }

    function Section(props) {
      const { id, label, items, empty, onOpen, onStar } = props;
      const children = [
        h('div', { key: 'head', className: 'dsh-hub-head' }, [
          h('span', { key: 'label' }, label),
          h('span', { key: 'count', className: 'dsh-hub-count' }, String(items.length))
        ]),
        h('div', { key: 'rows', className: 'dsh-hub-rows' },
          items.length === 0
            ? [h('div', { key: 'empty', className: 'dsh-hub-empty' }, empty)]
            : items.map((item) => h(Row, {
                key: item.id,
                item,
                live: item.live,
                state: item.state,
                onOpen,
                onStar: (event) => { event.stopPropagation(); onStar(item); },
              }))
        )
      ];
      return h('section', { className: 'dsh-hub-group ' + id }, children);
    }

    function SessionHubTab(props) {
      const [data, setData] = useState(null);
      const [error, setError] = useState(null);
      const [busyId, setBusyId] = useState(null);
      const alive = useRef(true);

      const load = useCallback(async (signal) => {
        try {
          const snapshot = await props.request(signal);
          if (!alive.current) return;
          setData(snapshot);
          setError(null);
        } catch (loadError) {
          if (!alive.current || signal?.aborted === true) return;
          setError(String(loadError.message ?? loadError));
        }
      }, [props]);

      useEffect(() => {
        alive.current = true;
        const controller = new AbortController();
        load(controller.signal);
        const timer = window.setInterval(() => load(controller.signal), REFRESH_MS);
        return () => {
          alive.current = false;
          window.clearInterval(timer);
          controller.abort();
        };
      }, [load]);

      const open = useCallback(async (item) => {
                if (props.openSession(item.id) === false) console.warn('[dsh-session-hub] uiWorkspace.openSession 不可用');
      }, [props, data, load]);

      const star = useCallback(async (item) => {
        setBusyId(item.id);
        try {
          await call(undefined, 'star', { id: item.id, on: item.favorite !== true });
          await load(undefined);
        } finally {
          setBusyId(null);
        }
      }, [load]);

      if (error !== null) return h('div', { className: 'dsh-hub' }, h('div', { className: 'dsh-hub-error' }, '加载失败：' + error));
      const sections = data?.sections ?? null;
      if (sections === null) return h('div', { className: 'dsh-hub' }, h('div', { className: 'dsh-hub-empty' }, '加载中…'));
      return h('div', { className: 'dsh-hub' },
        h(Section, { id: 'dsh-hub-waiting', label: '等你回答', items: sections.waiting, empty: '没有在等你的会话。', onOpen: open, onStar: star }),
        h(Section, { id: 'dsh-hub-running', label: '正在跑', items: sections.running, empty: '当前没有正在运行的会话。', onOpen: open, onStar: star }),
        h(Section, { id: 'dsh-hub-favorites', label: '收藏', items: sections.favorites, empty: '点条目上的星标即可收藏。', onOpen: open, onStar: star }),
        h(Section, { id: 'dsh-hub-recent', label: '最近', items: sections.recent, empty: '还没有会话。', onOpen: open, onStar: star })
      );
    }

    const inject = ['slots', 'locale', 'uiWorkspace'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-hub: dictionaries');
      const t = ctx.locale.bind(NS);
      const injected = () => ({
        request: (signal) => call(signal, 'summary', {}),
        openSession: (sessionId) => {
          try {
            const uiWorkspace = ctx.get('uiWorkspace');
            if (uiWorkspace !== null && uiWorkspace !== undefined && typeof uiWorkspace.openSession === 'function') {
              uiWorkspace.openSession(sessionId);
              return true;
            }
          } catch { /* fall through */ }
          return false;
        }
      });
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'session-hub',
        order: 25,
        label: () => t('tab'),
        locale: NS,
        inject: injected
      }, HubIcon));
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'session-hub',
        locale: NS,
        inject: injected
      }, SessionHubTab));
    }

    function HubIcon() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round'
      },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        h('path', { d: 'M3 9h18' }),
        h('path', { d: 'M7 13h6' }),
        h('path', { d: 'M7 16h9' })
      );
    }

    return { inject, apply };
  }
});
