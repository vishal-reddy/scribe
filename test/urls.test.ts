import { describe, it, expect } from 'vitest';
import { appBaseUrl, hubUrl, hubQuotaUrl } from '../src/lib/urls';

describe('deployment URLs', () => {
  it('defaults to prod in production and localhost elsewhere', () => {
    expect(appBaseUrl({ ENVIRONMENT: 'production' })).toBe('https://scribe.kecker.co');
    expect(appBaseUrl({})).toBe('http://localhost:8787');
    expect(hubUrl({})).toBe('https://mcp.kecker.co');
    expect(hubQuotaUrl({})).toBe('https://mcp.kecker.co/api/quota');
  });

  it('dev overrides win and trailing slashes are dropped', () => {
    const dev = { ENVIRONMENT: 'development', APP_BASE_URL: 'https://scribe-dev.kecker.co/', HUB_URL: 'https://mcp-dev.kecker.co/' };
    expect(appBaseUrl(dev)).toBe('https://scribe-dev.kecker.co');
    expect(hubUrl(dev)).toBe('https://mcp-dev.kecker.co');
    expect(hubQuotaUrl(dev)).toBe('https://mcp-dev.kecker.co/api/quota');
  });

  it('blank overrides fall back instead of producing broken URLs', () => {
    expect(appBaseUrl({ ENVIRONMENT: 'production', APP_BASE_URL: '  ' })).toBe('https://scribe.kecker.co');
    expect(hubUrl({ HUB_URL: '' })).toBe('https://mcp.kecker.co');
  });
});
