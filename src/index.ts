/// <reference types="@cloudflare/workers-types" />

/**
 * Durak 1v1 (MVP but playable) on Cloudflare Workers + Durable Objects + D1
 * - Telegram Mini App auth via initData
 * - Matchmaking (queue -> match -> room)
 * - RoomDO keeps full game state in state.storage (survives restarts)
 * - WebSocket protocol: JOIN + ATTACK/DEFEND/TAKE/BEAT
 * - /mini = simple HTML UI inside Telegram (no separate frontend needed)
 *
 * REQUIRED bindings (Cloudflare Dashboard / wrangler):
 * - Secrets: BOT_TOKEN, APP_SECRET
 * - D1 binding: DB
 * - Durable Objects bindings: MM -> MatchmakerDO, ROOM -> RoomDO
 */

export interface Env {
  BOT_TOKEN: string
  APP_SECRET: string
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
  // strict ArrayBuffer slice to satisfy TS + WebCrypto BufferSource types
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
 * data_check_string = sorted key=value (except hash) joined by '\n'
 * secret_key bytes = HMAC_SHA256("WebAppData", bot_token)
 * expected_hash = HEX(HMAC_SHA256(secret_key, data_check_string))
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

// --------------------- D1 schema (optional user table) ---------------------

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

  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_users_tg_id ON users(tg_id)`).run()
}

async function upsertUser(env: Env, user: any) {
  const now = Date.now()
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
    .bind(
      String(user.id),
      user.first_name ?? null,
      user.username ?? null,
      user.language_code ?? null,
      now
    )
    .run()
}

// --------------------- Durak game types/helpers ---------------------

type Suit = "S" | "H" | "D" | "C" // Spades, Hearts, Diamonds, Clubs
type Rank = 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 // 11=J,12=Q,13=K,14=A
type Card = string // e.g. "S6", "H10", "DJ", "CQ", "SK", "HA"

type TablePair = { a: Card; d: Card | null }
type Phase = "lobby" | "playing" | "finished"

type GameState = {
  roomId: string
  phase: Phase
  players: [string, string] // tg_ids
  deck: Card[]
  trumpSuit: Suit
  trumpCard: Card
  hands: Record<string, Card[]>
  table: TablePair[]
  discard: Card[]
  attacker: string
  defender: string
  defenderCapacity: number // max cards attacker can put this round
  winner: string | null
  updatedAt: number
}

const SUITS: Suit[] = ["S", "H", "D", "C"]
const RANKS: Rank[] = [6, 7, 8, 9, 10, 11, 12, 13, 14]

function rankToStr(r: Rank): string {
  if (r === 11) return "J"
  if (r === 12) return "Q"
  if (r === 13) return "K"
  if (r === 14) return "A"
  return String(r)
}
function strToRank(s: string): Rank | null {
  if (s === "J") return 11
  if (s === "Q") return 12
  if (s === "K") return 13
  if (s === "A") return 14
  const n = Number(s)
  if ([6, 7, 8, 9, 10].includes(n)) return n as Rank
  return null
}
function parseCard(card: Card): { suit: Suit; rank: Rank } | null {
  if (!card || card.length < 2) return null
  const suit = card[0] as Suit
  const rStr = card.slice(1)
  if (!SUITS.includes(suit)) return null
  const rank = strToRank(rStr)
  if (!rank) return null
  return { suit, rank }
}
function createDeck36(): Card[] {
  const deck: Card[] = []
  for (const s of SUITS) for (const r of RANKS) deck.push(`${s}${rankToStr(r)}`)
  return deck
}
function shuffle<T>(arr: T[]): T[] {
  // Fisher–Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
function cardBeats(defCard: Card, atkCard: Card, trumpSuit: Suit): boolean {
  const d = parseCard(defCard)
  const a = parseCard(atkCard)
  if (!d || !a) return false
  if (d.suit === a.suit) return d.rank > a.rank
  if (d.suit === trumpSuit && a.suit !== trumpSuit) return true
  return false
}
function allTableRanks(table: TablePair[]): Set<Rank> {
  const set = new Set<Rank>()
  for (const p of table) {
    const a = parseCard(p.a)
    if (a) set.add(a.rank)
    if (p.d) {
      const d = parseCard(p.d)
      if (d) set.add(d.rank)
    }
  }
  return set
}
function isTableFullyDefended(table: TablePair[]): boolean {
  return table.length > 0 && table.every((p) => !!p.d)
}

function removeCard(hand: Card[], card: Card): boolean {
  const idx = hand.indexOf(card)
  if (idx === -1) return false
  hand.splice(idx, 1)
  return true
}

function drawUpTo6(state: GameState, order: string[]) {
  for (const pid of order) {
    const hand = state.hands[pid]
    while (hand.length < 6 && state.deck.length > 0) {
      const c = state.deck.pop()! // take from end
      hand.push(c)
    }
    hand.sort(sortBySuitThenRank)
  }
}

function sortBySuitThenRank(a: Card, b: Card) {
  const pa = parseCard(a)!
  const pb = parseCard(b)!
  if (pa.suit !== pb.suit) return pa.suit < pb.suit ? -1 : 1
  return pa.rank - pb.rank
}

function lowestTrump(hand: Card[], trumpSuit: Suit): Rank | null {
  let best: Rank | null = null
  for (const c of hand) {
    const p = parseCard(c)
    if (!p) continue
    if (p.suit !== trumpSuit) continue
    if (best === null || p.rank < best) best = p.rank
  }
  return best
}

function pickFirstAttacker(p1: string, p2: string, hands: Record<string, Card[]>, trumpSuit: Suit): string {
  const r1 = lowestTrump(hands[p1], trumpSuit)
  const r2 = lowestTrump(hands[p2], trumpSuit)
  if (r1 === null && r2 === null) return Math.random() < 0.5 ? p1 : p2
  if (r1 === null) return p2
  if (r2 === null) return p1
  return r1 <= r2 ? p1 : p2
}

function checkWin(state: GameState) {
  if (state.deck.length > 0) return
  const [p1, p2] = state.players
  const h1 = state.hands[p1].length
  const h2 = state.hands[p2].length
  if (h1 === 0 && h2 === 0) {
    state.phase = "finished"
    state.winner = "DRAW"
  } else if (h1 === 0) {
    state.phase = "finished"
    state.winner = p1
  } else if (h2 === 0) {
    state.phase = "finished"
    state.winner = p2
  }
}

// --------------------- Worker routes ---------------------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url)

    if (request.method === "OPTIONS") return new Response(null, { status: 204 })

    // Basic health
    if (url.pathname === "/") return new Response("OK", { status: 200 })

    // Mini app UI (dev but playable)
    if (url.pathname === "/mini") {
      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Durak 1v1</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    body{font-family:system-ui,sans-serif;padding:14px}
    h2{margin:6px 0 10px}
    .row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
    button{padding:10px 12px;font-size:15px;border-radius:12px;border:1px solid #ddd;background:#fff;cursor:pointer}
    button:disabled{opacity:.5;cursor:not-allowed}
    .cardbtn{padding:8px 10px;border-radius:10px;border:1px solid #ddd;background:#fff}
    .sel{border-color:#000}
    pre{background:#f6f6f6;padding:12px;border-radius:12px;overflow:auto;white-space:pre-wrap}
    .box{border:1px solid #eee;border-radius:12px;padding:10px;margin:10px 0}
    .small{color:#666;font-size:12px}
    .kv{display:flex;gap:10px;flex-wrap:wrap}
    .kv b{min-width:90px;display:inline-block}
  </style>
</head>
<body>
  <h2>Durak 1v1</h2>

  <div class="row">
    <button id="btnAuth">1) Auth</button>
    <button id="btnMatch" disabled>2) Match</button>
    <button id="btnWS" disabled>3) Connect</button>
  </div>

  <div class="box">
    <div class="kv">
      <div><b>Room</b> <span id="room">-</span></div>
      <div><b>You</b> <span id="you">-</span></div>
      <div><b>Role</b> <span id="role">-</span></div>
      <div><b>Trump</b> <span id="trump">-</span></div>
      <div><b>Deck</b> <span id="deck">-</span></div>
      <div><b>Opp</b> <span id="opp">-</span></div>
      <div><b>Status</b> <span id="status">-</span></div>
    </div>
    <div class="small">Tip: открой мини-апп в двух аккаунтах/клиентах и нажми Match в обоих.</div>
  </div>

  <div class="box">
    <div><b>Table</b> (click attack index to defend)</div>
    <div id="table" class="row"></div>
    <div class="row">
      <button id="btnTake" disabled>TAKE</button>
      <button id="btnBeat" disabled>BEAT</button>
    </div>
    <div class="small">Для DEFEND: выбери атаку на столе (A#), затем карту из руки и нажми на эту карту.</div>
  </div>

  <div class="box">
    <div><b>Your hand</b> (click card to ATTACK/DEFEND)</div>
    <div id="hand" class="row"></div>
  </div>

  <pre id="log">Ready.</pre>

<script>
  const logEl = document.getElementById("log");
  const btnAuth = document.getElementById("btnAuth");
  const btnMatch = document.getElementById("btnMatch");
  const btnWS = document.getElementById("btnWS");
  const btnTake = document.getElementById("btnTake");
  const btnBeat = document.getElementById("btnBeat");

  const roomEl = document.getElementById("room");
  const youEl = document.getElementById("you");
  const roleEl = document.getElementById("role");
  const trumpEl = document.getElementById("trump");
  const deckEl = document.getElementById("deck");
  const oppEl = document.getElementById("opp");
  const statusEl = document.getElementById("status");
  const handEl = document.getElementById("hand");
  const tableEl = document.getElementById("table");

  let sessionToken = "";
  let roomId = "";
  let ws = null;
  let lastState = null;

  let selectedCard = "";
  let selectedAttackIndex = null;

  function log(...args){
    const line = args.map(a => {
      if (typeof a === "string") return a;
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    }).join(" ");
    logEl.textContent += "\\n" + line;
    logEl.scrollTop = logEl.scrollHeight;
  }
  function setLog(s){ logEl.textContent = s; }
  function setStatus(s){ statusEl.textContent = s; }

  function render(state){
    lastState = state;
    roomEl.textContent = state.roomId || "-";
    youEl.textContent = state.you || "-";
    trumpEl.textContent = state.trumpSuit ? (state.trumpSuit + " (" + state.trumpCard + ")") : "-";
    deckEl.textContent = String(state.deckCount ?? "-");
    oppEl.textContent = (state.oppId ? state.oppId : "-") + " (" + (state.oppCount ?? "-") + " cards)";
    setStatus(state.phase + (state.winner ? (" winner=" + state.winner) : ""));

    const role = (state.you === state.attacker) ? "ATTACKER" : ((state.you === state.defender) ? "DEFENDER" : "-");
    roleEl.textContent = role + " | turn=" + (state.turn || "-");

    btnTake.disabled = !(role === "DEFENDER" && state.phase === "playing");
    btnBeat.disabled = !(role === "DEFENDER" && state.phase === "playing");

    // table
    tableEl.innerHTML = "";
    selectedAttackIndex = (selectedAttackIndex !== null && state.table && state.table[selectedAttackIndex]) ? selectedAttackIndex : null;

    (state.table || []).forEach((p, idx) => {
      const btn = document.createElement("button");
      btn.className = "cardbtn" + (selectedAttackIndex === idx ? " sel" : "");
      btn.textContent = "A" + idx + ": " + p.a + "  →  " + (p.d || "??");
      btn.onclick = () => {
        selectedAttackIndex = idx;
        render(lastState);
      };
      tableEl.appendChild(btn);
    });

    // hand
    handEl.innerHTML = "";
    (state.yourHand || []).forEach((c) => {
      const btn = document.createElement("button");
      btn.className = "cardbtn" + (selectedCard === c ? " sel" : "");
      btn.textContent = c;
      btn.onclick = () => {
        // Click card: if defender and selectedAttackIndex != null => DEFEND, else ATTACK
        selectedCard = c;

        const role = (state.you === state.attacker) ? "ATTACKER" : ((state.you === state.defender) ? "DEFENDER" : "-");

        if (!ws || ws.readyState !== 1) {
          render(lastState);
          return;
        }

        if (state.phase !== "playing") {
          render(lastState);
          return;
        }

        if (role === "DEFENDER" && selectedAttackIndex !== null) {
          const payload = { type:"DEFEND", card:c, attackIndex:selectedAttackIndex };
          log("WS ->", payload);
          ws.send(JSON.stringify(payload));
        } else {
          const payload = { type:"ATTACK", card:c };
          log("WS ->", payload);
          ws.send(JSON.stringify(payload));
        }

        render(lastState);
      };
      handEl.appendChild(btn);
    });
  }

  btnAuth.onclick = async () => {
    try{
      const initData = window.Telegram?.WebApp?.initData || "";
      if (!initData) { setLog("NO INITDATA. Open as Telegram WebApp."); return; }
      setLog("Auth...");
      const r = await fetch("/api/auth/telegram", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify({ initData })
      });
      const data = await r.json();
      setLog(JSON.stringify(data, null, 2));
      if (data.ok && data.sessionToken) {
        sessionToken = data.sessionToken;
        btnMatch.disabled = false;
        log("Auth OK. sessionToken saved.");
      }
    }catch(e){
      setLog("Auth error: " + (e?.message || String(e)));
    }
  };

  btnMatch.onclick = async () => {
    try{
      if (!sessionToken) { log("No sessionToken. Auth first."); return; }
      log("Matchmaking...");
      const r = await fetch("/api/matchmaking", {
        method:"POST",
        headers:{
          "content-type":"application/json",
          "authorization":"Bearer " + sessionToken
        },
        body:"{}"
      });
      const data = await r.json();
      log(data);
      if (data.ok && data.status === "matched") {
        roomId = data.roomId;
        roomEl.textContent = roomId;
        btnWS.disabled = false;
      } else {
        setStatus("queued");
      }
    }catch(e){
      log("Match error:", e?.message || String(e));
    }
  };

  btnWS.onclick = async () => {
    try{
      if (!roomId) { log("No roomId. Match first."); return; }
      const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/" + roomId;
      log("Connecting WS:", wsUrl);
      if (ws) { try { ws.close(); } catch {} ws = null; }
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        log("WS open. JOIN...");
        ws.send(JSON.stringify({ type:"JOIN", sessionToken, roomId }));
      };

      ws.onmessage = (ev) => {
        try{
          const obj = JSON.parse(String(ev.data));
          log("WS <-", obj);
          if (obj.type === "STATE") render(obj);
          if (obj.type === "ERROR") setStatus("ERROR: " + obj.code);
          if (obj.type === "INFO") setStatus(obj.message || "INFO");
        }catch{
          log("WS <- (raw)", String(ev.data));
        }
      };

      ws.onclose = (ev) => log("WS close:", { code: ev.code, reason: ev.reason });
      ws.onerror = () => log("WS error");
    }catch(e){
      log("WS error:", e?.message || String(e));
    }
  };

  btnTake.onclick = () => {
    if (!ws || ws.readyState !== 1) return;
    const payload = { type:"TAKE" };
    log("WS ->", payload);
    ws.send(JSON.stringify(payload));
  };

  btnBeat.onclick = () => {
    if (!ws || ws.readyState !== 1) return;
    const payload = { type:"BEAT" };
    log("WS ->", payload);
    ws.send(JSON.stringify(payload));
  };
</script>
</body>
</html>`
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })
    }

    // WS entry: /ws/<roomId>
    if (url.pathname.startsWith("/ws/")) {
      const roomId = url.pathname.slice("/ws/".length)
      if (!roomId) return bad(400, "roomId missing")
      const id = env.ROOM.idFromName(roomId)
      const stub = env.ROOM.get(id)
      return stub.fetch(request)
    }

    // tests
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

    if (url.pathname === "/d1-test") {
      try {
        await ensureSchema(env)
        const row = await env.DB.prepare(`SELECT COUNT(*) as c FROM users`).first<{ c: number }>()
        return ok({ users: row?.c ?? 0 })
      } catch (e: any) {
        return bad(500, "d1-test failed", { detail: String(e?.message || e) })
      }
    }

    // API
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 })

    try {
      await ensureSchema(env)

      // POST /api/auth/telegram { initData }
      if (url.pathname === "/api/auth/telegram" && request.method === "POST") {
        if (!env.BOT_TOKEN) return bad(500, "BOT_TOKEN is not set")
        if (!env.APP_SECRET) return bad(500, "APP_SECRET is not set")

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

      // POST /api/matchmaking
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

    const roomStub = this.env.ROOM.get(this.env.ROOM.idFromName(roomId))
    await roomStub.fetch("https://room/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId, players: [p1, p2] }),
    })

    return json({ ok: true, status: "matched", roomId, wsUrl: `/ws/${roomId}` }, 200)
  }
}

// --------------------- Durable Object: RoomDO ---------------------

type RoomMeta = {
  roomId: string
  players: [string, string]
}

type JoinMsg = { type: "JOIN"; sessionToken: string; roomId: string }
type AttackMsg = { type: "ATTACK"; card: Card }
type DefendMsg = { type: "DEFEND"; card: Card; attackIndex: number }
type TakeMsg = { type: "TAKE" }
type BeatMsg = { type: "BEAT" }

type ClientMsg = JoinMsg | AttackMsg | DefendMsg | TakeMsg | BeatMsg | { type: string; [k: string]: any }

type StateForClient = {
  type: "STATE"
  roomId: string
  phase: Phase
  players: [string, string]
  you: string
  oppId: string
  attacker: string
  defender: string
  turn: string
  trumpSuit: Suit
  trumpCard: Card
  deckCount: number
  yourHand: Card[]
  oppCount: number
  table: TablePair[]
  discardCount: number
  winner: string | null
}

export class RoomDO {
  private state: DurableObjectState
  private env: Env

  private loaded = false
  private meta: RoomMeta | null = null
  private game: GameState | null = null

  private socketsByTgId = new Map<string, WebSocket>()

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  private async load() {
    if (this.loaded) return
    this.meta = (await this.state.storage.get<RoomMeta>("meta")) ?? null
    this.game = (await this.state.storage.get<GameState>("game")) ?? null
    this.loaded = true
  }

  private async save() {
    if (this.meta) await this.state.storage.put("meta", this.meta)
    if (this.game) await this.state.storage.put("game", this.game)
  }

  private sendTo(tgId: string, obj: any) {
    const ws = this.socketsByTgId.get(tgId)
    if (!ws) return
    try {
      ws.send(JSON.stringify(obj))
    } catch {}
  }

  private broadcast(obj: any) {
    const msg = JSON.stringify(obj)
    for (const ws of this.socketsByTgId.values()) {
      try {
        ws.send(msg)
      } catch {}
    }
  }

  private broadcastState() {
    if (!this.game || !this.meta) return
    const g = this.game
    const [p1, p2] = this.meta.players

    for (const [tgId] of this.socketsByTgId.entries()) {
      const you = tgId
      const oppId = you === p1 ? p2 : p1
      const st: StateForClient = {
        type: "STATE",
        roomId: g.roomId,
        phase: g.phase,
        players: g.players,
        you,
        oppId,
        attacker: g.attacker,
        defender: g.defender,
        turn: g.attacker, // in this MVP: attacker acts unless defender defends/takes/beats
        trumpSuit: g.trumpSuit,
        trumpCard: g.trumpCard,
        deckCount: g.deck.length,
        yourHand: (g.hands[you] || []).slice(),
        oppCount: (g.hands[oppId] || []).length,
        table: g.table,
        discardCount: g.discard.length,
        winner: g.winner,
      }
      this.sendTo(you, st)
    }
  }

  private newGame(roomId: string, players: [string, string]) {
    const deck = shuffle(createDeck36())
    const trumpCard = deck[0] // keep visible "bottom" idea (any stable card)
    const trumpSuit = parseCard(trumpCard)!.suit

    const hands: Record<string, Card[]> = {
      [players[0]]: [],
      [players[1]]: [],
    }

    // deal 6 each alternating (common)
    for (let i = 0; i < 6; i++) {
      for (const pid of players) {
        const c = deck.pop()
        if (c) hands[pid].push(c)
      }
    }
    hands[players[0]].sort(sortBySuitThenRank)
    hands[players[1]].sort(sortBySuitThenRank)

    const firstAttacker = pickFirstAttacker(players[0], players[1], hands, trumpSuit)
    const firstDefender = firstAttacker === players[0] ? players[1] : players[0]

    const g: GameState = {
      roomId,
      phase: "playing",
      players,
      deck,
      trumpSuit,
      trumpCard,
      hands,
      table: [],
      discard: [],
      attacker: firstAttacker,
      defender: firstDefender,
      defenderCapacity: hands[firstDefender].length, // max cards this round
      winner: null,
      updatedAt: Date.now(),
    }
    this.game = g
  }

  private ensureRolesAfterRound(nextAttacker: string, nextDefender: string) {
    if (!this.game) return
    this.game.attacker = nextAttacker
    this.game.defender = nextDefender
    this.game.defenderCapacity = this.game.hands[nextDefender].length
  }

  private endRoundDefenderTakes() {
    if (!this.game) return
    const g = this.game

    // defender takes all table cards
    const taken: Card[] = []
    for (const p of g.table) {
      taken.push(p.a)
      if (p.d) taken.push(p.d)
    }
    g.hands[g.defender].push(...taken)
    g.hands[g.defender].sort(sortBySuitThenRank)

    g.table = []

    // draw: attacker then defender
    drawUpTo6(g, [g.attacker, g.defender])

    // attacker remains attacker
    this.ensureRolesAfterRound(g.attacker, g.defender)
    checkWin(g)
    g.updatedAt = Date.now()
  }

  private endRoundDefenderBeats() {
    if (!this.game) return
    const g = this.game

    // all table cards -> discard
    for (const p of g.table) {
      g.discard.push(p.a)
      if (p.d) g.discard.push(p.d)
    }
    g.table = []

    // swap roles
    const nextAttacker = g.defender
    const nextDefender = g.attacker
    g.attacker = nextAttacker
    g.defender = nextDefender

    // draw: attacker first (new attacker)
    drawUpTo6(g, [g.attacker, g.defender])

    this.ensureRolesAfterRound(g.attacker, g.defender)
    checkWin(g)
    g.updatedAt = Date.now()
  }

  private canAttack(card: Card): { ok: boolean; error?: string } {
    if (!this.game) return { ok: false, error: "no game" }
    const g = this.game
    if (g.phase !== "playing") return { ok: false, error: "game not playing" }
    if (g.table.length >= g.defenderCapacity) return { ok: false, error: "limit reached" }

    const inHand = g.hands[g.attacker].includes(card)
    if (!inHand) return { ok: false, error: "card not in attacker hand" }

    if (g.table.length === 0) return { ok: true }

    const ranks = allTableRanks(g.table)
    const p = parseCard(card)
    if (!p) return { ok: false, error: "bad card" }
    if (!ranks.has(p.rank)) return { ok: false, error: "rank not on table" }
    return { ok: true }
  }

  private canDefend(attackIndex: number, card: Card): { ok: boolean; error?: string } {
    if (!this.game) return { ok: false, error: "no game" }
    const g = this.game
    if (g.phase !== "playing") return { ok: false, error: "game not playing" }
    if (attackIndex < 0 || attackIndex >= g.table.length) return { ok: false, error: "bad attackIndex" }
    const pair = g.table[attackIndex]
    if (pair.d) return { ok: false, error: "already defended" }

    const inHand = g.hands[g.defender].includes(card)
    if (!inHand) return { ok: false, error: "card not in defender hand" }

    if (!cardBeats(card, pair.a, g.trumpSuit)) return { ok: false, error: "card does not beat" }
    return { ok: true }
  }

  async fetch(request: Request) {
    await this.load()
    const url = new URL(request.url)

    // called by Matchmaker
    if (url.pathname === "/init" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { roomId?: string; players?: unknown[] }
      const roomId = body.roomId ? String(body.roomId) : ""
      const playersArr = Array.isArray(body.players) ? body.players.map(String) : []
      if (!roomId || playersArr.length !== 2) return bad(400, "bad init")

      const players: [string, string] = [playersArr[0], playersArr[1]]

      this.meta = { roomId, players }
      this.newGame(roomId, players)
      await this.save()
      return ok({ roomId, players })
    }

    // WS upgrade
    if (request.headers.get("Upgrade") !== "websocket") {
      return bad(426, "Expected websocket")
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()

    let boundTgId: string | null = null

    const sendErr = (code: string, extra?: any) => {
      try {
        server.send(JSON.stringify({ type: "ERROR", code, ...(extra || {}) }))
      } catch {}
    }

    server.addEventListener("message", async (ev) => {
      let msg: ClientMsg
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        sendErr("BAD_JSON")
        return
      }

      // JOIN
      if (msg.type === "JOIN") {
        const session = (await verifySession(String((msg as JoinMsg).sessionToken || ""), this.env.APP_SECRET)) as
          | { tg_id: string; exp: number }
          | null
        if (!session) {
          sendErr("BAD_SESSION")
          try { server.close(1008, "Bad session") } catch {}
          return
        }
        if (session.exp < Date.now()) {
          sendErr("SESSION_EXPIRED")
          try { server.close(1008, "Expired") } catch {}
          return
        }

        const tgId = String(session.tg_id)
        boundTgId = tgId

        // reload latest state (in case DO restarted)
        await this.load()

        if (!this.meta || !this.game) {
          sendErr("ROOM_NOT_READY")
          try { server.close(1011, "Room not ready") } catch {}
          return
        }

        if (!this.meta.players.includes(tgId)) {
          sendErr("NOT_IN_ROOM")
          try { server.close(1008, "Not in room") } catch {}
          return
        }

        // replace old socket for same tgId (reconnect)
        const prev = this.socketsByTgId.get(tgId)
        if (prev) {
          try { prev.close(1012, "Replaced") } catch {}
        }
        this.socketsByTgId.set(tgId, server)

        // send personalized state
        this.broadcastState()
        return
      }

      // Must be joined
      if (!boundTgId) {
        sendErr("NOT_JOINED")
        return
      }

      await this.load()
      if (!this.game || !this.meta) {
        sendErr("ROOM_NOT_READY")
        return
      }
      const g = this.game

      // finished
      if (g.phase === "finished") {
        sendErr("GAME_FINISHED", { winner: g.winner })
        this.broadcastState()
        return
      }

      // Only players
      if (!this.meta.players.includes(boundTgId)) {
        sendErr("NOT_IN_ROOM")
        return
      }

      const you = boundTgId

      // ATTACK
      if (msg.type === "ATTACK") {
        if (you !== g.attacker) {
          sendErr("NOT_YOUR_TURN", { turn: g.attacker })
          return
        }
        const card = String((msg as AttackMsg).card || "")
        const can = this.canAttack(card)
        if (!can.ok) {
          sendErr("BAD_ATTACK", { detail: can.error })
          return
        }

        if (!removeCard(g.hands[g.attacker], card)) {
          sendErr("CARD_NOT_IN_HAND")
          return
        }

        g.table.push({ a: card, d: null })
        g.updatedAt = Date.now()
        await this.save()
        this.broadcastState()
        return
      }

      // DEFEND
    // DEFEND
if (msg.type === "DEFEND") {
  if (you !== g.defender) {
    sendErr("NOT_YOUR_ROLE", { role: "DEFENDER", defender: g.defender })
    return
  }

  const rawIndex = (msg as any).attackIndex
  const attackIndex =
    typeof rawIndex === "number" ? rawIndex : Number(rawIndex)

  const card = String((msg as DefendMsg).card || "")

  if (!Number.isInteger(attackIndex)) {
    sendErr("BAD_DEFEND", { detail: "attackIndex required" })
    return
  }

  const can = this.canDefend(attackIndex, card)
  if (!can.ok) {
    sendErr("BAD_DEFEND", { detail: can.error })
    return
  }

  if (!removeCard(g.hands[g.defender], card)) {
    sendErr("CARD_NOT_IN_HAND")
    return
  }

  g.table[attackIndex].d = card
  g.updatedAt = Date.now()
  await this.save()
  this.broadcastState()
  return
}


      // TAKE (defender)
      if (msg.type === "TAKE") {
        if (you !== g.defender) {
          sendErr("NOT_YOUR_ROLE", { role: "DEFENDER", defender: g.defender })
          return
        }
        if (g.table.length === 0) {
          sendErr("NOTHING_ON_TABLE")
          return
        }

        this.endRoundDefenderTakes()
        await this.save()
        this.broadcastState()
        return
      }

      // BEAT (defender) - only if fully defended
      if (msg.type === "BEAT") {
        if (you !== g.defender) {
          sendErr("NOT_YOUR_ROLE", { role: "DEFENDER", defender: g.defender })
          return
        }
        if (!isTableFullyDefended(g.table)) {
          sendErr("NOT_FULLY_DEFENDED")
          return
        }

        this.endRoundDefenderBeats()
        await this.save()
        this.broadcastState()
        return
      }

      sendErr("UNKNOWN_MSG")
    })

    server.addEventListener("close", () => {
      if (!boundTgId) return
      const ws = this.socketsByTgId.get(boundTgId)
      if (ws === server) this.socketsByTgId.delete(boundTgId)
      // keep game running; state persists
    })

    return new Response(null, { status: 101, webSocket: client })
  }
}
