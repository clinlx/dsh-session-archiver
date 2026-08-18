// dsh-session-archiver — Host half (bootstrap row).
//
// A dynamic Cordis plugin is session-scoped and process-local, so it cannot
// survive a DSH restart on its own. This composed row listens for every
// agent's `agent/created` and (re)defines + (re)runs a HOST-ONLY dynamic
// plugin that carries the archive-management Host handlers. Because the
// dynamic plugin ships no client code, `dynamicCordisRunner.run` activates it
// WITHOUT an approval prompt — so a recipient who installed this package sees
// the UI immediately after restart, with no configuration and no approval.
//
// The browser UI lives in client.bundle.js (a static client bundle from this
// same package) and reaches these handlers through the public remote
// `ctx.remote.dynamicCordisRunner.invoke(...)`.

import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createPendingDeleteService, createPendingDeleteStore } from './pending-delete.mjs'

export const name = 'dsh-session-archiver'
export const inject = ['timer', 'workspaceRegistry', 'sessionPersistence', 'sessions']

const PLUGIN_NAME = 'Session Archiver v2'
const PLUGIN_PURPOSE = '查看归档会话、取消归档、删除会话（由 dsh-session-archiver 自动重建）'

// Dynamic Host code: the archive handlers. This runs inside the dynamic
// runner's sandbox where `harness.handle` is available.
export const HOST_CODE = `return {
  apply(ctx) {
    const registry = () => ctx.get('workspaceRegistry')
    const persistence = () => ctx.get('sessionPersistence')
    const sessionQuery = () => ctx.get('sessionQuery')
    const pendingStore = () => ctx.get('sessionArchiverPending')

    const archiveSession = async (sessionId) => {
      const reg = registry()
      if (reg !== undefined && typeof reg.archiveSession === 'function') {
        await reg.archiveSession(sessionId)
        return
      }
      throw new Error('workspace registry unavailable')
    }

    const unarchiveSession = async (sessionId) => {
      const reg = registry()
      if (reg !== undefined && typeof reg.enqueueOperation === 'function' && typeof reg.setState === 'function' && typeof reg.requireState === 'function') {
        await reg.enqueueOperation(() => {
          const state = reg.requireState()
          if (!state.archivedSessionIds.includes(sessionId)) return
          return reg.setState({ ...state, archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId) })
        })
        return
      }
      const storageDomain = ctx.get('storageDomain')
      const domain = storageDomain !== undefined && typeof storageDomain.get === 'function' ? storageDomain.get('workspace') : undefined
      if (domain === undefined || domain.global === undefined || typeof domain.global.set !== 'function') {
        throw new Error('workspace domain unavailable')
      }
      const state = domain.global.get()
      await domain.global.set({ ...state, archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId) })
    }

    const removeLogDir = async (sessionId) => {
      const persist = persistence()
      if (persist === undefined || typeof persist.list !== 'function' || typeof persist.locate !== 'function') return false
      const headers = await persist.list()
      const header = headers.find((h) => String(h.id) === sessionId)
      if (header === undefined) return false
      let logPath
      try {
        logPath = persist.locate(header).path
      } catch {
        return false
      }
      if (typeof logPath !== 'string' || logPath.length === 0) return false
      const sep = Math.max(logPath.lastIndexOf('\\\\'), logPath.lastIndexOf('/'))
      if (sep <= 0) return false
      const dir = logPath.slice(0, sep)
      const sub = ctx.get('subprocess')
      if (sub === undefined || typeof sub.spawn !== 'function' || typeof sub.resolveExecutable !== 'function') {
        throw new Error('subprocess service unavailable; cannot delete session files')
      }
      let exe
      try {
        exe = await sub.resolveExecutable('pwsh')
      } catch {
        exe = undefined
      }
      if (exe === undefined) {
        try {
          exe = await sub.resolveExecutable('powershell')
        } catch {
          exe = undefined
        }
      }
      if (exe === undefined) throw new Error('no PowerShell executable available')
      const quoted = "'" + String(dir).replace(/'/g, "''") + "'"
      const parentSep = Math.max(dir.lastIndexOf('\\\\'), dir.lastIndexOf('/'))
      const cwd = parentSep > 0 ? dir.slice(0, parentSep) : dir
      const proc = sub.spawn({
        argv: [exe, '-NoProfile', '-NonInteractive', '-Command', 'Remove-Item -LiteralPath ' + quoted + ' -Recurse -Force'],
        cwd,
        stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
        graceMs: 15000
      })
      const outcome = await proc.done
      if (outcome.exitCode !== 0) throw new Error('failed to remove session files (exit ' + outcome.exitCode + ')')
      return true
    }

    const asError = (error) => (error && error.message ? error.message : String(error))
    const agentOf = (id) => {
      const agents = ctx.get('agents')
      return agents !== undefined && typeof agents.get === 'function' ? agents.get(id) : undefined
    }

    harness.handle('archived.list', async () => {
      try {
        const reg = registry()
        const query = sessionQuery()
        let archivedIds = []
        if (reg !== undefined) {
          try {
            archivedIds = Array.from(reg.archivedSessionIds || [])
          } catch {
            archivedIds = []
          }
        }
        let records = []
        if (query !== undefined && typeof query.listSessions === 'function') {
          records = await query.listSessions()
        } else {
          const persist = persistence()
          if (persist !== undefined && typeof persist.list === 'function') {
            records = (await persist.list()).map((header) => ({ header, live: false }))
          }
        }
        const workspaceTitle = new Map()
        if (reg !== undefined && typeof reg.list === 'function') {
          try {
            for (const ws of reg.list()) {
              for (const id of ws.sessionIds) {
                if (!workspaceTitle.has(String(id))) workspaceTitle.set(String(id), ws.title)
              }
            }
          } catch {
            /* registry not started */
          }
        }
        const rows = []
        for (const record of records) {
          const header = record.header
          if (header === undefined || header.origin === 'subagent') continue
          const id = String(header.id)
          let title = null
          if (query !== undefined && typeof query.readTitle === 'function') {
            try {
              const snap = await query.readTitle(header.id)
              if (snap !== undefined && typeof snap.title === 'string' && snap.title.length > 0) title = snap.title
            } catch {
              /* keep null */
            }
          }
          const agent = agentOf(id)
          rows.push({
            id,
            title,
            cwd: typeof header.cwd === 'string' ? header.cwd : null,
            workspaceTitle: workspaceTitle.get(id) || null,
            createdAt: typeof header.createdAt === 'number' ? header.createdAt : null,
            live: record.live === true,
            running: agent !== undefined && agent.status === 'running'
          })
        }
        rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        const archivedSet = new Set(archivedIds)
        const pending = pendingStore()
        const pendingIds = pending !== undefined && typeof pending.list === 'function' ? new Set(await pending.list()) : new Set()
        if (pending !== undefined && typeof pending.syncArchived === 'function') {
          await pending.syncArchived([...archivedSet])
          for (const id of [...pendingIds]) if (!archivedSet.has(id)) pendingIds.delete(id)
        }
        const archived = rows.filter((row) => archivedSet.has(row.id) && !pendingIds.has(row.id))
        const scheduled = rows.filter((row) => archivedSet.has(row.id) && pendingIds.has(row.id))
        const other = rows.filter((row) => !archivedSet.has(row.id))
        return {
          ok: true,
          archived,
          pending: scheduled,
          other,
          counts: {
            archived: archived.length,
            pending: scheduled.length,
            other: other.length
          }
        }
      } catch (error) {
        return { ok: false, error: asError(error) }
      }
    })

    harness.handle('archived.archive', async (args) => {
      try {
        const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : ''
        if (sessionId === '') return { ok: false, error: 'missing sessionId' }
        await archiveSession(sessionId)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: asError(error) }
      }
    })

    harness.handle('archived.unarchive', async (args) => {
      try {
        const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : ''
        if (sessionId === '') return { ok: false, error: 'missing sessionId' }
        await unarchiveSession(sessionId)
        const pending = pendingStore()
        if (pending !== undefined && typeof pending.unmark === 'function') await pending.unmark(sessionId)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: asError(error) }
      }
    })

    harness.handle('pending.cancel', async (args) => {
      try {
        const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : ''
        if (sessionId === '') return { ok: false, error: 'missing sessionId' }
        const pending = pendingStore()
        if (pending === undefined || typeof pending.unmark !== 'function') throw new Error('pending-delete store unavailable')
        await pending.unmark(sessionId)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: asError(error) }
      }
    })

    harness.handle('archived.delete', async (args) => {
      try {
        const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : ''
        if (sessionId === '') return { ok: false, error: 'missing sessionId' }
        const sessions = ctx.get('sessions')
        const agent = agentOf(sessionId)
        if (agent !== undefined && agent.status === 'running') {
          return { ok: false, error: '该会话正在运行中，无法删除' }
        }
        // A live Session remains in the in-memory store and the SQLite query
        // index deliberately reindexes live sessions. Without the private
        // enter() disposer there is no supported unload-by-id operation, so
        // deleting its artifact would be undone and must be refused.
        const live = sessions !== undefined && typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
        if (live !== undefined) {
          await archiveSession(sessionId)
          const pending = pendingStore()
          if (pending === undefined || typeof pending.mark !== 'function') throw new Error('pending-delete store unavailable')
          await pending.mark(sessionId)
          return { ok: true, scheduled: true }
        }
        const pending = pendingStore()
        if (pending !== undefined && typeof pending.deleteSession === 'function') {
          const removed = await pending.deleteSession(sessionId)
          if (!removed) return { ok: false, error: '未找到可删除的会话文件，未修改归档和工作区状态' }
          return { ok: true }
        }
        const removed = await removeLogDir(sessionId)
        if (!removed) {
          return { ok: false, error: '未找到可删除的会话文件，未修改归档和工作区状态' }
        }
        await unarchiveSession(sessionId)
        const reg = registry()
        if (reg !== undefined && typeof reg.list === 'function') {
          try {
            for (const ws of reg.list()) {
              if (ws.sessionIds.includes(sessionId) && typeof ws.detachSession === 'function') {
                await ws.detachSession(sessionId)
              }
            }
          } catch {
            /* registry not started */
          }
        }
        return { ok: true }
      } catch (error) {
        return { ok: false, error: asError(error) }
      }
    })
  }
}`

export function apply(ctx) {
  const done = new Set()
  const runner = () => ctx.get('dynamicCordisRunner')
  const registry = () => ctx.get('workspaceRegistry')
  const persistence = () => ctx.get('sessionPersistence')

  const archivedIds = async () => {
    const reg = registry()
    return reg === undefined ? [] : Array.from(reg.archivedSessionIds || [])
  }

  const removeArtifact = async (sessionId) => {
    const persist = persistence()
    if (persist === undefined || typeof persist.list !== 'function' || typeof persist.locate !== 'function') return false
    const header = (await persist.list()).find((item) => String(item.id) === sessionId)
    if (header === undefined) return false
    const location = persist.locate(header)
    if (location === undefined || typeof location.path !== 'string') return false
    await rm(dirname(location.path), { recursive: true, force: false })
    return true
  }

  const finalizeDelete = async (sessionId) => {
    const reg = registry()
    if (reg === undefined) throw new Error('workspace registry unavailable')
    if (typeof reg.enqueueOperation === 'function' && typeof reg.requireState === 'function' && typeof reg.setState === 'function') {
      await reg.enqueueOperation(() => {
        const state = reg.requireState()
        if (!state.archivedSessionIds.includes(sessionId)) return
        return reg.setState({ ...state, archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId) })
      })
    }
    if (typeof reg.list === 'function') {
      for (const workspace of reg.list()) {
        if (workspace.sessionIds.includes(sessionId) && typeof workspace.detachSession === 'function') await workspace.detachSession(sessionId)
      }
    }
  }

  const pending = createPendingDeleteService({
    store: createPendingDeleteStore(),
    archivedIds,
    isLive: (sessionId) => {
      const sessions = ctx.get('sessions')
      return sessions !== undefined && typeof sessions.get === 'function' && sessions.get(sessionId) !== undefined
    },
    removeArtifact,
    finalizeDelete,
  })
  ctx.provide('sessionArchiverPending', pending)
  const ready = pending.processStartup().then((result) => {
    for (const failure of result.failed) console.error(`[session-archiver] pending delete ${failure.id} failed: ${failure.error}`)
    if (result.deleted.length > 0) console.log(`[session-archiver] deleted ${result.deleted.length} scheduled session(s)`)
  }).catch((error) => {
    console.error(`[session-archiver] pending-delete startup failed: ${error && error.message ? error.message : String(error)}`)
  })

  const bootstrap = async (agent) => {
    await ready
    const service = runner()
    if (service === undefined) throw new Error('dynamicCordisRunner unavailable')
    const rows = typeof service.snapshot === 'function' ? service.snapshot(agent) : []
    const exists = rows.some((row) => (row.packages || []).some((p) => p.name === PLUGIN_NAME))
    if (exists) return
    const receipt = service.define({
      sessionId: agent.id,
      plugin: { kind: 'new', idPrefix: 'sarch' },
      name: PLUGIN_NAME,
      purpose: PLUGIN_PURPOSE,
      code: { host: HOST_CODE }
    })
    const res = await service.run(agent, receipt.pluginId, receipt.packageId, 'run')
    console.log(`[session-archiver] ${agent.id}: defined ${receipt.pluginId}/${receipt.packageId}, run status ${res.status}`)
  }

  const tryBootstrap = (agent) => {
    if (agent === undefined || agent.id === undefined) return
    if (done.has(agent.id)) return
    if (runner() === undefined) return
    done.add(agent.id)
    bootstrap(agent).catch((error) => {
      done.delete(agent.id)
      console.error(`[session-archiver] bootstrap failed for ${agent.id}: ${error && error.message ? error.message : String(error)}`)
    })
  }

  // The `agent/created` payload wraps the subject as `{ agent }`.
  ctx.on('agent/created', ({ agent }) => tryBootstrap(agent))

  // Sweep agents created before this row mounted (patch hot-reload while
  // sessions were already live).
  const sweep = () => {
    const agents = ctx.get('agents')
    if (agents === undefined || typeof agents.list !== 'function') return
    for (const agent of agents.list()) tryBootstrap(agent)
  }
  const waitThenSweep = () => {
    if (runner() !== undefined) sweep()
    else ctx.timer.setTimeout(waitThenSweep, 500)
  }
  // apply() must never throw synchronously: a throwing row apply fails the
  // whole include subtree at boot.
  try {
    waitThenSweep()
  } catch (error) {
    console.error(`[session-archiver] bootstrap sweep failed: ${error && error.message ? error.message : String(error)}`)
  }
}
