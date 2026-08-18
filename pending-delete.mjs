import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function pendingDeletePath(root = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  return join(root, 'session-archiver', 'pending-delete.json')
}

export function createPendingDeleteStore(file = pendingDeletePath()) {
  let ids = new Set()
  let loaded = false

  async function load() {
    if (loaded) return new Set(ids)
    loaded = true
    try {
      const raw = await readFile(file, 'utf8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) ids = new Set(parsed.filter((id) => typeof id === 'string' && id.length > 0))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    return new Set(ids)
  }

  async function save() {
    await mkdir(dirname(file), { recursive: true })
    const temp = file + '.tmp'
    await writeFile(temp, JSON.stringify([...ids].sort()) + '\n', 'utf8')
    await rename(temp, file)
  }

  return {
    file,
    async list() { return [...await load()] },
    async has(id) { return (await load()).has(id) },
    async mark(id) {
      await load()
      ids.add(id)
      await save()
    },
    async unmark(id) {
      await load()
      ids.delete(id)
      await save()
    },
    async replace(nextIds) {
      ids = new Set(nextIds.filter((id) => typeof id === 'string' && id.length > 0))
      loaded = true
      await save()
    },
    async syncArchived(archivedIds) {
      await load()
      const allowed = new Set(archivedIds)
      const next = [...ids].filter((id) => allowed.has(id))
      if (next.length !== ids.size) await replace(next)
    },
  }
}

export function createPendingDeleteService({ store, archivedIds, isLive = () => false, removeArtifact, finalizeDelete }) {
  return {
    list: () => store.list(),
    has: (id) => store.has(id),
    mark: (id) => store.mark(id),
    unmark: (id) => store.unmark(id),
    syncArchived: (ids) => store.syncArchived(ids),
    async deleteSession(id) {
      if (!(await archivedIds()).includes(id)) return false
      const removed = await removeArtifact(id)
      if (!removed) return false
      await finalizeDelete(id)
      await store.unmark(id)
      return true
    },
    async processStartup() {
      const archived = new Set(await archivedIds())
      const deleted = []
      const failed = []
      const cancelled = []
      for (const id of await store.list()) {
        if (!archived.has(id)) {
          await store.unmark(id)
          cancelled.push(id)
          continue
        }
        if (await isLive(id)) continue
        try {
          const removed = await removeArtifact(id)
          if (!removed) throw new Error('session artifact not found')
          await finalizeDelete(id)
          await store.unmark(id)
          deleted.push(id)
        } catch (error) {
          failed.push({ id, error: error?.message ? error.message : String(error) })
        }
      }
      return { deleted, failed, cancelled }
    },
  }
}
