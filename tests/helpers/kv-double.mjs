// A KV test double with only the methods the executor tests call.
// It is not a KV emulator and it is never shipped.
export function kvDouble(values = {}) {
  return {
    async get(storeId, key) {
      return values[`${storeId}/${key}`] ?? null;
    }
  };
}
