/**
 * Path bridge between Revva's Windows path space and the OpenCode service.
 *
 * Revva stores and displays Windows paths (its database, its UI, its own
 * filesystem checks). A service running inside WSL speaks Linux paths for the
 * same folders. Rather than touching every call site, the client is wrapped
 * once: request objects get their path fields translated into the service form,
 * response objects get them translated back.
 *
 * Only fields that are unambiguously absolute paths are touched — `directory`,
 * `canonical` and `cwd`. Notably `path` is NOT translated: `SkillInfo.path` is
 * absolute but `FileSystemEntry.path` is relative, so that field is translated
 * at its call site where its meaning is known.
 *
 * Translation is a no-op unless the toolchain is WSL, so native setups keep the
 * client object as the library built it.
 */
import { choice, fromToolPath, toToolPath } from '../toolchain'

const PATH_KEYS = new Set(['directory', 'canonical', 'cwd'])
/** Recursion guard: the API is shallow, cycles would mean a library change. */
const MAX_DEPTH = 8

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** AsyncIterables (log streams, event subscriptions) must never be rebuilt. */
function isStream(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return false
  return typeof (value as Record<symbol, unknown>)[Symbol.asyncIterator] === 'function'
}

function mapPaths(value: unknown, map: (path: string) => string, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value
  if (Array.isArray(value)) {
    let changed = false
    const items = value.map((item) => {
      const next = mapPaths(item, map, depth + 1)
      if (next !== item) changed = true
      return next
    })
    return changed ? items : value
  }
  if (!isPlainObject(value)) return value
  let changed = false
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const next =
      PATH_KEYS.has(key) && typeof entry === 'string'
        ? (() => {
            const mapped = map(entry)
            if (mapped !== entry) changed = true
            return mapped
          })()
        : mapPaths(entry, map, depth + 1)
    if (next !== entry) changed = true
    out[key] = next
  }
  // Events stream constantly; an untouched payload keeps its original object so
  // the common case costs no allocation.
  return changed ? out : value
}

/** Namespaces whose leaves are not plain request/response functions. */
const SKIP_NAMESPACES = new Set(['event', 'rpc'])

/**
 * Wrap a client so every call translates paths on the way out and back.
 * Returns the same object unchanged when no translation is needed.
 */
export function bridgeClient<T extends object>(client: T): T {
  if (choice().kind !== 'wsl') return client

  const wrapNamespace = (namespace: object): object =>
    new Proxy(namespace, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver)
        if (typeof value !== 'function') {
          return value && typeof value === 'object' ? wrapNamespace(value) : value
        }
        return (...args: unknown[]) => call(target, property, value, args)
      }
    })

  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (SKIP_NAMESPACES.has(String(property))) return value
      return value && typeof value === 'object' ? wrapNamespace(value) : value
    }
  })
}

async function call(target: object, property: string | symbol, fn: (...args: unknown[]) => unknown, args: unknown[]): Promise<unknown> {
  const translated = args.map((arg) => mapPaths(arg, toToolPath))
  const result = await fn.apply(target, translated)
  if (isStream(result)) return result
  return mapPaths(result, fromToolPath)
}

/** Translate paths inside one event payload (never mutates the original). */
export function bridgeEventPaths<T>(value: T): T {
  if (choice().kind !== 'wsl') return value
  return mapPaths(value, fromToolPath) as T
}
