/**
 * @local/dsh-session-hub — Host half.
 * Folds the whole session corpus (live + persisted) into five sections and
 * serves the snapshot to the Client half over exact Fetch routes under /api.
 * Favorites and seen marks are per-machine state in ~/.dsh-session-hub/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHANNEL = '/dsh-session-hub';
const ENDPOINTS = { summary: 'summary', star: 'star', seen: 'seen' };

const USER_TOOLS = new Set(['ask_user_question', 'exit_plan_mode', 'ui_present']);
const RECENT_CAP = 10;
const REVIEW_CAP = 30;
const READ_CONCURRENCY = 4;
const TIME_BUDGET_MS = 2500;

const STORE_DIR = path.join(os.homedir(), '.dsh-session-hub');

function loadStore(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(STORE_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

function saveStore(name, value) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STORE_DIR, name), JSON.stringify(value));
  } catch {
    /* keep running without persistence */
  }
}

/** id -> { mtimeMs, size } for every persisted session log on disk. */
function scanSessionFiles() {
  const map = new Map();
  const root = path.join(os.homedir(), '.dsh', 'sessions');
  let workspaces = [];
  try {
    workspaces = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return map;
  }
  for (const ws of workspaces) {
    if (!ws.isDirectory()) continue;
    const wsDir = path.join(root, ws.name);
    let sessions = [];
    try {
      sessions = fs.readdirSync(wsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory() || !session.name.startsWith('session-')) continue;
      const file = path.join(wsDir, session.name, 'session.v4.jsonl.zstd');
      try {
        const stat = fs.statSync(file);
        map.set(session.name, { mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        /* removed mid-scan */
      }
    }
  }
  return map;
}

/** Fold one session's event list into { title, lastTime, state } display state. */
export function foldTail(events) {
  let title;
  let openTurn = null;
  let lastTime = 0;
  const openCalls = new Map();
  let firstUserText = '';
  for (const event of Array.isArray(events) ? events : []) {
    if (typeof event?.time === 'number' && event.time > lastTime) lastTime = event.time;
    switch (event?.type) {
      case 'user/message': {
        if (firstUserText === '') {
          const blocks = event.data?.content;
          const text = Array.isArray(blocks) ? blocks.find((part) => part?.type === 'text')?.text : undefined;
          if (typeof text === 'string' && !text.startsWith('<system-reminder') && !text.startsWith('<compacted-summary')) {
            firstUserText = text.replace(/\s+/g, ' ').trim().slice(0, 40);
          }
        }
        break;
      }
      case 'session/title':
        if (typeof event.data?.title === 'string' && event.data.title) title = event.data.title;
        break;
      case 'turn/start':
        openTurn = event.data?.turn;
        break;
      case 'turn/end':
        openTurn = null;
        break;
      case 'tool/call':
        if (typeof event.data?.callId === 'string') {
          openCalls.set(event.data.callId, { name: event.data?.name, turn: event.data?.turn });
        }
        break;
      case 'tool/result': {
        const callId = event.data?.message?.toolCallId;
        if (typeof callId === 'string') openCalls.delete(callId);
        break;
      }
    }
  }
  if ((title === undefined || title === '') && firstUserText !== '') title = firstUserText;
  let state = 'idle';
  if (openTurn !== null && openTurn !== undefined) {
    const waiting = [...openCalls.values()].some((call) => call.turn === openTurn && USER_TOOLS.has(call.name));
    state = waiting ? 'waiting' : 'running';
  }
  return { title, lastTime, state };
}

export const inject = ['sessionQuery', 'connection'];

export function apply(ctx) {
  const favorites = loadStore('favorites.json', {});
  const seen = loadStore('seen.json', {});
  const cache = loadStore('titles.json', {});
  const liveCache = new Map();
  const queue = [];
  let lastDisk = new Map();
  let draining = false;

  async function drain() {
    if (draining || queue.length === 0) return;
    draining = true;
    const deadline = Date.now() + TIME_BUDGET_MS;
    try {
      const worker = async () => {
        while (queue.length > 0 && Date.now() < deadline) {
          const id = queue.shift();
          const disk = lastDisk.get(id) ?? { mtimeMs: 0, size: 0 };
          try {
            const snapshot = await ctx.sessionQuery.readSession(id);
            const fold = foldTail(snapshot?.events);
            cache[id] = { title: fold.title ?? '', lastTime: fold.lastTime, mtimeMs: disk.mtimeMs, size: disk.size };
          } catch {
            cache[id] = { ...(cache[id] ?? { title: '', lastTime: 0 }), mtimeMs: -1, size: 0 };
          }
        }
      };
      await Promise.all(Array.from({ length: READ_CONCURRENCY }, () => worker()));
    } finally {
      draining = false;
      saveStore('titles.json', cache);
    }
  }

  async function summarize() {
    let listed = [];
    try {
      listed = await ctx.sessionQuery.listSessions();
    } catch {
      listed = [];
    }
    lastDisk = scanSessionFiles();
    const items = [];
    const liveIds = [];
    const now = Date.now();
    for (const record of Array.isArray(listed) ? listed : []) {
      const header = record?.header ?? {};
      const id = header?.id;
      if (typeof id !== 'string' || id === '') continue;
      if (header.origin === 'subagent' || typeof header.parentSession === 'string') continue;
      const base = {
        id,
        cwd: typeof header.cwd === 'string' ? header.cwd : '',
        createdAt: typeof header.createdAt === 'number' ? header.createdAt : 0,
        live: record.live === true,
        favorite: Boolean(favorites[id])
      };
      if (base.live) {
        const disk = lastDisk.get(id);
        const lc = liveCache.get(id);
        if (lc !== undefined && disk !== undefined && lc.mtimeMs === disk.mtimeMs && lc.size === disk.size) {
          items.push({ ...base, title: lc.fold.title ?? '', lastTime: lc.fold.lastTime || now, state: lc.fold.state });
        } else {
          liveIds.push({ id, base });
        }
        continue;
      }
      const disk = lastDisk.get(id);
      const cached = cache[id];
      if (cached && disk && cached.mtimeMs === disk.mtimeMs && cached.size === disk.size) {
        items.push({
          ...base,
          title: cached.title ?? '',
          lastTime: Math.max(cached.lastTime || 0, disk.mtimeMs),
          state: 'idle'
        });
        continue;
      }
      items.push({
        ...base,
        title: cached?.title ?? '',
        lastTime: Math.max(cached?.lastTime ?? 0, disk?.mtimeMs ?? 0, base.createdAt),
        state: 'idle'
      });
      queue.push(id);
    }
    if (liveIds.length > 0) {
      await Promise.all(liveIds.map(async (entry) => {
        let fold = { title: '', lastTime: now, state: 'running' };
        try {
          const snapshot = await ctx.sessionQuery.readSession(entry.id);
          fold = foldTail(snapshot?.events);
        } catch {
          /* keep the running fallback */
        }
        const disk = lastDisk.get(entry.id);
        if (disk !== undefined) liveCache.set(entry.id, { mtimeMs: disk.mtimeMs, size: disk.size, fold });
        items.push({ ...entry.base, title: fold.title ?? '', lastTime: fold.lastTime || now, state: fold.state });
      }));
    }
    drain();
    for (const item of items) {
      const fresh = cache[item.id];
      if (!fresh) continue;
      item.title = fresh.title || item.title;
      item.lastTime = Math.max(item.lastTime, fresh.lastTime || 0);
    }

    const waiting = [];
    const running = [];
    const review = [];
    const rest = [];
    for (const item of items) {
      if (item.state === 'waiting') waiting.push(item);
      else if (item.state === 'running') running.push(item);
      else if (!item.live && item.lastTime > (seen[item.id] ?? 0)) review.push(item);
      else rest.push(item);
    }
    review.sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));
    for (const overflow of review.slice(REVIEW_CAP)) rest.push(overflow);
    const favoritesList = items
      .filter((item) => item.favorite)
      .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));
    const recent = rest
      .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0))
      .slice(0, RECENT_CAP);
    return {
      sections: {
        waiting,
        running,
        review: review.slice(0, REVIEW_CAP),
        favorites: favoritesList,
        recent
      },
      updatedAt: now
    };
  }

  function envelope(handler) {
    return async (request) => {
      let result;
      try {
        result = { ok: true, value: await handler(request) };
      } catch (error) {
        result = { ok: false, error: { message: error instanceof Error ? error.message : String(error) } };
      }
      return new Response(JSON.stringify(result), {
        status: result.ok === true ? 200 : 500,
        headers: { 'content-type': 'application/json' }
      });
    };
  }

  async function readBody(request) {
    try {
      const body = await request.json();
      return body === null || typeof body !== 'object' ? {} : body;
    } catch {
      return {};
    }
  }

  ctx.connection.fetch.register({
    path: `/api${CHANNEL}/${ENDPOINTS.summary}`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: envelope(async () => summarize())
  });
  ctx.connection.fetch.register({
    path: `/api${CHANNEL}/${ENDPOINTS.star}`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: envelope(async (request) => {
      const body = await readBody(request);
      const id = typeof body.id === 'string' ? body.id : '';
      if (id === '') throw new Error('star: 缺少会话 id');
      if (body.on === true) favorites[id] = { at: Date.now() };
      else delete favorites[id];
      saveStore('favorites.json', favorites);
      return { ok: true };
    })
  });
  ctx.connection.fetch.register({
    path: `/api${CHANNEL}/${ENDPOINTS.seen}`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: envelope(async (request) => {
      const body = await readBody(request);
      const id = typeof body.id === 'string' ? body.id : '';
      if (id === '') throw new Error('seen: 缺少会话 id');
      seen[id] = Date.now();
      saveStore('seen.json', seen);
      return { ok: true };
    })
  });

}
