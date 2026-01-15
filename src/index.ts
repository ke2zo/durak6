/// <reference types="@cloudflare/workers-types" />

export interface Env {
  BOT_TOKEN: string
  APP_SECRET: string
  WEBHOOK_SECRET: string
  DB: D1Database
  MM: DurableObjectNamespace
  ROOM: DurableObjectNamespace
}

type Json = any

function json(data: Json, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      ...headers,
    },
  })
}

function ok(data: Json = {}) {
  return json({ ok: true, ...data }, 200)
}

function bad(status: number, message: string, extra?: Json) {
  return json({ ok: false, error: message, ...(extra || {}) }, status)
}

// --------------------- Crypto helpers ---------------------

async function hmacSha256Raw(keyBytes: Uint8Array, data: string): Promise<ArrayBuffer> {
  // Strict ArrayBuffer slice to avoid TS BufferSource overload issues
  const keyBuf = keyBytes.buffer.slice(
    keyBytes.byteOffset,
    keyBytes.byteOffset + keyBytes.byteLength
  ) as ArrayBuffer

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )

  const dataBytes = new TextEncoder().encode(data)
  return crypto.subtle.sign("HMAC", cryptoKey, dataBytes)
}

async function hmacSha256Text(keyText: string, data: string): Promise<ArrayBuffer> {
  return hmacSha256Raw(new TextEncoder().encode(keyText), data)
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function base64urlEncode(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  const b64 = btoa(s)
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function base64urlDecodeToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// --------------------- Telegram initData validation ---------------------

function parseInitData(initData: string): Record<string, string> {
  const p = new URLSearchParams(initData)
  const out: Record<string, string> = {}
  for (const [k, v] of p.entries()) out[k] = v
  return out
}

/**
 * Telegram WebApp initData validation:
 * 1) data_check_string = sorted key=value (except hash) joined by '\n'
 * 2) secret_key bytes = HMAC_SHA256("WebAppData", bot_token)
 * 3) expected_hash = HEX(HMAC_SHA256(secret_key, data_check_string))
 */
async function validateTelegramInitData(
  initData: string,
  botToken: string
): Promise<{ ok: boolean; user?: any; error?: string }> {
  if (!initData) return { ok: false, error: "initData is empty" }
  if (!botToken) return { ok: false, error: "BOT_TOKEN is not set" }

  const data = parseInitData(initData)
  const hash = data["hash"]
  if (!hash) return { ok: false, error: "hash missing" }

  const keys = Object.keys(data)
    .filter((k) => k !== "hash")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  const dataCheckString = keys.map((k) => `${k}=${data[k]}`).join("\n")

  const secretKeyHex = toHex(await hmacSha256Text("WebAppData", botToken))
  const secretKeyBytes = hexToBytes(secretKeyHex)

  const expectedHex = toHex(await hmacSha256Raw(secretKeyBytes, dataCheckString))
  if (expectedHex !== hash) return { ok: false, error: "invalid hash" }

  let user: any
  if (data["user"]) {
    try {
      user = JSON.parse(data["user"])
    } catch {
      user = undefined
    }
  }
  if (!user) return { ok: false, error: "user not found in initData" }

  return { ok: true, user }
}

// --------------------- Session token (signed payload) ---------------------

async function signSession(payload: object, appSecret: string): Promise<string> {
  const body = JSON.stringify(payload)
  const bodyBytes = new TextEncoder().encode(body)
  const bodyB64 = base64urlEncode(bodyBytes)
  const sigHex = toHex(await hmacSha256Text(appSecret, bodyB64))
  return `${bodyB64}.${sigHex}`
}

async function verifySession(token: string, appSecret: string): Promise<any | null> {
  if (!token || !appSecret) return null
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [bodyB64, sigHex] = parts
  const expectedHex = toHex(await hmacSha256Text(appSecret, bodyB64))
  if (expectedHex !== sigHex) return null
  try {
    const bodyBytes = base64urlDecodeToBytes(bodyB64)
    return JSON.parse(new TextDecoder().decode(bodyBytes))
  } catch {
    return null
  }
}

// --------------------- D1 schema & helpers ---------------------

async function ensureSchema(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_id TEXT NOT NULL UNIQUE,
      first_name TEXT,
      username TEXT,
      language_code TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run()

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_users_tg_id ON users(tg_id)
  `).run()
}

async function upsertUser(env: Env, user: any) {
  const now = Date.now()
  const tgId = String(user.id)
  const firstName = user.first_name ?? null
  const username = user.username ?? null
  const language = user.language_code ?? null

  await env.DB.prepare(
    `
    INSERT INTO users (tg_id, first_name, username, language_code, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?5)
    ON CONFLICT(tg_id) DO UPDATE SET
      first_name=excluded.first_name,
      username=excluded.username,
      language_code=excluded.language_code,
      updated_at=excluded.updated_at
    `
  )
    .bind(tgId, firstName, username, language, now)
    .run()
}

// --------------------- Main Worker ---------------------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url)

    if (request.method === "OPTIONS") return new Response(null, { status: 204 })

    // Mini front (dev UI: Auth -> Match -> WS)
    if (url.pathname === "/mini") {
      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Durak WebApp Dev</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    body{font-family:system-ui,sans-serif;padding:16px}
    .row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
    button{padding:10px 14px;font-size:16px;border-radius:12px;border:1px solid #ddd;background:#fff;cursor:pointer}
    button:disabled{opacity:.5;cursor:not-allowed}
    pre{background:#f6f6f6;padding:12px;border-radius:12px;overflow:auto;white-space:pre-wrap}
    .small{font-size:12px;color:#666}
    input{padding:10px 12px;border-radius:12px;border:1px solid #ddd;min-width:280px}
  </style>
</head>
<body>
  <h2>Durak WebApp Dev</h2>
  <div class="row">
    <button id="btnAuth">1) Auth</button>
    <button id="btnMatch" disabled>2) Matchmaking</button>
    <button id="btnWS" disabled>3) Connect WS</button>
    <button id="btnMove" disabled>4) Send MOVE</button>
  </div>

  <div class="row">
    <input id="room" placeholder="roomId (auto after match)" />
  </div>

  <div class="small">
    Tip: открой мини-апп в двух клиентах/аккаунтах и нажми Matchmaking в обоих, чтобы получить matched.
  </div>

  <pre id="out">Ready.</pre>

  <script>
    const out = document.getElementById("out");
    const btnAuth = document.getElementById("btnAuth");
    const btnMatch = document.getElementById("btnMatch");
    const btnWS = document.getElementById("btnWS");
    const btnMove = document.getElementById("btnMove");
    const roomInput = document.getElementById("room");

    let sessionToken = "";
    let roomId = "";
    let ws = null;

    function log(...args){
      const line = args.map(a => {
        if (typeof a === "string") return a;
        try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    }).join(" ");
    out.textContent += "\\n" + line;
    out.scrollTop = out.scrollHeight;
   }

    function setOut(text){ out.textContent = text; }

    btnAuth.onclick = async () => {
      try {
        const initData = window.Telegram?.WebApp?.initData || "";
        if (!initData) { setOut("NO INITDATA. Открой как WebApp внутри Telegram."); return; }

        setOut("Auth: sending initData...");
        const r = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData })
        });
        const data = await r.json();
        setOut(JSON.stringify(data, null, 2));

        if (data.ok && data.sessionToken) {
          sessionToken = data.sessionToken;
          btnMatch.disabled = false;
          log("Auth OK. sessionToken saved.");
        } else {
          log("Auth failed.");
        }
      } catch (e) {
        setOut("Auth error: " + (e?.message || String(e)));
      }
    };

    btnMatch.onclick = async () => {
      try {
        if (!sessionToken) { log("No sessionToken. Press Auth first."); return; }
        log("Matchmaking: calling /api/matchmaking ...");

        const r = await fetch("/api/matchmaking", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": "Bearer " + sessionToken
          },
          body: "{}"
        });

        const data = await r.json();
        log(data);

        if (data.ok && data.status === "matched") {
          roomId = data.roomId;
          roomInput.value = roomId;
          btnWS.disabled = false;
          log("Matched! roomId=" + roomId + " wsUrl=" + data.wsUrl);
        } else if (data.ok && data.status === "queued") {
          log("Queued. Open another client and press Matchmaking there too.");
        }
      } catch (e) {
        log("Match error: " + (e?.message || String(e)));
      }
    };

    btnWS.onclick = async () => {
      try {
        if (!sessionToken) { log("No sessionToken. Press Auth first."); return; }
        roomId = roomInput.value.trim();
        if (!roomId) { log("No roomId. Get matched first."); return; }

        const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/" + roomId;
        log("Connecting WS:", wsUrl);

        if (ws) { try { ws.close(); } catch {} ws = null; }

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          log("WS open. Sending JOIN...");
          ws.send(JSON.stringify({ type: "JOIN", sessionToken, roomId }));
          btnMove.disabled = false;
        };

        ws.onmessage = (ev) => {
        try {
          const obj = JSON.parse(String(ev.data));
          log("WS <-", obj);
        } catch {
          log("WS <- (raw)", String(ev.data));
        }
      };

        ws.onclose = (ev) => log("WS close:", { code: ev.code, reason: ev.reason });
        ws.onerror = () => log("WS error");
      } catch (e) {
        log("WS error: " + (e?.message || String(e)));
      }
    };

  btnMove.onclick = () => {
  if (!ws || ws.readyState !== 1) { log("WS not connected"); return; }
  const payload = { type: "MOVE", action: "PING", ts: Date.now() };
  log("WS ->", payload);
  ws.send(JSON.stringify(payload));
};

  </script>
</body>
</html>`
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })
    }

    // Health
    if (url.pathname === "/") return new Response("OK", { status: 200 })

    // Optional webhook endpoint placeholder
    if (env.WEBHOOK_SECRET && url.pathname === `/${env.WEBHOOK_SECRET}`) {
      return new Response("OK", { status: 200 })
    }

    // Debug check for env presence (safe)
    if (url.pathname === "/env-check") {
      return json({
        ok: true,
        hasBOT_TOKEN: !!env.BOT_TOKEN,
        botTokenLen: env.BOT_TOKEN?.length ?? 0,
        hasAPP_SECRET: !!env.APP_SECRET,
        appSecretLen: env.APP_SECRET?.length ?? 0,
        hasDB: !!env.DB,
        hasMM: !!env.MM,
        hasROOM: !!env.ROOM,
      })
    }

    // DO test
    if (url.pathname === "/do-test") {
      try {
        const id = env.MM.idFromName("global")
        const stub = env.MM.get(id)
        return await stub.fetch("https://mm/ping")
      } catch (e: any) {
        return bad(500, "do-test failed", { detail: String(e?.message || e) })
      }
    }

    // D1 test
    if (url.pathname === "/d1-test") {
      try {
        await ensureSchema(env)

        await env.DB.prepare(`
          INSERT OR IGNORE INTO users (tg_id, created_at, updated_at)
          VALUES (?1, CAST(strftime('%s','now') AS INTEGER)*1000, CAST(strftime('%s','now') AS INTEGER)*1000)
        `)
          .bind("123")
          .run()

        const row = await env.DB.prepare(`SELECT COUNT(*) as c FROM users`).first<{ c: number }>()
        return ok({ users: row?.c ?? 0 })
      } catch (e: any) {
        return bad(500, "d1-test failed", { detail: String(e?.message || e) })
      }
    }

    // WS entry: /ws/<roomId>
    if (url.pathname.startsWith("/ws/")) {
      const roomId = url.pathname.slice("/ws/".length)
      if (!roomId) return bad(400, "roomId missing")
      const id = env.ROOM.idFromName(roomId)
      const stub = env.ROOM.get(id)
      return stub.fetch(request)
    }

    // API
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 })

    try {
      await ensureSchema(env)

      // POST /api/auth/telegram { initData }
      if (url.pathname === "/api/auth/telegram" && request.method === "POST") {
        if (!env.APP_SECRET) return bad(500, "APP_SECRET is not set")
        if (!env.BOT_TOKEN) return bad(500, "BOT_TOKEN is not set")

        const body = (await request.json().catch(() => ({}))) as { initData?: string }
        const initData = String(body.initData || "")

        const v = await validateTelegramInitData(initData, env.BOT_TOKEN)
        if (!v.ok) return bad(401, v.error || "auth failed")

        await upsertUser(env, v.user)

        const now = Date.now()
        const sessionPayload = {
          tg_id: String(v.user.id),
          iat: now,
          exp: now + 2 * 60 * 60 * 1000, // 2h
        }
        const sessionToken = await signSession(sessionPayload, env.APP_SECRET)

        return ok({
          sessionToken,
          user: {
            id: v.user.id,
            first_name: v.user.first_name,
            username: v.user.username,
          },
        })
      }

      // POST /api/matchmaking (Authorization: Bearer <sessionToken>)
      if (url.pathname === "/api/matchmaking" && request.method === "POST") {
        const auth = request.headers.get("authorization") || ""
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : ""

        const session = (await verifySession(token, env.APP_SECRET)) as
          | { tg_id: string; exp: number }
          | null

        if (!session) return bad(401, "invalid session")
        if (session.exp < Date.now()) return bad(401, "session expired")

        const mmId = env.MM.idFromName("global")
        const mm = env.MM.get(mmId)

        const res = await mm.fetch("https://mm/match", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tg_id: String(session.tg_id) }),
        })

        const data = await res.json().catch(() => null)
        return json(data || { ok: false, error: "matchmaker error" }, res.status)
      }

      return bad(404, "route not found")
    } catch (e: any) {
      return bad(500, "worker error", { detail: String(e?.message || e) })
    }
  },
}

// --------------------- Durable Object: MatchmakerDO ---------------------

export class MatchmakerDO {
  private waiting: string | null = null
  private env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.env = env
  }

  async fetch(request: Request) {
    const url = new URL(request.url)

    if (url.pathname === "/ping") return new Response("MatchmakerDO alive", { status: 200 })

    if (url.pathname !== "/match" || request.method !== "POST") {
      return bad(404, "not found")
    }

    const body = (await request.json().catch(() => ({}))) as { tg_id?: string }
    const tgId = body.tg_id ? String(body.tg_id) : ""
    if (!tgId) return bad(400, "tg_id missing")

    if (!this.waiting) {
      this.waiting = tgId
      return json({ ok: true, status: "queued" }, 200)
    }

    if (this.waiting === tgId) {
      return json({ ok: true, status: "queued" }, 200)
    }

    const p1 = this.waiting
    const p2 = tgId
    this.waiting = null

    const roomId = crypto.randomUUID()

    // init room (persisted in RoomDO storage)
    const roomStub = this.env.ROOM.get(this.env.ROOM.idFromName(roomId))
    await roomStub.fetch("https://room/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId, players: [p1, p2] }),
    })

    return json({ ok: true, status: "matched", roomId, wsUrl: `/ws/${roomId}` }, 200)
  }
}

// --------------------- Durable Object: RoomDO (WebSocket room, persisted meta) ---------------------

type RoomMeta = {
  roomId: string | null
  players: string[]
  turnIndex: number
}

type ServerMsg =
  | { type: "STATE"; roomId: string | null; players: string[]; you: string; turn: string | null }
  | { type: "READY"; turn: string | null }
  | { type: "TURN"; lastMove: any; nextTurn: string | null }
  | { type: "ERROR"; code: string; detail?: string }
  | { type: string; [k: string]: any }

export class RoomDO {
  private state: DurableObjectState
  private env: Env

  private loaded = false
  private roomId: string | null = null
  private players: string[] = []
  private turnIndex = 0

  private socketsByTgId = new Map<string, WebSocket>()

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  private async load() {
    if (this.loaded) return
    const meta = await this.state.storage.get<RoomMeta>("meta")
    if (meta) {
      this.roomId = meta.roomId ?? null
      this.players = Array.isArray(meta.players) ? meta.players.map(String) : []
      this.turnIndex = typeof meta.turnIndex === "number" ? meta.turnIndex : 0
    }
    this.loaded = true
  }

  private async save() {
    const meta: RoomMeta = {
      roomId: this.roomId,
      players: this.players,
      turnIndex: this.turnIndex,
    }
    await this.state.storage.put("meta", meta)
  }

  private broadcast(obj: ServerMsg) {
    const msg = JSON.stringify(obj)
    for (const ws of this.socketsByTgId.values()) {
      try {
        ws.send(msg)
      } catch {}
    }
  }

  async fetch(request: Request) {
    await this.load()
    const url = new URL(request.url)

    // init room (called by Matchmaker)
    if (url.pathname === "/init" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { roomId?: string; players?: unknown[] }
      const incomingRoomId = body.roomId ? String(body.roomId) : null
      const incomingPlayers = Array.isArray(body.players) ? body.players.map(String) : []

      this.roomId = incomingRoomId
      this.players = incomingPlayers
      this.turnIndex = 0
      await this.save()

      return ok({ roomId: this.roomId, players: this.players })
    }

    if (url.pathname === "/ping") return new Response("RoomDO alive", { status: 200 })

    // websocket upgrade
    if (request.headers.get("Upgrade") !== "websocket") {
      return bad(426, "Expected websocket")
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()

    server.addEventListener("message", async (ev) => {
      let msg: any
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        try {
          server.send(JSON.stringify({ type: "ERROR", code: "BAD_JSON" } as ServerMsg))
        } catch {}
        return
      }

      // JOIN: { type:"JOIN", sessionToken:"...", roomId:"..." }
      if (msg?.type === "JOIN") {
        const sessionToken = String(msg.sessionToken || "")
        const session = (await verifySession(sessionToken, this.env.APP_SECRET)) as
          | { tg_id: string; exp: number }
          | null

        if (!session) {
          try {
            server.send(JSON.stringify({ type: "ERROR", code: "BAD_SESSION" } as ServerMsg))
          } catch {}
          try {
            server.close(1008, "Bad session")
          } catch {}
          return
        }

        if (session.exp < Date.now()) {
          try {
            server.send(JSON.stringify({ type: "ERROR", code: "SESSION_EXPIRED" } as ServerMsg))
          } catch {}
          try {
            server.close(1008, "Session expired")
          } catch {}
          return
        }

        // Ensure meta loaded (in case DO was restarted)
        await this.load()

        const tgId = String(session.tg_id)

        // If room is initialized, allow only listed players
        if (this.players.length > 0 && !this.players.includes(tgId)) {
          try {
            server.send(JSON.stringify({ type: "ERROR", code: "NOT_IN_ROOM" } as ServerMsg))
          } catch {}
          try {
            server.close(1008, "Not in room")
          } catch {}
          return
        }

        // reconnect replace
        const prev = this.socketsByTgId.get(tgId)
        if (prev) {
          try {
            prev.close(1012, "Replaced")
          } catch {}
        }
        this.socketsByTgId.set(tgId, server)

        const turn = this.players[this.turnIndex] ?? null
        const stateMsg: ServerMsg = {
          type: "STATE",
          roomId: this.roomId,
          players: this.players,
          you: tgId,
          turn,
        }
        try {
          server.send(JSON.stringify(stateMsg))
        } catch {}

        if (this.socketsByTgId.size === 2) {
          this.broadcast({ type: "READY", turn })
        }
        return
      }

      // MOVE: { type:"MOVE", ... }
      if (msg?.type === "MOVE") {
        const sender =
          [...this.socketsByTgId.entries()].find(([, ws]) => ws === server)?.[0] ?? null

        if (!sender) {
          try {
            server.send(JSON.stringify({ type: "ERROR", code: "NOT_JOINED" } as ServerMsg))
          } catch {}
          return
        }

        const currentTurn = this.players[this.turnIndex]
        if (this.players.length === 2 && sender !== currentTurn) {
          try {
            server.send(JSON.stringify({ type: "ERROR", code: "NOT_YOUR_TURN" } as ServerMsg))
          } catch {}
          return
        }

        // MVP: any MOVE toggles turn
        if (this.players.length === 2) {
          this.turnIndex = 1 - this.turnIndex
          await this.save()
        }

        this.broadcast({
          type: "TURN",
          lastMove: msg,
          nextTurn: this.players[this.turnIndex] ?? null,
        })
        return
      }

      try {
        server.send(JSON.stringify({ type: "ERROR", code: "UNKNOWN_MSG" } as ServerMsg))
      } catch {}
    })

    server.addEventListener("close", () => {
      for (const [tgId, ws] of this.socketsByTgId.entries()) {
        if (ws === server) {
          this.socketsByTgId.delete(tgId)
          this.broadcast({ type: "PLAYER_DISCONNECTED", tgId })
          break
        }
      }
    })

    return new Response(null, { status: 101, webSocket: client })
  }
}
