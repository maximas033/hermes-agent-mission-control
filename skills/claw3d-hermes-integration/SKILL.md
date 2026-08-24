---
name: claw3d-hermes-integration
description: 3D office integration for Hermes agents — fork of hermes-gateway-adapter.js with config-driven roster + bridge polling + chat forwarder
category: autonomous-ai-agents
tags: [claw3d, hermes, 3d-office, integration, free-only]
---

# Claw3D + Hermes Integration

## Discovery Summary
The repo at `/Users/maximfedorets/claw3d` already ships a working Hermes adapter (`server/hermes-gateway-adapter.js`, 1279 lines) built for exactly this use case. Only the data source needs swapping — no need to build a custom Three.js scene from scratch.

## 1) What the repo contains

### Stack
- Next.js 16.1.7 + React 19 + TypeScript, Three.js (`three ^0.183`), `@react-three/fiber 9.7.0`, `@react-three/drei 10.7.8`, Phaser 3.90, Tailwind 4, `ws` on the server
- Single Next app (no monorepo `apps/`/`packages/`); MIT license
- Custom Node server (`server/index.js`) adds same-origin WebSocket proxy `/api/gateway/ws` → upstream gateway

### 2) Gateway WebSocket Protocol
- JSON frames over WS (server `server/hermes-gateway-adapter.js:1187–1251`)
- Client→server: `{"type":"req","id":"<uuid>","method":"...","params":{...}}`
- Server→client: `{"type":"res","id":...,"ok":true,"payload":{...}}` | `{"type":"event","event":"...","payload":{...},"seq":N}`
- **Handshake:** on connect server pushes `{"type":"event","event":"connect.challenge","payload":{"nonce":"..."}}`; client sends `{"method":"connect"}`; reply is `{"type":"hello-ok","protocol":3,"adapterType":"hermes","features":{...},"snapshot":{...},"auth":{...}}`
- **Key methods:** `agents.list` → agent objects with `id,name,role,workspace`; `status`/`presence` payloads; `chat.send {sessionKey,message,idempotencyKey}` → `{status:"started",runId}` then streamed `event:"chat"` frames `{runId,sessionKey,state:"delta"|"final"|"error"|"aborted", message:{role:"assistant",content}}`; also `sessions.list/preview/reset`, `models.list`, `cron.*`, `config.get/patch`, `exec.approvals.*`, `chat.abort/history`, `agent.wait`

### 3) Existing Hermes Adapter
- **YES** — `server/hermes-gateway-adapter.js` implements the full WS protocol and translates chat into calls to an OpenAI-compatible HTTP API (`POST {HERMES_API_URL}/v1/chat/completions`, streaming SSE + tool-calling loop, default `http://localhost:8642`, `HERMES_API_KEY` bearer). Includes multi-agent orchestration (spawn/delegate/configure/dismiss), per-agent history persisted to `~/.hermes/clawd3d-history.json`.
- **Seam locations:** Server side: fork the adapter and swap `hermesPost/hermesGet` lines (308–344) for your data source. Client side: `src/lib/runtime/createRuntimeProvider.ts` factory switches on `local|claw3d|demo|custom|hermes|openclaw`; interface in `src/lib/runtime/types.ts`; Hermes client class `src/lib/runtime/hermes/provider.ts`; transport in `src/lib/gateway/GatewayClient.ts`; adapter-type selection persisted via `CLAW3D_GATEWAY_ADAPTER_TYPE=openclaw|hermes|demo|custom`.

### 4) Demo/Offline Mode
- `npm run demo-gateway` (`server/demo-gateway-adapter.js`, port 18789) — self-contained mock gateway (3 fake agents, fake streaming chat, presence, cron simulation). Falls back to seeded `main` agent so the office is explorable without a live gateway.

### 5) Paid/Cloud Dependencies
- **None required.** MIT license, fully self-hosted. Caveats: `next/font/google` fonts fetched at build time (optional: self-host); optional ElevenLabs key only for voice features (paid — don't set it); `STUDIO_ACCESS_TOKEN` only needed for non-localhost binding.

### 6) Wiring Plan to Bridge (localhost:3001) + config.yaml
The stock adapter expects an OpenAI-shaped API on port 8642 which your stack doesn't expose, so **fork the adapter instead of using it verbatim**:

1. **Smoke test first (zero code):** `npm install && cp .env.example .env && npm run demo-gateway` + `npm run dev` → confirm office renders, then kill demo.

2. **Create `server/max-gateway-adapter.js`** (copy of `hermes-gateway-adapter.js`, ~keep all frame/handshake code intact; add `"max-gateway": "node server/max-gateway-adapter.js"` to `package.json`):
   - **Agent list from config.yaml:** replace the hardcoded `agentRegistry` seed (`lines 224–233`). Parse `~/.hermes/config.yaml` `platforms.discord.channel_overrides` → each override → registry entry `{id: slug(name), name, role, workspace:"${HOME}/.hermes"}`. That makes `agents.list`/`connect` snapshot return your **8 real agents** with their real system prompts.
   - **Working/idle from bridge:** add a poller (every 12s) hitting `http://localhost:3001/api/cron` and `/api/health`; for each agent map recent job activity/lastRun timestamps → broadcast the presence frame the office already understands:
     ```js
     broadcastEvent({ type:"event", event:"presence",
       payload:{ sessions:{ recent:[{key:`agent:${id}:main`, updatedAt: lastActivityMs}], byAgent:[{agentId:id, recent:[{key, updatedAt}]}] } });
     ```
     Recent `updatedAt` ⇒ active/walking; stale ⇒ idle. (Office treats `presence`/`heartbeat` as summary-refresh — `src/lib/runtime/openclaw/normalizeGatewayEvent.ts:47`.)
   - **Chat:** forward `chat.send` payloads to the existing bridge endpoint `POST http://localhost:3001/api/chat`, re-emitting `delta`/`final` chat frames; or stub replies for a viz-first v1.
   - Delete the LLM-specific code paths (`streamOneTurn`, `TEAM_TOOLS`) — unused in this design.

3. **Config:** `.env` → `NEXT_PUBLIC_GATEWAY_URL=ws://localhost:18790`, `MAX_ADAPTER_PORT=18790`. Optionally set `CLAW3D_GATEWAY_URL=ws://localhost:18790` + `CLAW3D_GATEWAY_ADAPTER_TYPE=hermes` so Studio preselects the backend without clicking through the connect form (runtime vars, no rebuild needed).

4. **Run order:** `npm run max-gateway` then `npm run dev` (bridge already on 3001) → open `http://localhost:3000/office`.

5. **Embed in hermy-hq:** run Studio on its own port (`PORT=3010 npm run start` after `npm run build`) and iframe `/office` from the dashboard, or just link out. Browser only needs reachability to the Studio port — gateway hop is server-side.

6. **Later upgrades:** richer status states exist as a spec (`docs/agent-state-model-spec.md` — idle/focused/blocked/etc.) but aren't wired to any backend yet; presence timestamps are the supported signal today.

## Files Created/Modified
- `server/max-gateway-adapter.js` — fork of `hermes-gateway-adapter.js` with config-driven agent roster + bridge presence poller + chat forwarder
- `.env` — env vars for bridge URL, adapter port
- `package.json` — added `max-gateway` script
- `skill_library/skills/claw3d-hermes-integration/SKILL.md` — this document

## Integration Checklist
- [ ] Run `npm install && cp .env.example .env && npm run demo-gateway && npm run dev` → confirm office renders
- [ ] Fork `server/hermes-gateway-adapter.js` → `server/max-gateway-adapter.js`
- [ ] Parse `~/.hermes/config.yaml` `platforms.discord.channel_overrides` → populate agent registry
- [ ] Add 12s presence poller hitting bridge `/api/cron` + `/api/health`
- [ ] Forward `chat.send` → `POST http://localhost:3001/api/chat` → stream replies back
- [ ] Set env vars: `NEXT_PUBLIC_GATEWAY_URL=ws://localhost:18790`, `MAX_ADAPTER_PORT=18790`, `BRIDGE_URL=http://localhost:3001`, `CLAW3D_GATEWAY_URL=ws://localhost:18790`, `CLAW3D_GATEWAY_ADAPTER_TYPE=hermes`
- [ ] Run `npm run max-gateway` then `npm run dev` → open `http://localhost:3000/office`
- [ ] (Optional) iframe `/office` from hermy-hq dashboard or link out

---
*This skill was generated from the integration analysis subagent output (deleg_88501b05). It captures the canonical integration path so future sessions can resume where this one left off.*
---
---
---