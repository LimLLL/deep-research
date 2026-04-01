import { useSettingStore } from "@/store/setting";
import {
  createSearchProvider,
  fetchExaContents,
  type SearchProviderOptions,
  type ExaContentResult,
} from "@/utils/deep-research/search";
import { multiApiKeyPolling } from "@/utils/model";
import { generateSignature } from "@/utils/signature";

function normalizeDomain(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^\*\./, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

function parseDomainList(value: string) {
  return value
    .split(/[\s,\n]+/g)
    .map((item) => normalizeDomain(item))
    .filter((item) => item.length > 0);
}

function matchDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isUrlAllowed(
  url: string,
  includeDomains: string[],
  excludeDomains: string[]
) {
  try {
    const hostname = normalizeDomain(new URL(url).hostname);
    if (excludeDomains.some((domain) => matchDomain(hostname, domain))) {
      return false;
    }
    if (includeDomains.length === 0) {
      return true;
    }
    return includeDomains.some((domain) => matchDomain(hostname, domain));
  } catch {
    return includeDomains.length === 0;
  }
}

function applyDomainFilters(
  result: { sources: Source[]; images: ImageSource[] },
  includeDomains: string[],
  excludeDomains: string[]
) {
  if (includeDomains.length === 0 && excludeDomains.length === 0) {
    return result;
  }

  return {
    sources: result.sources.filter((source) =>
      isUrlAllowed(source.url, includeDomains, excludeDomains)
    ),
    images: result.images.filter((image) =>
      isUrlAllowed(image.url, includeDomains, excludeDomains)
    ),
  };
}

function useWebSearch() {
  async function search(query: string) {
    const {
      mode,
      searchProvider,
      searchMaxResult,
      accessPassword,
      searchIncludeDomains,
      searchExcludeDomains,
    } = useSettingStore.getState();
    const options: SearchProviderOptions = {
      provider: searchProvider,
      maxResult: searchMaxResult,
      query,
    };
    const includeDomains = parseDomainList(searchIncludeDomains);
    const excludeDomains = parseDomainList(searchExcludeDomains);

    switch (searchProvider) {
      case "tavily":
        const { tavilyApiKey, tavilyApiProxy, tavilyScope } =
          useSettingStore.getState();
        if (mode === "local") {
          options.baseURL = tavilyApiProxy;
          options.apiKey = multiApiKeyPolling(tavilyApiKey);
        } else {
          options.baseURL = location.origin + "/api/search/tavily";
        }
        options.scope = tavilyScope;
        break;
      case "firecrawl":
        const { firecrawlApiKey, firecrawlApiProxy } =
          useSettingStore.getState();
        if (mode === "local") {
          options.baseURL = firecrawlApiProxy;
          options.apiKey = multiApiKeyPolling(firecrawlApiKey);
        } else {
          options.baseURL = location.origin + "/api/search/firecrawl";
        }
        break;
      case "exa":
        const { exaApiKey, exaApiProxy, exaScope } = useSettingStore.getState();
        if (mode === "local") {
          options.baseURL = exaApiProxy;
          options.apiKey = multiApiKeyPolling(exaApiKey);
          options.authType = "x-api-key";
        } else {
          options.baseURL = location.origin + "/api/search/exa";
          options.authType = "bearer";
        }
        options.scope = exaScope;
        break;
      case "bocha":
        const { bochaApiKey, bochaApiProxy } = useSettingStore.getState();
        if (mode === "local") {
          options.baseURL = bochaApiProxy;
          options.apiKey = multiApiKeyPolling(bochaApiKey);
        } else {
          options.baseURL = location.origin + "/api/search/bocha";
        }
        break;
      case "brave":
        const { braveApiKey, braveApiProxy } = useSettingStore.getState();
        if (mode === "local") {
          options.baseURL = braveApiProxy;
          options.apiKey = multiApiKeyPolling(braveApiKey);
        } else {
          options.baseURL = location.origin + "/api/search/brave";
        }
        break;
      case "searxng":
        const { searxngApiProxy, searxngScope } = useSettingStore.getState();
        if (mode === "local") {
          options.baseURL = searxngApiProxy;
        } else {
          options.baseURL = location.origin + "/api/search/searxng";
        }
        options.scope = searxngScope;
        break;
      default:
        break;
    }

    if (mode === "proxy") {
      options.apiKey = generateSignature(accessPassword, Date.now());
    }

    const result = await createSearchProvider(options);
    return applyDomainFilters(result, includeDomains, excludeDomains);
  }

  /**
   * Fetch full page contents via Exa /contents endpoint.
   * @returns null if current provider is not Exa.
   */
  async function fetchContents(
    urls: string[],
    query?: string
  ): Promise<ExaContentResult[] | null> {
    const {
      mode: currentMode,
      searchProvider: currentProvider,
      accessPassword: currentPassword,
    } = useSettingStore.getState();

    if (currentProvider !== "exa") return null;

    const { exaApiKey: key, exaApiProxy: proxy } =
      useSettingStore.getState();

    let contentsBaseURL: string;
    let contentsApiKey: string;
    let contentsAuthType: "x-api-key" | "bearer";

    if (currentMode === "local") {
      contentsBaseURL = proxy || "";
      contentsApiKey = multiApiKeyPolling(key);
      contentsAuthType = "x-api-key";
    } else {
      contentsBaseURL = location.origin + "/api/search/exa";
      contentsApiKey = generateSignature(currentPassword, Date.now());
      contentsAuthType = "bearer";
    }

    return fetchExaContents({
      baseURL: contentsBaseURL,
      apiKey: contentsApiKey,
      authType: contentsAuthType,
      urls,
      query,
    });
  }

  return { search, fetchContents };
}

export default useWebSearch;
