import * as vscode from 'vscode';

/**
 * Currency codes supported for display. All underlying values are stored in USD;
 * this controls the symbol, locale formatting, and (when exchange rates are
 * available) the converted display value.
 *
 * Exchange rates are fetched from the open.er-api.com free tier on activation
 * and cached in globalState with a 24-hour TTL.
 */
export type DisplayCurrency =
  | 'auto'
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'JPY'
  | 'CAD'
  | 'AUD'
  | 'CHF'
  | 'CNY'
  | 'INR'
  | 'BRL'
  | 'MXN'
  | 'KRW'
  | 'SEK'
  | 'NOK'
  | 'DKK'
  | 'NZD'
  | 'SGD'
  | 'HKD'
  | 'ZAR';

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'CA$', AUD: 'A$',
  CHF: 'Fr', CNY: '¥', INR: '₹', BRL: 'R$', MXN: '$', KRW: '₩',
  SEK: 'kr', NOK: 'kr', DKK: 'kr', NZD: 'NZ$', SGD: 'S$', HKD: 'HK$', ZAR: 'R',
};

const REGION_TO_CURRENCY: Record<string, string> = {
  US: 'USD', GB: 'GBP', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR',
  NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', FI: 'EUR', IE: 'EUR',
  GR: 'EUR', LU: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR',
  LT: 'EUR', CY: 'EUR', MT: 'EUR', JP: 'JPY', CA: 'CAD', AU: 'AUD',
  CH: 'CHF', CN: 'CNY', IN: 'INR', BR: 'BRL', MX: 'MXN', KR: 'KRW',
  SE: 'SEK', NO: 'NOK', DK: 'DKK', NZ: 'NZD', SG: 'SGD', HK: 'HKD',
  ZA: 'ZAR', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', RU: 'RUB',
  TR: 'TRY', SA: 'SAR', AE: 'AED', TH: 'THB', MY: 'MYR', ID: 'IDR',
  PH: 'PHP', VN: 'VND', TW: 'TWD', AR: 'ARS', CL: 'CLP', CO: 'COP',
};

const EXCHANGE_RATE_STORAGE_KEY = 'atlasmind.exchangeRates';
const EXCHANGE_RATE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const EXCHANGE_RATE_API_URL = 'https://open.er-api.com/v6/latest/USD';

interface ExchangeRateCache {
  rates: Record<string, number>;
  fetchedAt: number;
}

// In-memory cache shared across all formatCost calls within a session.
// Populated by syncExchangeRates() called at activation.
let rateCache: ExchangeRateCache | undefined;

/**
 * Detects the system locale's currency code using the Intl API.
 * Falls back to USD if detection fails or the region is not in the table.
 */
export function detectSystemCurrency(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const region = locale.split('-')[1]?.toUpperCase();
    return REGION_TO_CURRENCY[region ?? ''] ?? 'USD';
  } catch {
    return 'USD';
  }
}

/**
 * Returns the active display currency: either the user-configured value or the
 * auto-detected system currency.
 */
export function getDisplayCurrency(): string {
  try {
    const setting = vscode.workspace.getConfiguration('atlasmind').get<string>('displayCurrency', 'auto');
    if (setting && setting !== 'auto') {
      return setting.toUpperCase();
    }
  } catch {
    // vscode may not be available in CLI contexts
  }
  return detectSystemCurrency();
}

/**
 * Returns the USD → target currency exchange rate from the in-memory cache.
 * Returns 1 (i.e. no conversion) if rates are unavailable.
 */
export function getExchangeRate(currency: string): number {
  if (currency === 'USD') { return 1; }
  return rateCache?.rates[currency] ?? 1;
}

/**
 * Fetches fresh exchange rates from open.er-api.com (USD base) and stores them
 * in globalState with a 24-hour TTL. Safe to call on every activation — it
 * skips the network call if the cached data is still fresh.
 *
 * Call this once from extension.ts `activate()`.
 */
export async function syncExchangeRates(globalState: vscode.Memento): Promise<void> {
  const stored = globalState.get<ExchangeRateCache>(EXCHANGE_RATE_STORAGE_KEY);
  const now = Date.now();

  if (stored && now - stored.fetchedAt < EXCHANGE_RATE_TTL_MS) {
    rateCache = stored;
    return;
  }

  try {
    const response = await fetch(EXCHANGE_RATE_API_URL, {
      signal: AbortSignal.timeout(8_000),
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json() as { rates?: Record<string, number> };
    if (!data.rates || typeof data.rates !== 'object') {
      throw new Error('Unexpected response shape');
    }
    const fresh: ExchangeRateCache = { rates: data.rates, fetchedAt: now };
    rateCache = fresh;
    await globalState.update(EXCHANGE_RATE_STORAGE_KEY, fresh);
  } catch {
    // Use stale cache if available; silently degrade to 1:1 if not
    if (stored) {
      rateCache = stored;
    }
  }
}

function formatCostWithCurrency(usd: number, currency: string, decimals: number): string {
  const rate = getExchangeRate(currency);
  const converted = usd * rate;
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(converted);
  } catch {
    const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
    return `${symbol}${converted.toFixed(decimals)}`;
  }
}

/**
 * Formats a USD cost value for display in the active display currency.
 * When exchange rates have been synced, the value is converted at the live rate.
 * The currency symbol and number locale are derived from the `atlasmind.displayCurrency`
 * setting (or detected from the OS locale when set to `"auto"`).
 */
export function formatCost(usd: number, decimals = 4): string {
  return formatCostWithCurrency(usd, getDisplayCurrency(), decimals);
}

/**
 * Adaptive formatter: uses 2 decimals for values ≥ 1, 4 for smaller values.
 */
export function formatCostAdaptive(usd: number): string {
  return formatCost(usd, usd >= 1 ? 2 : 4);
}
