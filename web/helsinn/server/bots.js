// User-agent substrings that identify crawlers, AI scrapers, LLM retrieval bots,
// and SEO/reconnaissance tools. Matched case-insensitively. Extend freely.
const BLOCKED_UA_SUBSTRINGS = [
  // Generic
  'bot', 'crawler', 'spider', 'scraper', 'slurp', 'fetch', 'indexer',

  // Search engine crawlers
  'googlebot', 'google-extended', 'bingbot', 'yandexbot', 'baiduspider',
  'duckduckbot', 'sogou', 'exabot', 'facebot', 'facebookexternalhit',
  'twitterbot', 'linkedinbot', 'pinterestbot', 'applebot', 'applebot-extended',
  'amazonbot', 'mojeekbot', 'seznambot', 'coccocbot', 'naverbot', 'yahoobot',
  'yeti', 'petalbot',

  // AI training / retrieval crawlers
  'gptbot', 'chatgpt-user', 'oai-searchbot', 'openai',
  'claudebot', 'anthropic-ai', 'claude-web', 'claude-searchbot',
  'perplexitybot', 'perplexity-user',
  'ccbot', 'common crawl',
  'cohere-ai', 'cohere-training-data-crawler',
  'meta-externalagent', 'meta-externalfetcher', 'facebookbot',
  'bytespider', 'bytedance', 'tiktokspider',
  'imagesiftbot', 'duckassistbot', 'youbot', 'you.com',
  'diffbot', 'omgili', 'omgilibot',
  'timpibot', 'kagibot', 'newsnow', 'neevabot',
  'mistralai-user', 'phindbot', 'aibot', 'scrapy',
  'webz.io', 'dotbot',

  // SEO / recon
  'ahrefsbot', 'semrushbot', 'mj12bot', 'dataforseobot', 'blexbot',
  'majesticseobot', 'seokicks', 'rogerbot', 'screaming frog', 'sitebulb',
  'barkrowler', 'serpstatbot', 'linkpadbot', 'linkdexbot',
  'lumrixbot', 'turnitinbot', 'grammarly', 'grapeshot',

  // Archival
  'archive.org_bot', 'ia_archiver', 'heritrix', 'wayback',

  // Generic http libraries that are almost always bots for a site like this
  'python-requests', 'python-urllib', 'libwww-perl', 'go-http-client',
  'java/1.', 'okhttp', 'httpclient', 'axios/', 'node-fetch', 'node.js',
  'curl/', 'wget/', 'aria2', 'httpie', 'postmanruntime',
  'headless', 'phantomjs', 'puppeteer', 'playwright', 'chrome-lighthouse',
];

export function isBotUserAgent(ua) {
  if (!ua) return true; // empty UA is almost always a bot
  const lower = ua.toLowerCase();
  for (const token of BLOCKED_UA_SUBSTRINGS) {
    if (lower.includes(token)) return true;
  }
  return false;
}
