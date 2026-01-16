/// <reference types="@cloudflare/workers-types" />

/**
 * Durak backend (Invite rooms) — 2–4 players, Podkidnoy/Perevodnoy, deck 24/36
 * Cloudflare Workers + Durable Objects + D1 (optional users table)
 *
 * Routes:
 *  GET  /mini                      -> mini test UI (Telegram WebApp)
 *  POST /api/auth/telegram         -> {initData} => sessionToken
 *  POST /api/room/create           -> create invite room (auth)
 *  WS   /ws/<roomId>               -> gameplay websocket
 *  GET  /env-check                 -> quick check bindings
 *  GET  /d1-test                   -> quick d1 check
 *
 * Bindings required:
 *  - Secrets: BOT_TOKEN, APP_SECRET
 *  - D1: DB
 *  - Durable Objects: ROOM -> RoomDO
 */

export interface Env {
  BOT_TOKEN: string
  APP_SECRET: string
  DB: D1Database
  ROOM: DurableObjectNamespace
}

/* --------------------------- HTTP helpers --------------------------- */

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

/* --------------------------- Crypto helpers --------------------------- */

async function hmacSha256Raw(keyBytes: Uint8Array, data: string): Promise<ArrayBuffer> {
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

/* --------------------------- Telegram initData validation --------------------------- */

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

  // secret_key = HMAC_SHA256("WebAppData", bot_token)
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

/* --------------------------- Session token (signed payload) --------------------------- */

type SessionPayload = {
  tg_id: string
  first_name?: string
  username?: string
  iat: number
  exp: number
}

async function signSession(payload: SessionPayload, appSecret: string): Promise<string> {
  const body = JSON.stringify(payload)
  const bodyBytes = new TextEncoder().encode(body)
  const bodyB64 = base64urlEncode(bodyBytes)
  const sigHex = toHex(await hmacSha256Text(appSecret, bodyB64))
  return `${bodyB64}.${sigHex}`
}
async function verifySession(token: string, appSecret: string): Promise<SessionPayload | null> {
  if (!token || !appSecret) return null
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [bodyB64, sigHex] = parts
  const expectedHex = toHex(await hmacSha256Text(appSecret, bodyB64))
  if (expectedHex !== sigHex) return null
  try {
    const bodyBytes = base64urlDecodeToBytes(bodyB64)
    return JSON.parse(new TextDecoder().decode(bodyBytes)) as SessionPayload
  } catch {
    return null
  }
}
function getBearer(request: Request): string {
  const auth = request.headers.get("authorization") || ""
  return auth.startsWith("Bearer ") ? auth.slice(7) : ""
}

/* --------------------------- D1 schema (optional) --------------------------- */

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

/* --------------------------- Durak types + engine helpers --------------------------- */

type Mode = "podkidnoy" | "perevodnoy"
type DeckSize = 24 | 36

type RoomPhase = "lobby" | "playing" | "finished"
type GamePhase = "playing" | "finished"

type Suit = "S" | "H" | "D" | "C"
type Rank = 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 // J=11 Q=12 K=13 A=14
type Card = string // e.g. "H9", "SJ", "DA"
type TablePair = { a: Card; d: Card | null }

type RoomConfig = {
  mode: Mode
  deckSize: DeckSize
  maxPlayers: 2 | 3 | 4
}

type LobbyPlayer = {
  id: string
  name: string
  username?: string
  connected: boolean
  ready: boolean
}

type RoomMeta = {
  roomId: string
  hostId: string
  config: RoomConfig
  createdAt: number
}

type GameState = {
  phase: GamePhase
  roomId: string
  config: RoomConfig

  order: string[] // seating order
  active: Record<string, boolean> // still in game

  deck: Card[]
  trumpSuit: Suit
  trumpCard: Card

  hands: Record<string, Card[]>
  table: TablePair[]
  discard: Card[]

  attackerId: string
  defenderId: string

  roundLimit: number
  passed: string[] // attackers who passed
  takeDeclared: boolean

  winner: string | null
  loser: string | null

  updatedAt: number
}

type VResult = { ok: true } | { ok: false; code: string }

const SUITS: Suit[] = ["S", "H", "D", "C"]
const RANKS_36: Rank[] = [6, 7, 8, 9, 10, 11, 12, 13, 14]
const RANKS_24: Rank[] = [9, 10, 11, 12, 13, 14]

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
function createDeck(deckSize: DeckSize): Card[] {
  const ranks = deckSize === 24 ? RANKS_24 : RANKS_36
  const deck: Card[] = []
  for (const s of SUITS) for (const r of ranks) deck.push(`${s}${rankToStr(r)}`)
  return deck
}
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
function sortBySuitThenRank(a: Card, b: Card) {
  const pa = parseCard(a)!
  const pb = parseCard(b)!
  if (pa.suit !== pb.suit) return pa.suit < pb.suit ? -1 : 1
  return pa.rank - pb.rank
}
function cardBeats(defCard: Card, atkCard: Card, trumpSuit: Suit): boolean {
  const d = parseCard(defCard)
  const a = parseCard(atkCard)
  if (!d || !a) return false
  if (d.suit === a.suit) return d.rank > a.rank
  if (d.suit === trumpSuit && a.suit !== trumpSuit) return true
  return false
}
function tableRanks(table: TablePair[]): Set<Rank> {
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
function attackRanksOnly(table: TablePair[]): Set<Rank> {
  const set = new Set<Rank>()
  for (const p of table) {
    const a = parseCard(p.a)
    if (a) set.add(a.rank)
  }
  return set
}
function isNeedDefense(table: TablePair[]): boolean {
  return table.some((p) => !p.d)
}
function isFullyDefended(table: TablePair[]): boolean {
  return table.length > 0 && table.every((p) => !!p.d)
}
function removeCard(hand: Card[], card: Card): boolean {
  const idx = hand.indexOf(card)
  if (idx === -1) return false
  hand.splice(idx, 1)
  return true
}
function lowestTrumpRank(hand: Card[], trumpSuit: Suit): Rank | null {
  let best: Rank | null = null
  for (const c of hand) {
    const p = parseCard(c)
    if (!p) continue
    if (p.suit !== trumpSuit) continue
    if (best === null || p.rank < best) best = p.rank
  }
  return best
}
function nextActiveId(order: string[], active: Record<string, boolean>, fromId: string): string {
  const n = order.length
  const start = order.indexOf(fromId)
  if (start === -1) return order[0]
  for (let k = 1; k <= n; k++) {
    const idx = (start + k) % n
    const id = order[idx]
    if (active[id]) return id
  }
  return fromId
}
function listAttackers(order: string[], active: Record<string, boolean>, defenderId: string): string[] {
  return order.filter((id) => active[id] && id !== defenderId)
}

function drawUpTo6(game: GameState, drawOrder: string[]) {
  for (const pid of drawOrder) {
    const hand = game.hands[pid]
    while (hand.length < 6 && game.deck.length > 0) {
      const c = game.deck.pop()!
      hand.push(c)
    }
    hand.sort(sortBySuitThenRank)
  }
}
function pruneOutPlayers(game: GameState) {
  if (game.deck.length > 0) return
  for (const id of game.order) {
    if (!game.active[id]) continue
    if (game.hands[id].length === 0) game.active[id] = false
  }
  const alive = game.order.filter((id) => game.active[id])
  if (alive.length === 1) {
    game.phase = "finished"
    game.loser = alive[0]
    game.winner = "OTHERS"
  } else if (alive.length === 0) {
    game.phase = "finished"
    game.loser = null
    game.winner = "DRAW"
  }
}

/* --------------------------- Worker --------------------------- */

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url)

    if (request.method === "OPTIONS") return new Response(null, { status: 204 })

    if (url.pathname === "/") return new Response("OK", { status: 200 })

    if (url.pathname === "/mini") {
      return new Response(MINI_HTML, { headers: { "content-type": "text/html; charset=utf-8" } })
    }

    if (url.pathname.startsWith("/ws/")) {
      const roomId = url.pathname.slice("/ws/".length)
      if (!roomId) return bad(400, "roomId missing")
      const stub = env.ROOM.get(env.ROOM.idFromName(roomId))
      return stub.fetch(request)
    }

    if (url.pathname === "/env-check") {
      return json({
        ok: true,
        hasBOT_TOKEN: !!env.BOT_TOKEN,
        botTokenLen: env.BOT_TOKEN?.length ?? 0,
        hasAPP_SECRET: !!env.APP_SECRET,
        appSecretLen: env.APP_SECRET?.length ?? 0,
        hasDB: !!env.DB,
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

    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 })

    try {
      await ensureSchema(env)

      // POST /api/auth/telegram
      if (url.pathname === "/api/auth/telegram" && request.method === "POST") {
        if (!env.BOT_TOKEN) return bad(500, "BOT_TOKEN is not set")
        if (!env.APP_SECRET) return bad(500, "APP_SECRET is not set")

        const body = (await request.json().catch(() => ({}))) as { initData?: string }
        const initData = String(body.initData ?? "")

        const v = await validateTelegramInitData(initData, env.BOT_TOKEN)
        if (!v.ok) return bad(401, v.error || "auth failed")

        await upsertUser(env, v.user)

        const now = Date.now()
        const payload: SessionPayload = {
          tg_id: String(v.user.id),
          first_name: v.user.first_name ?? "",
          username: v.user.username ?? "",
          iat: now,
          exp: now + 2 * 60 * 60 * 1000,
        }

        const sessionToken = await signSession(payload, env.APP_SECRET)
        return ok({
          sessionToken,
          user: { id: v.user.id, first_name: v.user.first_name, username: v.user.username },
        })
      }

      // POST /api/room/create
      if (url.pathname === "/api/room/create" && request.method === "POST") {
        const token = getBearer(request)
        const session = await verifySession(token, env.APP_SECRET)
        if (!session) return bad(401, "invalid session")
        if (session.exp < Date.now()) return bad(401, "session expired")

        const body = (await request.json().catch(() => ({}))) as Partial<RoomConfig>
        const mode: Mode = body.mode === "perevodnoy" ? "perevodnoy" : "podkidnoy"
        const deckSize: DeckSize = body.deckSize === 24 ? 24 : 36
        const maxPlayers: 2 | 3 | 4 =
          body.maxPlayers === 3 ? 3 : body.maxPlayers === 4 ? 4 : 2

        const roomId = crypto.randomUUID()
        const hostId = String(session.tg_id)

        const config: RoomConfig = { mode, deckSize, maxPlayers }
        const meta: RoomMeta = { roomId, hostId, config, createdAt: Date.now() }

        const stub = env.ROOM.get(env.ROOM.idFromName(roomId))
        const initRes = await stub.fetch("https://room/init-lobby", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            meta,
            host: {
              id: hostId,
              name: session.first_name || "Player",
              username: session.username || "",
            },
          }),
        })
        const initData = await initRes.json().catch(() => null)
        if (!initRes.ok) return json(initData || { ok: false, error: "room init failed" }, initRes.status)

        return ok({ roomId, wsUrl: `/ws/${roomId}`, config })
      }

      return bad(404, "route not found")
    } catch (e: any) {
      return bad(500, "worker error", { detail: String(e?.message || e) })
    }
  },
}

/* --------------------------- RoomDO: WS protocol types --------------------------- */

type ClientMsg =
  | { type: "JOIN"; sessionToken: string }
  | { type: "READY"; ready: boolean }
  | { type: "START" }
  | { type: "ATTACK"; card: Card }
  | { type: "DEFEND"; attackIndex: number; card: Card }
  | { type: "TRANSFER"; card: Card }
  | { type: "TAKE" }
  | { type: "BEAT" }
  | { type: "PASS" }
  | { type: string; [k: string]: any }

type ServerMsg =
  | { type: "STATE"; state: any }
  | { type: "INFO"; message: string }
  | { type: "ERROR"; code: string; detail?: string; [k: string]: any }

/* --------------------------- RoomDO: “controllers” inside DO --------------------------- */

class LobbyController {
  constructor(private doRef: RoomDO) {}

  async onReady(playerId: string, ready: boolean) {
    const p = this.doRef.lobbyPlayers.find((x) => x.id === playerId)
    if (!p) return this.doRef.sendErrTo(playerId, "NOT_IN_ROOM")
    p.ready = !!ready
    p.connected = true
    await this.doRef.persist()
    this.doRef.broadcastStates()
  }

  async onStart(playerId: string) {
    const meta = this.doRef.meta
    if (!meta) return this.doRef.sendErrTo(playerId, "ROOM_NOT_FOUND")
    if (playerId !== meta.hostId) return this.doRef.sendErrTo(playerId, "ONLY_HOST_CAN_START")
    if (this.doRef.lobbyPlayers.length < 2) return this.doRef.sendErrTo(playerId, "NEED_2_PLAYERS")
    if (!this.doRef.lobbyPlayers.every((p) => p.ready)) return this.doRef.sendErrTo(playerId, "NOT_ALL_READY")

    this.doRef.startGame()
    if (!this.doRef.game) return this.doRef.sendErrTo(playerId, "START_FAILED")

    this.doRef.phase = "playing"
    await this.doRef.persist()
    this.doRef.broadcast({ type: "INFO", message: "Game started!" })
    this.doRef.broadcastStates()
  }
}

class GameController {
  constructor(private doRef: RoomDO) {}

  private allAttackersPassed(g: GameState): boolean {
    const attackers = listAttackers(g.order, g.active, g.defenderId)
    return attackers.every((id) => g.passed.includes(id))
  }

  private resetRoundVars(g: GameState) {
    g.passed = []
    g.takeDeclared = false
    g.roundLimit = g.hands[g.defenderId].length
  }

  private endRoundTake(g: GameState) {
    const taken: Card[] = []
    for (const p of g.table) {
      taken.push(p.a)
      if (p.d) taken.push(p.d)
    }
    g.hands[g.defenderId].push(...taken)
    g.hands[g.defenderId].sort(sortBySuitThenRank)
    g.table = []

    // draw order: attacker -> around -> defender last
    const drawOrder: string[] = []
    let cur = g.attackerId
    drawOrder.push(cur)
    while (true) {
      const nxt = nextActiveId(g.order, g.active, cur)
      if (nxt === g.defenderId) {
        drawOrder.push(nxt)
        break
      }
      drawOrder.push(nxt)
      cur = nxt
      if (drawOrder.length > g.order.length + 2) break
    }
    drawUpTo6(g, drawOrder)

    const oldDef = g.defenderId
    const newDef = nextActiveId(g.order, g.active, oldDef)
    g.defenderId = newDef

    pruneOutPlayers(g)
    if (g.phase === "finished") return

    if (!g.active[g.attackerId]) g.attackerId = nextActiveId(g.order, g.active, g.attackerId)
    if (!g.active[g.defenderId]) g.defenderId = nextActiveId(g.order, g.active, g.defenderId)
    if (g.defenderId === g.attackerId) g.defenderId = nextActiveId(g.order, g.active, g.attackerId)

    this.resetRoundVars(g)
    g.updatedAt = Date.now()
  }

  private endRoundBeat(g: GameState) {
    for (const p of g.table) {
      g.discard.push(p.a)
      if (p.d) g.discard.push(p.d)
    }
    g.table = []

    // draw order: attacker -> around -> defender last
    const drawOrder: string[] = []
    let cur = g.attackerId
    drawOrder.push(cur)
    while (true) {
      const nxt = nextActiveId(g.order, g.active, cur)
      if (nxt === g.defenderId) {
        drawOrder.push(nxt)
        break
      }
      drawOrder.push(nxt)
      cur = nxt
      if (drawOrder.length > g.order.length + 2) break
    }
    drawUpTo6(g, drawOrder)

    const oldDef = g.defenderId
    let newAtk = oldDef
    let newDef = nextActiveId(g.order, g.active, oldDef)

    pruneOutPlayers(g)
    if (g.phase === "finished") return

    if (!g.active[newAtk]) newAtk = nextActiveId(g.order, g.active, newAtk)
    if (!g.active[newDef]) newDef = nextActiveId(g.order, g.active, newDef)
    if (newDef === newAtk) newDef = nextActiveId(g.order, g.active, newAtk)

    g.attackerId = newAtk
    g.defenderId = newDef

    this.resetRoundVars(g)
    g.updatedAt = Date.now()
  }

  private validateAttack(g: GameState, playerId: string, card: Card): VResult {
    if (!g.active[playerId]) return { ok: false, code: "NOT_ACTIVE" }
    if (playerId === g.defenderId) return { ok: false, code: "DEFENDER_CANNOT_ATTACK" }
    if (g.passed.includes(playerId)) return { ok: false, code: "YOU_PASSED" }
    if (!g.hands[playerId].includes(card)) return { ok: false, code: "CARD_NOT_IN_HAND" }
    if (g.table.length >= g.roundLimit) return { ok: false, code: "ROUND_LIMIT" }

    const needDefense = isNeedDefense(g.table)
    const ranks = tableRanks(g.table)

    if (g.table.length === 0) {
      if (playerId !== g.attackerId) return { ok: false, code: "ONLY_MAIN_ATTACKER_STARTS" }
      return { ok: true }
    }

    const p = parseCard(card)
    if (!p) return { ok: false, code: "BAD_CARD" }
    if (!ranks.has(p.rank)) return { ok: false, code: "RANK_NOT_ON_TABLE" }
    if (!g.takeDeclared && needDefense) return { ok: false, code: "DEFENDER_MUST_RESPOND" }

    return { ok: true }
  }

  private validateDefend(g: GameState, card: Card, attackIndex: number): VResult {
    if (attackIndex < 0 || attackIndex >= g.table.length) return { ok: false, code: "BAD_ATTACK_INDEX" }
    const pair = g.table[attackIndex]
    if (pair.d) return { ok: false, code: "ALREADY_DEFENDED" }
    if (!g.hands[g.defenderId].includes(card)) return { ok: false, code: "CARD_NOT_IN_HAND" }
    if (!cardBeats(card, pair.a, g.trumpSuit)) return { ok: false, code: "DOES_NOT_BEAT" }
    return { ok: true }
  }

  private validateTransfer(g: GameState, card: Card): VResult {
    if (g.config.mode !== "perevodnoy") return { ok: false, code: "MODE_NOT_PEREVODNOY" }
    if (g.takeDeclared) return { ok: false, code: "TAKE_ALREADY_DECLARED" }
    if (g.table.length === 0) return { ok: false, code: "NOTHING_TO_TRANSFER" }
    if (g.table.some((p) => p.d)) return { ok: false, code: "CANNOT_TRANSFER_AFTER_DEFEND" }
    if (!g.hands[g.defenderId].includes(card)) return { ok: false, code: "CARD_NOT_IN_HAND" }

    const p = parseCard(card)
    if (!p) return { ok: false, code: "BAD_CARD" }
    const ranks = attackRanksOnly(g.table)
    if (!ranks.has(p.rank)) return { ok: false, code: "RANK_MUST_MATCH_ATTACK" }

    return { ok: true }
  }

  async onPass(playerId: string, g: GameState) {
    if (playerId === g.defenderId) return this.doRef.sendErrTo(playerId, "DEFENDER_CANNOT_PASS")
    if (g.table.length === 0) return this.doRef.sendErrTo(playerId, "NOTHING_ON_TABLE")

    if (!g.passed.includes(playerId)) g.passed.push(playerId)
    g.updatedAt = Date.now()

    if (g.takeDeclared && this.allAttackersPassed(g)) {
      this.endRoundTake(g)
      await this.doRef.persist()
      this.doRef.broadcastStates()
      return
    }

    await this.doRef.persist()
    this.doRef.broadcastStates()
  }

  async onTake(playerId: string, g: GameState) {
    if (playerId !== g.defenderId) return this.doRef.sendErrTo(playerId, "ONLY_DEFENDER_CAN_TAKE")
    if (g.table.length === 0) return this.doRef.sendErrTo(playerId, "NOTHING_ON_TABLE")

    g.takeDeclared = true
    g.passed = []
    g.updatedAt = Date.now()

    await this.doRef.persist()
    this.doRef.broadcastStates()
  }

  async onBeat(playerId: string, g: GameState) {
    if (playerId !== g.defenderId) return this.doRef.sendErrTo(playerId, "ONLY_DEFENDER_CAN_BEAT")
    if (!isFullyDefended(g.table)) return this.doRef.sendErrTo(playerId, "NOT_FULLY_DEFENDED")
    if (!this.allAttackersPassed(g)) return this.doRef.sendErrTo(playerId, "ATTACKERS_NOT_PASSED")

    this.endRoundBeat(g)
    await this.doRef.persist()
    this.doRef.broadcastStates()
  }

  async onTransfer(playerId: string, g: GameState, card: Card) {
    if (playerId !== g.defenderId) return this.doRef.sendErrTo(playerId, "ONLY_DEFENDER_CAN_TRANSFER")
    const v = this.validateTransfer(g, card)
    if (!v.ok) return this.doRef.sendErrTo(playerId, v.code)

    removeCard(g.hands[g.defenderId], card)
    g.table.push({ a: card, d: null })

    const oldDef = g.defenderId
    const newDef = nextActiveId(g.order, g.active, oldDef)
    g.attackerId = oldDef
    g.defenderId = newDef
    g.roundLimit = g.hands[newDef].length
    g.passed = []
    g.takeDeclared = false
    g.updatedAt = Date.now()

    await this.doRef.persist()
    this.doRef.broadcastStates()
  }

  async onDefend(playerId: string, g: GameState, attackIndexRaw: any, card: Card) {
    if (playerId !== g.defenderId) return this.doRef.sendErrTo(playerId, "ONLY_DEFENDER_CAN_DEFEND")
    if (g.takeDeclared) return this.doRef.sendErrTo(playerId, "TAKE_ALREADY_DECLARED")

    const attackIndex = typeof attackIndexRaw === "number" ? attackIndexRaw : Number(attackIndexRaw)
    if (!Number.isInteger(attackIndex)) return this.doRef.sendErrTo(playerId, "BAD_ATTACK_INDEX")

    const v = this.validateDefend(g, card, attackIndex)
    if (!v.ok) return this.doRef.sendErrTo(playerId, v.code)

    removeCard(g.hands[g.defenderId], card)
    g.table[attackIndex].d = card
    g.updatedAt = Date.now()

    await this.doRef.persist()
    this.doRef.broadcastStates()
  }

  async onAttack(playerId: string, g: GameState, card: Card) {
    const v = this.validateAttack(g, playerId, card)
    if (!v.ok) return this.doRef.sendErrTo(playerId, v.code)

    removeCard(g.hands[playerId], card)
    g.table.push({ a: card, d: null })
    g.updatedAt = Date.now()

    await this.doRef.persist()
    this.doRef.broadcastStates()
  }
}

/* --------------------------- Durable Object: RoomDO --------------------------- */

export class RoomDO {
  private state: DurableObjectState
  private env: Env

  // persisted
  meta: RoomMeta | null = null
  lobbyPlayers: LobbyPlayer[] = []
  phase: RoomPhase = "lobby"
  game: GameState | null = null

  // runtime
  private loaded = false
  private sockets = new Map<string, WebSocket>() // tg_id -> ws
  private lobbyCtl = new LobbyController(this)
  private gameCtl = new GameController(this)

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  /* ----- persistence ----- */

  private async loadOnce() {
    if (this.loaded) return
    this.meta = (await this.state.storage.get<RoomMeta>("meta")) ?? null
    this.lobbyPlayers = (await this.state.storage.get<LobbyPlayer[]>("lobbyPlayers")) ?? []
    this.phase = (await this.state.storage.get<RoomPhase>("phase")) ?? "lobby"
    this.game = (await this.state.storage.get<GameState>("game")) ?? null
    this.loaded = true
  }

  async persist() {
    if (this.meta) await this.state.storage.put("meta", this.meta)
    await this.state.storage.put("lobbyPlayers", this.lobbyPlayers)
    await this.state.storage.put("phase", this.phase)
    if (this.game) await this.state.storage.put("game", this.game)
  }

  /* ----- WS send helpers ----- */

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {}
  }
  sendErrTo(tgId: string, code: string, detail?: string, extra?: any) {
    const ws = this.sockets.get(tgId)
    if (!ws) return
    this.send(ws, { type: "ERROR", code, detail, ...(extra || {}) })
  }
  broadcast(msg: ServerMsg) {
    const s = JSON.stringify(msg)
    for (const ws of this.sockets.values()) {
      try {
        ws.send(s)
      } catch {}
    }
  }

  /* ----- state helpers ----- */

  private playerName(id: string): string {
    const p = this.lobbyPlayers.find((x) => x.id === id)
    return p?.name || id
  }

  private ensureLobbyPlayer(session: SessionPayload) {
    const id = String(session.tg_id)
    const name = session.first_name || "Player"
    const username = session.username || ""

    const p = this.lobbyPlayers.find((x) => x.id === id)
    if (p) {
      p.name = name
      p.username = username
      p.connected = true
      return p
    }

    const np: LobbyPlayer = { id, name, username, connected: true, ready: false }
    this.lobbyPlayers.push(np)
    return np
  }

  startGame() {
    if (!this.meta) return
    const config = this.meta.config
    const players = this.lobbyPlayers.map((p) => p.id).slice(0, config.maxPlayers)
    if (players.length < 2) return

    const order = players.slice()
    const active: Record<string, boolean> = {}
    const hands: Record<string, Card[]> = {}
    for (const id of order) {
      active[id] = true
      hands[id] = []
    }

    const deck = shuffle(createDeck(config.deckSize))
    const trumpCard = deck[0]
    const trumpSuit = parseCard(trumpCard)!.suit

    // deal 6 each from end
    for (let i = 0; i < 6; i++) {
      for (const pid of order) {
        const c = deck.pop()
        if (c) hands[pid].push(c)
      }
    }
    for (const pid of order) hands[pid].sort(sortBySuitThenRank)

    // first attacker = lowest trump (else order[0])
    let attackerId = order[0]
    let best: Rank | null = null
    let bestId: string | null = null
    for (const pid of order) {
      const r = lowestTrumpRank(hands[pid], trumpSuit)
      if (r === null) continue
      if (best === null || r < best) {
        best = r
        bestId = pid
      }
    }
    if (bestId) attackerId = bestId

    const defenderId = nextActiveId(order, active, attackerId)

    this.game = {
      phase: "playing",
      roomId: this.meta.roomId,
      config,
      order,
      active,
      deck,
      trumpSuit,
      trumpCard,
      hands,
      table: [],
      discard: [],
      attackerId,
      defenderId,
      roundLimit: hands[defenderId].length,
      passed: [],
      takeDeclared: false,
      winner: null,
      loser: null,
      updatedAt: Date.now(),
    }
  }

  private buildStateFor(playerId: string) {
    if (!this.meta) return { phase: "lobby", roomId: null }

    if (this.phase === "lobby") {
      return {
        phase: "lobby",
        roomId: this.meta.roomId,
        hostId: this.meta.hostId,
        config: this.meta.config,
        you: playerId,
        players: this.lobbyPlayers.map((p) => ({
          id: p.id,
          name: p.name,
          username: p.username || "",
          ready: p.ready,
          connected: p.connected,
        })),
      }
    }

    const g = this.game
    if (!g) return { phase: this.phase, roomId: this.meta.roomId, error: "game missing" }

    const youHand = (g.hands[playerId] || []).slice()
    const others = g.order
      .filter((id) => id !== playerId)
      .map((id) => ({
        id,
        name: this.playerName(id),
        active: g.active[id],
        count: (g.hands[id] || []).length,
      }))

    const attackers = listAttackers(g.order, g.active, g.defenderId)
    const needDefense = isNeedDefense(g.table)
    const ranksOnTable = tableRanks(g.table)

    const allowed = {
      ready: false,
      start: false,
      attack: false,
      defend: false,
      transfer: false,
      take: false,
      beat: false,
      pass: false,
    }

    if (g.phase === "playing") {
      const youActive = !!g.active[playerId]
      if (youActive) {
        if (playerId === g.defenderId) {
          if (!g.takeDeclared) {
            allowed.defend = needDefense
            allowed.take = g.table.length > 0
            allowed.transfer =
              g.config.mode === "perevodnoy" &&
              g.table.length > 0 &&
              !g.table.some((p) => p.d)
          }
          allowed.beat = isFullyDefended(g.table) && attackers.every((id) => g.passed.includes(id))
        } else {
          const hasPassed = g.passed.includes(playerId)
          allowed.pass = g.table.length > 0 && !hasPassed

          if (!hasPassed) {
            if (g.table.length === 0) {
              allowed.attack = playerId === g.attackerId
            } else {
              const canByRankAny = (hand: Card[]) =>
                hand.some((card) => {
                  const p = parseCard(card)
                  return !!p && ranksOnTable.has(p.rank)
                })
              allowed.attack = canByRankAny(youHand)
              if (!g.takeDeclared && needDefense) allowed.attack = false
            }
          }
        }
      }
    }

    return {
      phase: g.phase,
      roomId: g.roomId,
      config: g.config,
      you: playerId,
      order: g.order.map((id) => ({ id, name: this.playerName(id), active: g.active[id] })),
      attackerId: g.attackerId,
      defenderId: g.defenderId,
      attackerName: this.playerName(g.attackerId),
      defenderName: this.playerName(g.defenderId),
      deckCount: g.deck.length,
      trumpSuit: g.trumpSuit,
      trumpCard: g.trumpCard,
      yourHand: youHand,
      others,
      table: g.table,
      discardCount: g.discard.length,
      passed: g.passed,
      takeDeclared: g.takeDeclared,
      needDefense,
      roundLimit: g.roundLimit,
      allowed,
      loser: g.loser,
      updatedAt: g.updatedAt,
    }
  }

  broadcastStates() {
    for (const [tgId] of this.sockets.entries()) {
      const st = this.buildStateFor(tgId)
      const ws = this.sockets.get(tgId)
      if (ws) this.send(ws, { type: "STATE", state: st })
    }
  }

  /* ----- Durable Object fetch ----- */

  async fetch(request: Request) {
    await this.loadOnce()
    const url = new URL(request.url)

    // init lobby
    if (url.pathname === "/init-lobby" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        meta?: RoomMeta
        host?: { id: string; name: string; username?: string }
      }
      if (!body.meta || !body.host) return bad(400, "bad init-lobby")

      this.meta = body.meta
      this.phase = "lobby"
      this.game = null
      this.lobbyPlayers = [
        {
          id: String(body.host.id),
          name: body.host.name || "Host",
          username: body.host.username || "",
          connected: false,
          ready: false,
        },
      ]
      await this.persist()
      return ok({ roomId: this.meta.roomId })
    }

    // websocket only
    if (request.headers.get("Upgrade") !== "websocket") return bad(426, "Expected websocket")

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()

    let boundId: string | null = null

    const sendErr = (code: string, detail?: string, extra?: any) => {
      this.send(server, { type: "ERROR", code, detail, ...(extra || {}) })
    }

    server.addEventListener("message", (ev) => {
      this.state.waitUntil(
        (async () => {
          let msg: ClientMsg
          try {
            msg = JSON.parse(String(ev.data))
          } catch {
            sendErr("BAD_JSON")
            return
          }

          // JOIN
          if (msg.type === "JOIN") {
            if (!this.meta) {
              sendErr("ROOM_NOT_FOUND")
              try { server.close(1008, "Room not found") } catch {}
              return
            }

            const token = String((msg as any).sessionToken ?? "")
            const session = await verifySession(token, this.env.APP_SECRET)
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
            boundId = tgId

            // replace old socket for same user
            const prev = this.sockets.get(tgId)
            if (prev && prev !== server) {
              try { prev.close(1012, "Replaced") } catch {}
            }
            this.sockets.set(tgId, server)

            if (this.phase === "lobby") {
              if (this.lobbyPlayers.length >= this.meta.config.maxPlayers) {
                const exists = this.lobbyPlayers.some((p) => p.id === tgId)
                if (!exists) {
                  sendErr("ROOM_FULL")
                  try { server.close(1008, "Room full") } catch {}
                  return
                }
              }
              this.ensureLobbyPlayer(session).connected = true
              await this.persist()
              this.broadcastStates()
              return
            }

            if (!this.game || !this.game.order.includes(tgId)) {
              sendErr("NOT_IN_GAME")
              try { server.close(1008, "Not in game") } catch {}
              return
            }

            await this.persist()
            this.broadcastStates()
            return
          }

          // must be joined
          if (!boundId) {
            sendErr("NOT_JOINED")
            return
          }
          if (!this.meta) {
            sendErr("ROOM_NOT_FOUND")
            return
          }

          // LOBBY
          if (this.phase === "lobby") {
            if (msg.type === "READY") return this.lobbyCtl.onReady(boundId, !!(msg as any).ready)
            if (msg.type === "START") return this.lobbyCtl.onStart(boundId)
            sendErr("UNKNOWN_LOBBY_MSG")
            return
          }

          // GAME
          if (!this.game) {
            sendErr("GAME_NOT_READY")
            return
          }
          const g = this.game

          if (g.phase === "finished") {
            this.broadcastStates()
            sendErr("GAME_FINISHED", undefined, { loser: g.loser })
            return
          }

          if (!g.active[boundId]) {
            sendErr("YOU_ARE_OUT")
            this.broadcastStates()
            return
          }

          if (msg.type === "PASS") return this.gameCtl.onPass(boundId, g)
          if (msg.type === "TAKE") return this.gameCtl.onTake(boundId, g)
          if (msg.type === "BEAT") return this.gameCtl.onBeat(boundId, g)
          if (msg.type === "TRANSFER") return this.gameCtl.onTransfer(boundId, g, String((msg as any).card ?? ""))
          if (msg.type === "DEFEND") return this.gameCtl.onDefend(boundId, g, (msg as any).attackIndex, String((msg as any).card ?? ""))
          if (msg.type === "ATTACK") return this.gameCtl.onAttack(boundId, g, String((msg as any).card ?? ""))

          sendErr("UNKNOWN_MSG")
        })()
      )
    })

    server.addEventListener("close", () => {
      if (!boundId) return
      const ws = this.sockets.get(boundId)
      if (ws === server) this.sockets.delete(boundId)

      const p = this.lobbyPlayers.find((x) => x.id === boundId)
      if (p) p.connected = false

      this.state.waitUntil(
        (async () => {
          await this.persist()
          this.broadcastStates()
        })()
      )
    })

    return new Response(null, { status: 101, webSocket: client })
  }
}

/* --------------------------- Mini HTML UI --------------------------- */

const MINI_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Durak 2-4</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    body{font-family:system-ui,sans-serif;padding:14px}
    h2{margin:6px 0 10px}
    .row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
    button, select, input{padding:10px 12px;font-size:14px;border-radius:12px;border:1px solid #ddd;background:#fff}
    button{cursor:pointer}
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
  <h2>Durak 2–4 (Invite Rooms)</h2>

  <div class="box">
    <div class="row">
      <button id="btnAuth">1) Auth</button>
      <button id="btnCreate" disabled>2) Create room</button>
    </div>
    <div class="row">
      <label>Mode:
        <select id="mode">
          <option value="podkidnoy">podkidnoy</option>
          <option value="perevodnoy">perevodnoy</option>
        </select>
      </label>
      <label>Deck:
        <select id="deck">
          <option value="36">36</option>
          <option value="24">24</option>
        </select>
      </label>
      <label>Players:
        <select id="maxPlayers">
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
        </select>
      </label>
    </div>
    <div class="row">
      <input id="roomInput" placeholder="roomId (paste to join)" style="min-width:320px"/>
      <button id="btnConnect" disabled>3) Connect WS</button>
    </div>
    <div class="small">Создал комнату → скопируй roomId → отправь друзьям → они вставят и подключатся.</div>
  </div>

  <div class="box">
    <div class="row">
      <button id="btnReady" disabled>READY</button>
      <button id="btnStart" disabled>START (host)</button>
      <button id="btnPass" disabled>PASS</button>
      <button id="btnTake" disabled>TAKE</button>
      <button id="btnBeat" disabled>BEAT</button>
      <button id="btnTransfer" disabled>TRANSFER (select card)</button>
    </div>
    <div class="small">DEFEND: click A# on table, then click a card in hand.</div>
  </div>

  <div class="box">
    <div class="kv">
      <div><b>Room</b> <span id="room">-</span></div>
      <div><b>You</b> <span id="you">-</span></div>
      <div><b>Phase</b> <span id="phase">-</span></div>
      <div><b>Trump</b> <span id="trump">-</span></div>
      <div><b>Att</b> <span id="att">-</span></div>
      <div><b>Def</b> <span id="def">-</span></div>
      <div><b>Status</b> <span id="status">-</span></div>
    </div>
  </div>

  <div class="box">
    <div><b>Players / Others</b></div>
    <pre id="players">-</pre>
  </div>

  <div class="box">
    <div><b>Table</b></div>
    <div id="table" class="row"></div>
  </div>

  <div class="box">
    <div><b>Your hand</b></div>
    <div id="hand" class="row"></div>
  </div>

  <pre id="log">Open inside Telegram WebApp.</pre>

<script>
  const logEl = document.getElementById("log");
  const roomEl = document.getElementById("room");
  const youEl = document.getElementById("you");
  const phaseEl = document.getElementById("phase");
  const trumpEl = document.getElementById("trump");
  const attEl = document.getElementById("att");
  const defEl = document.getElementById("def");
  const statusEl = document.getElementById("status");
  const playersEl = document.getElementById("players");

  const tableEl = document.getElementById("table");
  const handEl = document.getElementById("hand");

  const btnAuth = document.getElementById("btnAuth");
  const btnCreate = document.getElementById("btnCreate");
  const btnConnect = document.getElementById("btnConnect");
  const btnReady = document.getElementById("btnReady");
  const btnStart = document.getElementById("btnStart");
  const btnPass = document.getElementById("btnPass");
  const btnTake = document.getElementById("btnTake");
  const btnBeat = document.getElementById("btnBeat");
  const btnTransfer = document.getElementById("btnTransfer");

  const modeSel = document.getElementById("mode");
  const deckSel = document.getElementById("deck");
  const maxPlayersSel = document.getElementById("maxPlayers");
  const roomInput = document.getElementById("roomInput");

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

  function wsSend(obj){
    if (!ws || ws.readyState !== 1) { log("WS not connected"); return; }
    log("WS ->", obj);
    ws.send(JSON.stringify(obj));
  }

  function renderState(st){
    lastState = st;
    roomEl.textContent = st.roomId || "-";
    youEl.textContent = st.you || "-";
    phaseEl.textContent = st.phase || "-";
    trumpEl.textContent = st.trumpSuit ? (st.trumpSuit + " (" + st.trumpCard + ")") : "-";
    attEl.textContent = st.attackerName ? (st.attackerName + " [" + st.attackerId + "]") : "-";
    defEl.textContent = st.defenderName ? (st.defenderName + " [" + st.defenderId + "]") : "-";

    if (st.phase === "lobby"){
      playersEl.textContent = JSON.stringify(st.players || [], null, 2);
      btnReady.disabled = false;
      btnStart.disabled = !(st.hostId === st.you);
      btnPass.disabled = true;
      btnTake.disabled = true;
      btnBeat.disabled = true;
      btnTransfer.disabled = true;
      tableEl.innerHTML = "";
      handEl.innerHTML = "";
      setStatus("Lobby: READY then host START");
      return;
    }

    playersEl.textContent = JSON.stringify({ order: st.order, others: st.others }, null, 2);

    const a = (st.allowed || {});
    btnReady.disabled = true;
    btnStart.disabled = true;
    btnPass.disabled = !a.pass;
    btnTake.disabled = !a.take;
    btnBeat.disabled = !a.beat;
    btnTransfer.disabled = !a.transfer;

    setStatus("deck=" + st.deckCount + " table=" + (st.table?st.table.length:0) + " needDefense=" + st.needDefense);

    tableEl.innerHTML = "";
    selectedAttackIndex = (selectedAttackIndex !== null && st.table && st.table[selectedAttackIndex]) ? selectedAttackIndex : null;
    (st.table || []).forEach((p, idx) => {
      const btn = document.createElement("button");
      btn.className = "cardbtn" + (selectedAttackIndex === idx ? " sel" : "");
      btn.textContent = "A" + idx + ": " + p.a + " -> " + (p.d || "??");
      btn.onclick = () => { selectedAttackIndex = idx; renderState(lastState); };
      tableEl.appendChild(btn);
    });

    handEl.innerHTML = "";
    (st.yourHand || []).forEach((c) => {
      const btn = document.createElement("button");
      btn.className = "cardbtn" + (selectedCard === c ? " sel" : "");
      btn.textContent = c;
      btn.onclick = () => {
        selectedCard = c;

        if (st.you === st.defenderId && selectedAttackIndex !== null && st.allowed && st.allowed.defend){
          wsSend({ type:"DEFEND", attackIndex:selectedAttackIndex, card:c });
        } else {
          wsSend({ type:"ATTACK", card:c });
        }

        renderState(lastState);
      };
      handEl.appendChild(btn);
    });
  }

  btnAuth.onclick = async () => {
    try{
      const initData = String(window.Telegram?.WebApp?.initData ?? "");
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
        btnCreate.disabled = false;
        btnConnect.disabled = false;
        log("Auth OK. sessionToken saved.");
      }
    }catch(e){
      setLog("Auth error: " + (e?.message || String(e)));
    }
  };

  btnCreate.onclick = async () => {
    try{
      if (!sessionToken) { log("Auth first"); return; }
      const payload = {
        mode: modeSel.value,
        deckSize: Number(deckSel.value),
        maxPlayers: Number(maxPlayersSel.value)
      };
      log("Creating room...", payload);
      const r = await fetch("/api/room/create", {
        method:"POST",
        headers:{
          "content-type":"application/json",
          "authorization":"Bearer " + sessionToken
        },
        body: JSON.stringify(payload)
      });
      const data = await r.json();
      log(data);
      if (data.ok && data.roomId){
        roomId = data.roomId;
        roomInput.value = roomId;
        log("Room created. Share roomId:", roomId);
      }
    }catch(e){
      log("Create error:", e?.message || String(e));
    }
  };

  btnConnect.onclick = async () => {
    try{
      if (!sessionToken) { log("Auth first"); return; }
      roomId = roomInput.value.trim();
      if (!roomId) { log("Paste roomId"); return; }

      const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/" + roomId;
      log("Connecting WS:", wsUrl);

      if (ws) { try{ ws.close(); }catch{} ws=null; }

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        log("WS open. JOIN...");
        ws.send(JSON.stringify({ type:"JOIN", sessionToken }));
      };

      ws.onmessage = (ev) => {
        try{
          const obj = JSON.parse(String(ev.data));
          log("WS <-", obj);
          if (obj.type === "STATE") renderState(obj.state);
          if (obj.type === "INFO") setStatus(obj.message || "INFO");
          if (obj.type === "ERROR") setStatus("ERROR: " + obj.code);
        }catch{
          log("WS <- raw", String(ev.data));
        }
      };

      ws.onclose = (ev) => log("WS close:", { code: ev.code, reason: ev.reason });
      ws.onerror = () => log("WS error");
    }catch(e){
      log("Connect error:", e?.message || String(e));
    }
  };

  btnReady.onclick = () => wsSend({ type:"READY", ready:true });
  btnStart.onclick = () => wsSend({ type:"START" });
  btnPass.onclick = () => wsSend({ type:"PASS" });
  btnTake.onclick = () => wsSend({ type:"TAKE" });
  btnBeat.onclick = () => wsSend({ type:"BEAT" });
  btnTransfer.onclick = () => {
    if (!lastState?.allowed?.transfer) { log("TRANSFER not allowed"); return; }
    if (!selectedCard) { log("Select a card first"); return; }
    wsSend({ type:"TRANSFER", card:selectedCard });
  };
</script>
</body>
</html>`;
