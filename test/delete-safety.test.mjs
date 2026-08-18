import assert from 'node:assert/strict'
import { HOST_CODE, inject } from '../index.mjs'

assert.deepEqual(inject, ['timer', 'workspaceRegistry', 'sessionPersistence', 'sessions'])

function createHarness(services) {
  const handlers = new Map()
  const harness = {
    handle(name, handler) {
      handlers.set(name, handler)
      return () => handlers.delete(name)
    },
  }
  const plugin = new Function('harness', HOST_CODE)(harness)
  plugin.apply({ get: (name) => services[name] })
  return handlers
}

function workspaceTracker() {
  const calls = { setState: 0, detach: 0 }
  const workspace = {
    sessionIds: ['session-1'],
    async detachSession() { calls.detach += 1 },
  }
  const registry = {
    archivedSessionIds: ['session-1'],
    list: () => [workspace],
    enqueueOperation: async (operation) => operation(),
    requireState: () => ({ archivedSessionIds: ['session-1'] }),
    async setState() { calls.setState += 1 },
  }
  return { registry, calls }
}

async function liveSessionCase() {
  const { registry, calls } = workspaceTracker()
  let persistenceListCalls = 0
  const pending = new Set()
  const handlers = createHarness({
    workspaceRegistry: { ...registry, async archiveSession() { calls.setState += 1 } },
    sessions: { get: () => ({ id: 'session-1' }) },
    agents: { get: () => undefined },
    sessionArchiverPending: { async mark(id) { pending.add(id) } },
    sessionPersistence: {
      async list() { persistenceListCalls += 1; return [] },
      locate() { throw new Error('must not locate a live session') },
    },
  })

  const result = await handlers.get('archived.delete')({ sessionId: 'session-1' })
  assert.deepEqual(result, { ok: true, scheduled: true })
  assert.equal(pending.has('session-1'), true)
  assert.equal(persistenceListCalls, 0)
  assert.equal(calls.setState, 1)
  assert.equal(calls.detach, 0)
}

async function missingArtifactCase() {
  const { registry, calls } = workspaceTracker()
  const handlers = createHarness({
    workspaceRegistry: registry,
    sessionArchiverPending: { async deleteSession() { return false } },
    sessions: { get: () => undefined },
    agents: { get: () => undefined },
    sessionPersistence: {
      async list() { return [] },
      locate() { throw new Error('no header means locate must not run') },
    },
  })

  const result = await handlers.get('archived.delete')({ sessionId: 'session-1' })
  assert.deepEqual(result, {
    ok: false,
    error: '未找到可删除的会话文件，未修改归档和工作区状态',
  })
  assert.equal(calls.setState, 0)
  assert.equal(calls.detach, 0)
}

async function pendingLiveSessionCase() {
  const { registry, calls } = workspaceTracker()
  const pending = new Set()
  const handlers = createHarness({
    workspaceRegistry: {
      ...registry,
      async archiveSession() { calls.setState += 1 },
    },
    sessions: { get: () => ({ id: 'session-1' }) },
    agents: { get: () => undefined },
    sessionArchiverPending: {
      async list() { return [...pending] },
      async syncArchived() {},
      async mark(id) { pending.add(id) },
      async unmark(id) { pending.delete(id) },
    },
    sessionPersistence: { async list() { return [] } },
  })

  const result = await handlers.get('archived.delete')({ sessionId: 'session-1' })
  assert.deepEqual(result, { ok: true, scheduled: true })
  assert.equal(pending.has('session-1'), true)
  assert.equal(calls.setState, 1)
  assert.equal(calls.detach, 0)
}

async function archiveOtherSessionCase() {
  let archived = 0
  const handlers = createHarness({
    workspaceRegistry: {
      async archiveSession(id) { if (id === 'session-2') archived += 1 },
      archivedSessionIds: [],
    },
    sessions: { get: () => undefined },
    agents: { get: () => undefined },
  })
  const result = await handlers.get('archived.archive')({ sessionId: 'session-2' })
  assert.deepEqual(result, { ok: true })
  assert.equal(archived, 1)
}

async function pendingListIsSeparatedCase() {
  const pending = new Set(['session-1', 'session-stale'])
  const handlers = createHarness({
    workspaceRegistry: { archivedSessionIds: ['session-1'], list: () => [] },
    sessionArchiverPending: {
      async list() { return [...pending] },
      async syncArchived(archivedIds) {
        for (const id of [...pending]) if (!archivedIds.includes(id)) pending.delete(id)
      },
    },
    sessionQuery: {
      async listSessions() {
        return [
          { header: { id: 'session-1', cwd: 'A' }, live: true },
          { header: { id: 'session-2', cwd: 'B' }, live: false },
        ]
      },
    },
    agents: { get: () => undefined },
  })

  const result = await handlers.get('archived.list')({})
  assert.deepEqual(result.pending.map((row) => row.id), ['session-1'])
  assert.deepEqual(result.archived, [])
  assert.deepEqual(result.other.map((row) => row.id), ['session-2'])
  assert.equal(result.counts.pending + result.counts.archived + result.counts.other, 2)
  assert.deepEqual(result.counts, { archived: 0, pending: 1, other: 1 })
  assert.equal(pending.has('session-stale'), false)
}

async function cancelPendingKeepsArchiveCase() {
  const pending = new Set(['session-1'])
  let unarchiveCalls = 0
  const handlers = createHarness({
    workspaceRegistry: {
      archivedSessionIds: ['session-1'],
      async enqueueOperation() { unarchiveCalls += 1 },
      async setState() { unarchiveCalls += 1 },
      requireState() { return { archivedSessionIds: ['session-1'] } },
    },
    sessionArchiverPending: {
      async list() { return [...pending] },
      async syncArchived() {},
      async mark(id) { pending.add(id) },
      async unmark(id) { pending.delete(id) },
    },
    sessions: { get: () => undefined },
    agents: { get: () => undefined },
    sessionPersistence: { async list() { return [] } },
  })

  const result = await handlers.get('pending.cancel')({ sessionId: 'session-1' })
  assert.deepEqual(result, { ok: true })
  assert.equal(pending.has('session-1'), false)
  assert.equal(unarchiveCalls, 0)

  pending.add('session-1')
  const unarchive = await handlers.get('archived.unarchive')({ sessionId: 'session-1' })
  assert.deepEqual(unarchive, { ok: true })
  assert.equal(pending.has('session-1'), false)
}

await liveSessionCase()
await missingArtifactCase()
await pendingLiveSessionCase()
await archiveOtherSessionCase()
await pendingListIsSeparatedCase()
await cancelPendingKeepsArchiveCase()
console.log('delete-safety: 5/5 passed')
