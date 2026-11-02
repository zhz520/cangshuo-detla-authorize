import { computed, reactive, watch } from 'vue'

// Keep query and position per menu; render at most one page of table rows.
export function useRecords(source, key) {
  const states = reactive({})
  const state = computed(() => {
    const id = key()
    if (!states[id]) states[id] = { query: '', page: 1, size: 25 }
    return states[id]
  })
  const query = computed({ get: () => state.value.query, set: value => { state.value.query = value; state.value.page = 1 } })
  const filtered = computed(() => {
    const term = query.value.trim().toLocaleLowerCase()
    const matches = value => (typeof value === 'string' || typeof value === 'number') && String(value).toLocaleLowerCase().includes(term)
    return term ? source().filter(row => Object.values(row).some(value => Array.isArray(value) ? value.some(matches) : matches(value))) : source()
  })
  const total = computed(() => filtered.value.length)
  watch([total, () => state.value.size], () => {
    state.value.page = Math.min(state.value.page, Math.max(1, Math.ceil(total.value / state.value.size)))
  }, { flush: 'sync' })
  const rows = computed(() => filtered.value.slice((state.value.page - 1) * state.value.size, state.value.page * state.value.size))
  return { query, state, total, rows }
}
