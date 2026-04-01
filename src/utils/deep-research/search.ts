import {
  TAVILY_BASE_URL,
  FIRECRAWL_BASE_URL,
  EXA_BASE_URL,
  BOCHA_BASE_URL,
  BRAVE_BASE_URL,
  SEARXNG_BASE_URL,
} from "@/constants/urls";
import {
  resolveDeepResearchPromptTemplates,
  type DeepResearchPromptOverrides,
} from "@/constants/prompts";
import { completePath } from "@/utils/url";
import { pick, sort } from "radash";

type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
  rawContent?: string;
  score: number;
  publishedDate: string;
};

interface FirecrawlDocument<T = unknown> {
  url?: string;
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  extract?: T;
  json?: T;
  screenshot?: string;
  compare?: {
    previousScrapeAt: string | null;
    changeStatus: "new" | "same" | "changed" | "removed";
    visibility: "visible" | "hidden";
  };
  // v1 search only
  title?: string;
  description?: string;
}

type ExaSearchResult = {
  title: string;
  url: string;
  publishedDate: string;
  author: string;
  score: number;
  id: string;
  image?: string;
  favicon: string;
  text?: string;
  highlights?: string[];
  highlightScores?: number[];
  summary?: string;
  subpages?: ExaSearchResult[];
  extras?: {
    links?: string[];
    imageLinks?: string[];
  };
};

type BochaSearchResult = {
  id: string | null;
  name: string;
  url: string;
  displayUrl: string;
  snippet: string;
  summary?: string;
  siteName: string;
  siteIcon: string;
  dateLastCrawled: string;
  cachedPageUrl: string | null;
  language: string | null;
  isFamilyFriendly: boolean | null;
  isNavigational: boolean | null;
};

type BochaImage = {
  webSearchUrl: string;
  name: string;
  thumbnailUrl: string;
  datePublished: string;
  contentUrl: string;
  hostPageUrl: string;
  contentSize: number;
  encodingFormat: string;
  hostPageDisplayUrl: string;
  width: number;
  height: number;
  thumbnail: {
    width: number;
    height: number;
  };
};

type SearxngSearchResult = {
  url: string;
  title: string;
  content?: string;
  engine: string;
  parsed_url: string[];
  template: "default.html" | "videos.html" | "images.html";
  engines: string[];
  positions: number[];
  publishedDate?: Date | null;
  thumbnail?: null | string;
  is_onion?: boolean;
  score: number;
  category: string;
  length?: null | string;
  duration?: null | string;
  iframe_src?: string;
  source?: string;
  metadata?: string;
  resolution?: null | string;
  img_src?: string;
  thumbnail_src?: string;
  img_format?: "jpeg" | "Culture Snaxx" | "png";
};

export interface SearchProviderOptions {
  provider: string;
  baseURL?: string;
  apiKey?: string;
  /** Auth method for Exa: 'x-api-key' (default) or 'bearer'. */
  authType?: "x-api-key" | "bearer";
  query: string;
  maxResult?: number;
  scope?: string;
  promptOverrides?: DeepResearchPromptOverrides;
}

export interface FetchExaContentsOptions {
  baseURL: string;
  apiKey?: string;
  /** Auth method: 'x-api-key' (default) or 'bearer'. */
  authType?: "x-api-key" | "bearer";
  urls: string[];
  query?: string;
  maxCharacters?: number;
}

export interface ExaContentResult {
  url: string;
  title: string;
  text: string;
  highlights: string[];
}

/** Whether an error is a retryable network failure. */
function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch network errors
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("etimedout") ||
      msg.includes("econnreset") ||
      msg.includes("econnrefused") ||
      msg.includes("socket hang up") ||
      msg.includes("network") ||
      msg.includes("fetch failed")
    );
  }
  return false;
}

/** Whether an HTTP status warrants a retry. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

/**
 * Fetch full page contents from Exa's /contents endpoint (with retry).
 * @param options - Connection and content retrieval options.
 * @returns Array of page content results.
 */
export async function fetchExaContents({
  baseURL,
  apiKey = "",
  authType = "x-api-key",
  urls,
  query,
  maxCharacters = 10000,
}: FetchExaContentsOptions): Promise<ExaContentResult[]> {
  const reqHeaders: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    if (authType === "x-api-key") {
      reqHeaders["x-api-key"] = apiKey;
    } else {
      reqHeaders["Authorization"] = `Bearer ${apiKey}`;
    }
  }

  const url = `${completePath(baseURL || EXA_BASE_URL)}/contents`;
  const body = JSON.stringify({
    urls,
    text: { maxCharacters },
    ...(query ? { highlights: { query, maxCharacters: 2000 } } : {}),
  });

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.warn(
        `[Exa /contents] retry ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY_MS}ms`
      );
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: reqHeaders,
        credentials: "omit",
        body,
      });
    } catch (err) {
      lastError = err;
      if (isRetryableError(err) && attempt < MAX_RETRIES) continue;
      throw new Error(
        `Exa /contents network error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      lastError = new Error(
        `Exa /contents failed (${response.status}): ${errorText.slice(0, 200)}`
      );
      if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) continue;
      throw lastError;
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("Exa /contents returned invalid JSON");
    }

    const { results = [] } = data;
    return results.map(
      (result: {
        url?: string;
        title?: string;
        text?: string;
        highlights?: string[];
      }) => ({
        url: result.url || "",
        title: result.title || "",
        text: result.text || "",
        highlights: result.highlights || [],
      })
    );
  }

  throw lastError ?? new Error("Exa /contents failed after retries");
}

type BraveSearchResult = {
  title: string;
  url: string;
  is_source_local: boolean;
  is_source_both: boolean;
  description: string;
  page_age: string;
  page_fetched: string;
  fetched_content_timestamp: number;
  profile: {
    name: string;
    url: string;
    long_name: string;
    img: string;
  };
  language: string;
};

type BreaveImage = {
  type: string;
  title: string;
  url: string;
  source: string;
  page_fetched: string;
  thumbnail: {
    src: string;
    width: number;
    height: number;
  };
  properties: {
    url: string;
    placeholder: string;
    width: number;
    height: number;
  };
  meta_url: {
    scheme: string;
    netloc: string;
    hostname: string;
    favicon: string;
    path: string;
  };
  confidence: string;
};

export async function createSearchProvider({
  provider,
  baseURL,
  apiKey = "",
  authType = "bearer",
  query,
  maxResult = 5,
  scope,
  promptOverrides = {},
}: SearchProviderOptions) {
  const promptTemplates = resolveDeepResearchPromptTemplates(promptOverrides);
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  if (provider === "tavily") {
    const response = await fetch(
      `${completePath(baseURL || TAVILY_BASE_URL)}/search`,
      {
        method: "POST",
        headers,
        credentials: "omit",
        body: JSON.stringify({
          query: query.replaceAll("\\", "").replaceAll('"', ""),
          search_depth: "advanced",
          topic: scope || "general",
          max_results: Number(maxResult),
          include_images: true,
          include_image_descriptions: true,
          include_answer: false,
          include_raw_content: "markdown",
        }),
      },
    );
    const { results = [], images = [] } = await response.json();
    return {
      sources: (results as TavilySearchResult[])
        .filter((item) => item.content && item.url)
        .map((result) => {
          return {
            title: result.title,
            content: result.rawContent || result.content,
            url: result.url,
          };
        }) as Source[],
      images: images as ImageSource[],
    };
  } else if (provider === "firecrawl") {
    const response = await fetch(
      `${completePath(baseURL || FIRECRAWL_BASE_URL, "/v1")}/search`,
      {
        method: "POST",
        headers,
        credentials: "omit",
        body: JSON.stringify({
          query,
          limit: maxResult,
          tbs: "qdr:w",
          origin: "api",
          scrapeOptions: {
            formats: ["markdown"],
          },
          timeout: 60000,
        }),
      },
    );
    const { data = [] } = await response.json();
    return {
      sources: (data as FirecrawlDocument[])
        .filter((item) => item.description && item.url)
        .map((result) => ({
          content: result.markdown || result.description,
          url: result.url,
          title: result.title,
        })) as Source[],
      images: [],
    };
  } else if (provider === "exa") {
    const exaHeaders: HeadersInit = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      if (authType === "x-api-key") {
        exaHeaders["x-api-key"] = apiKey;
      } else {
        exaHeaders["Authorization"] = `Bearer ${apiKey}`;
      }
    }
    const response = await fetch(
      `${completePath(baseURL || EXA_BASE_URL)}/search`,
      {
        method: "POST",
        headers: exaHeaders,
        credentials: "omit",
        body: JSON.stringify({
          query,
          category: scope || "research paper",
          contents: {
            text: true,
            summary: {
              query: `Given the following query from the user:\n<query>${query}</query>\n\n${promptTemplates.rewritingPrompt}`,
            },
            numResults: Number(maxResult) * 5,
            livecrawl: "auto",
            extras: {
              imageLinks: 3,
            },
          },
        }),
      },
    );
    const { results = [] } = await response.json();
    const images: ImageSource[] = [];
    return {
      sources: (results as ExaSearchResult[])
        .filter((item) => (item.summary || item.text) && item.url)
        .map((result) => {
          if (
            result.extras?.imageLinks &&
            result.extras?.imageLinks.length > 0
          ) {
            result.extras.imageLinks.forEach((url) => {
              images.push({ url, description: result.text });
            });
          }
          return {
            content: result.summary || result.text,
            url: result.url,
            title: result.title,
          };
        }) as Source[],
      images,
    };
  } else if (provider === "bocha") {
    const response = await fetch(
      `${completePath(baseURL || BOCHA_BASE_URL, "/v1")}/web-search`,
      {
        method: "POST",
        headers,
        credentials: "omit",
        body: JSON.stringify({
          query,
          freshness: "noLimit",
          summary: true,
          count: maxResult,
        }),
      },
    );
    const { data = {} } = await response.json();
    const results = data.webPages?.value || [];
    const imageResults = data.images?.value || [];
    return {
      sources: (results as BochaSearchResult[])
        .filter((item) => item.snippet && item.url)
        .map((result) => ({
          content: result.summary || result.snippet,
          url: result.url,
          title: result.name,
        })) as Source[],
      images: (imageResults as BochaImage[]).map((item) => {
        const matchingResult = (results as BochaSearchResult[]).find(
          (result) => result.url === item.hostPageUrl,
        );
        return {
          url: item.contentUrl,
          description: item.name || matchingResult?.name,
        };
      }) as ImageSource[],
    };
  } else if (provider === "brave") {
    const params = {
      q: query,
      count: maxResult,
    };
    const searchQuery = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      searchQuery.append(key, value.toString());
    }

    const response = await fetch(
      `${completePath(baseURL || BRAVE_BASE_URL, "/v1")}/web/search?${searchQuery.toString()}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
        credentials: "omit",
      },
    );

    const imageResponse = await fetch(
      `${completePath(baseURL || BRAVE_BASE_URL, "/v1")}/images/search?${searchQuery.toString()}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
        credentials: "omit",
      },
    );

    const [webSearchResults, imageSearchResults] = await Promise.all([
      response.json(),
      imageResponse.json(),
    ]);
    const results = webSearchResults?.web?.results || [];
    const imageResults = imageSearchResults?.results || [];
    return {
      sources: (results as BraveSearchResult[])
        .filter((item) => item.description && item.url)
        .map((result) => ({
          content: result.description,
          url: result.url,
          title: result.title,
        })) as Source[],
      images: (imageResults as BreaveImage[]).map((item) => {
        return {
          url: item.url,
          description: item.title,
        };
      }) as ImageSource[],
    };
  } else if (provider === "searxng") {
    const params = {
      q: query,
      categories:
        scope === "academic" ? ["science", "images"] : ["general", "images"],
      engines:
        scope === "academic"
          ? [
              "arxiv",
              "google scholar",
              "pubmed",
              "wikispecies",
              "google_images",
            ]
          : [
              "google",
              "bing",
              "duckduckgo",
              "brave",
              "wikipedia",
              "bing_images",
              "google_images",
            ],
      lang: "auto",
      format: "json",
      autocomplete: "google",
    };
    const searchQuery = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      searchQuery.append(key, value.toString());
    }
    const local = global.location || {};
    const response = await fetch(
      `${completePath(
        baseURL || SEARXNG_BASE_URL,
      )}/search?${searchQuery.toString()}`,
      baseURL?.startsWith(local.origin)
        ? { method: "POST", credentials: "omit", headers }
        : { method: "GET", credentials: "omit" },
    );
    const { results = [] } = await response.json();
    const rearrangedResults = sort(
      results as SearxngSearchResult[],
      (item) => item.score,
      true,
    );
    return {
      sources: rearrangedResults
        .filter((item) => item.content && item.url && item.score >= 0.5)
        .slice(0, maxResult * 5)
        .map((result) => pick(result, ["title", "content", "url"])) as Source[],
      images: rearrangedResults
        .filter((item) => item.category === "images" && item.score >= 0.5)
        .slice(0, maxResult)
        .map((result) => {
          return {
            url: result.img_src,
            description: result.title,
          };
        }) as ImageSource[],
    };
  } else {
    throw new Error("Unsupported Provider: " + provider);
  }
}
