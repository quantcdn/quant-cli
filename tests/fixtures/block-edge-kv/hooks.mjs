// Module hooks that make every import of @quantcdn/edge-kv fail. A process
// that starts with register.mjs exits with BLOCKED_EDGE_KV when it loads
// @quantcdn/edge-kv, by any specifier.

const MESSAGE = 'BLOCKED_EDGE_KV: @quantcdn/edge-kv was loaded';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@quantcdn/edge-kv' || specifier.startsWith('@quantcdn/edge-kv/')) throw new Error(MESSAGE);
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.includes('/@quantcdn/edge-kv/')) throw new Error(MESSAGE);
  return resolved;
}
