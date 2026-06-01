import { z } from 'zod'
import { defineTool, type ToolContext, type ToolPreflight, type PreflightResult } from '../types.js'
import type { SandboxConfig } from '@agentnova/contracts'

// ─── Types ────────────────────────────────────────────────────────

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

/**
 * A pluggable search provider function.
 * Implement this interface to swap in a different search backend (Bing, Google CSE, SerpAPI, etc.).
 */
export type SearchProvider = (query: string, maxResults: number) => Promise<WebSearchResult[]>

// ─── Default Tavily implementation ────────────────────────────────

/** Default Tavily search provider. Requires env TAVILY_API_KEY. */
const tavilySearch: SearchProvider = async (query, maxResults) => {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) throw new Error('TAVILY_API_KEY environment variable is not set')

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Tavily API error: ${res.status} ${body}`)
  }

  const data = (await res.json()) as { results?: Array<{ title: string; url: string; content: string }> }
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }))
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Extract hostname from a URL string. Returns empty string on parse failure. */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** Check whether `domain` matches one of the allowed domain patterns. */
function isDomainAllowed(domain: string, allowedDomains: string[]): boolean {
  return allowedDomains.some((d) => domain === d || domain.endsWith('.' + d))
}

// ─── Preflight ────────────────────────────────────────────────────

/**
 * Validate `args.site` against `sandbox.allowedSearchDomains`.
 * If site is explicitly provided but not in whitelist, deny before execution.
 */
const domainPreflight: ToolPreflight = (req, { sandbox }): PreflightResult => {
  const allowedDomains = sandbox.allowedSearchDomains
  if (!allowedDomains || allowedDomains.length === 0) return { ok: true }

  const site = req.args.site as string | undefined
  if (site) {
    if (!isDomainAllowed(site, allowedDomains)) {
      return { ok: false, reason: `site "${site}" is not in allowedSearchDomains` }
    }
  }
  return { ok: true }
}

// ─── Tool Factory ─────────────────────────────────────────────────

export interface WebSearchToolOptions {
  /** Custom search provider. Defaults to Tavily. */
  provider?: SearchProvider
}

/**
 * Create a web.search tool instance with an optional custom search provider.
 *
 * @example
 * ```ts
 * import { createWebSearchTool } from '@agentnova/tools'
 *
 * // Use default Tavily backend
 * const tool = createWebSearchTool()
 *
 * // Use custom provider
 * const tool = createWebSearchTool({
 *   provider: async (query, max) => myCustomSearch(query, max),
 * })
 * ```
 */
export function createWebSearchTool(opts?: WebSearchToolOptions) {
  const search = opts?.provider ?? tavilySearch

  return defineTool({
    name: 'web.search',
    description:
      'Search the web for information. Returns a list of results with title, URL, and snippet. ' +
      'Optionally restrict results to a specific domain via the site parameter.',
    parameters: z.object({
      query: z.string().describe('Search query string'),
      site: z.string().optional().describe('Restrict results to a specific domain (optional)'),
      maxResults: z.number().default(5).describe('Maximum number of results to return'),
    }),
    permission: { level: 'read', description: 'Read-only web search' },
    preflight: domainPreflight,
    execute: async (input: { query: string; site?: string; maxResults: number }, ctx: ToolContext) => {
      const finalQuery = input.site ? `site:${input.site} ${input.query}` : input.query
      ctx.logger.info('Web search', { query: finalQuery, maxResults: input.maxResults })

      const results = await search(finalQuery, input.maxResults)

      // Post-filter: drop results whose domain is not in the whitelist
      const allowedDomains = ctx.sandbox?.allowedSearchDomains
      if (allowedDomains && allowedDomains.length > 0) {
        return results.filter((r) => {
          const domain = extractDomain(r.url)
          return isDomainAllowed(domain, allowedDomains)
        })
      }

      return results
    },
  })
}

// ─── Default instance & export ────────────────────────────────────

export const webSearch = createWebSearchTool()
export const webSearchTools = [webSearch]
