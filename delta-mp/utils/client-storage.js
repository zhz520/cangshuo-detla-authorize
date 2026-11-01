// Isolate this customer's persisted state even when the host is shared.
const PREFIX = 'client742:'
export const clientStorage = {
  get: key => uni.getStorageSync(PREFIX + key),
  set: (key, value) => uni.setStorageSync(PREFIX + key, value),
  remove: key => uni.removeStorageSync(PREFIX + key)
}
