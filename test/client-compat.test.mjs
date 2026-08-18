import assert from 'node:assert/strict'

let clientModule
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      clientModule = definition.factory((name) => {
        if (name === 'react') return { createElement() {} }
        throw new Error('unexpected client dependency: ' + name)
      })
    },
  },
}

await import('../client.bundle.js?client-compat-test')

const rows = [
  { id: 'archived' },
  { id: 'running-1' },
  { id: 'running-2' },
  { id: 'running-3' },
  { id: 'running-4' },
]
const legacy = clientModule.classifySessionData({
  archived: [rows[0]],
  all: rows,
})

assert.deepEqual(legacy.other.map((row) => row.id), [
  'running-1',
  'running-2',
  'running-3',
  'running-4',
])
assert.deepEqual(legacy.counts, { archived: 1, pending: 0, other: 4 })

const modern = clientModule.classifySessionData({
  archived: [rows[0]],
  pending: [rows[1]],
  other: rows.slice(2),
  counts: { archived: 99, pending: 99, other: 99 },
})
assert.deepEqual(modern.counts, { archived: 1, pending: 1, other: 3 })
assert.equal(new Set([...modern.archived, ...modern.pending, ...modern.other].map((row) => row.id)).size, 5)

console.log('client-compat: legacy and modern category formulas passed')
