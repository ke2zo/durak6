export interface Env {
  DB: D1Database
  MM: DurableObjectNamespace
  ROOM: DurableObjectNamespace
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)

    if (url.pathname === "/") return new Response("OK")

    // Проверка, что MatchmakerDO реально работает
    if (url.pathname === "/do-test") {
      const id = env.MM.idFromName("global")
      const stub = env.MM.get(id)
      return stub.fetch("https://mm/ping")
    }

    // Проверка, что D1 работает
    if (url.pathname === "/d1-test") {
      await env.DB.exec(`INSERT OR IGNORE INTO users (tg_id, created_at, updated_at)
                         VALUES ('123', strftime('%s','now')*1000, strftime('%s','now')*1000)`)
      const r = await env.DB.prepare("SELECT COUNT(*) as c FROM users").first()
      return json({ ok: true, users: r?.c ?? 0 })
    }

    return new Response("Not found", { status: 404 })
  }
}

// Durable Objects

export class MatchmakerDO {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === "/ping") return new Response("MatchmakerDO alive")
    return new Response("MatchmakerDO")
  }
}

export class RoomDO {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === "/ping") return new Response("RoomDO alive")
    return new Response("RoomDO")
  }
}
