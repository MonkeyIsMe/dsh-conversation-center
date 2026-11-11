export const inject = ['sessionQuery', 'connection'];

export async function apply(ctx, config) {
  const impl = await import(new URL(`./impl.js?v=${Date.now()}`, import.meta.url).href);
  const missing = (Array.isArray(impl.inject) ? impl.inject : []).filter((name) => !inject.includes(name));
  if (missing.length > 0) throw new Error(`dsh-session-hub: impl 需要未注入的服务: ${missing.join(', ')}`);
  return impl.apply(ctx, config);
}
