import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPendingDeleteService, createPendingDeleteStore } from '../pending-delete.mjs'

const root = await mkdtemp(join(tmpdir(), 'dsh-session-archiver-'))
const file = join(root, 'pending-delete.json')
const first = createPendingDeleteStore(file)

assert.deepEqual(await first.list(), [])
await first.mark('session-b')
await first.mark('session-a')
assert.deepEqual(await first.list(), ['session-b', 'session-a'])
assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), ['session-a', 'session-b'])

const second = createPendingDeleteStore(file)
assert.deepEqual((await second.list()).sort(), ['session-a', 'session-b'])
await second.unmark('session-a')
assert.deepEqual(await second.list(), ['session-b'])
await second.replace([])
assert.deepEqual(await second.list(), [])

const events = []
const service = createPendingDeleteService({
  store: second,
  archivedIds: () => ['ok', 'fail', 'live'],
  isLive: (id) => id === 'live',
  removeArtifact: async (id) => {
    events.push('remove:' + id)
    if (id === 'fail') throw new Error('locked')
    if (id === 'already-gone') return false
    return true
  },
  finalizeDelete: async (id) => events.push('finalize:' + id),
})
await service.mark('ok')
await service.mark('fail')
await service.mark('stale')
await service.mark('live')
const immediate = await service.deleteSession('missing')
assert.equal(immediate, false)

const result = await service.processStartup()
assert.deepEqual(result, { deleted: ['ok'], failed: [{ id: 'fail', error: 'locked' }], cancelled: ['stale'] })
assert.deepEqual(await service.list(), ['fail', 'live'])
assert.deepEqual(events, ['remove:ok', 'finalize:ok', 'remove:fail'])

console.log('pending-delete: store and startup transaction passed')
