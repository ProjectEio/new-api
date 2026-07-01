/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
/**
 * ============================================================================
 * Currency Formatting Library
 * ============================================================================
 *
 * The billing base is CNY: the backend anchors quota via `points / QuotaPerUnit = ¥`,
 * so every monetary amount that reaches the frontend is already denominated in ¥.
 *
 * ## Key Concepts
 *
 * 1. **Amount (¥)**: Internal monetary unit — a plain CNY amount (e.g. 10 = ¥10).
 * 2. **Display type** (`quotaDisplayType`): how amounts are shown to the user:
 *    - `CNY`    → formatted as ¥ (no conversion; the amount already is ¥).
 *    - `CUSTOM` → converted to a custom display currency via `customCurrencyExchangeRate`.
 *    - `TOKENS` → shown as raw token counts (amount × `quotaPerUnit`).
 * 3. **Tokens**: alternative display unit (`quotaPerUnit` tokens = ¥1).
 *
 * ## When to Use Each Function
 *
 * - `formatCurrencyFromCNY()`: quota/balance display (respects the tokens display type).
 * - `formatBillingCurrencyFromCNY()`: billing/pricing display (never shows tokens).
 * - `formatLocalCurrencyAmount()`: an amount already in the final display currency.
 * - `formatQuotaWithCurrency()`: raw quota (token units) → display; converts to ¥ first.
 */
import {
  useSystemConfigStore,
  DEFAULT_CURRENCY_CONFIG,
  type CurrencyConfig,
  type CurrencyDisplayType,
} from '@/stores/system-config-store'

export interface CurrencyFormatOptions {
  /** Fraction digits to use when |value| >= 1 */
  digitsLarge?: number
  /** Fraction digits to use when |value| < 1 */
  digitsSmall?: number
  /** Whether to abbreviate thousands with k suffix */
  abbreviate?: boolean
  /** Minimal absolute value to display when rounding would produce zero */
  minimumNonZero?: number
  /**
   * Use locale-aware compact notation for large values (e.g. "¥28万" in zh,
   * "¥280K" in en). The currency symbol is preserved.
   */
  compact?: boolean
  /** Locale used for number formatting (defaults to the runtime locale) */
  locale?: Intl.LocalesArgument | undefined
}

type ResolvedCurrencyFormatOptions = Omit<
  Required<CurrencyFormatOptions>,
  'locale'
> & {
  locale: Intl.LocalesArgument | undefined
}

type DisplayMeta =
  | {
      kind: 'currency'
      symbol: string
      currencyCode: string
      exchangeRate: number
    }
  | {
      kind: 'custom'
      symbol: string
      exchangeRate: number
    }
  | {
      kind: 'tokens'
      /** Number of tokens per ¥1 */
      quotaPerUnit: number
    }

const DEFAULT_FORMAT_OPTIONS: ResolvedCurrencyFormatOptions = {
  digitsLarge: 2,
  digitsSmall: 4,
  abbreviate: true,
  minimumNonZero: 0,
  compact: false,
  locale: undefined,
}

const DISPLAY_TYPE_VALUES = ['CNY', 'TOKENS', 'CUSTOM'] as const
type DisplayTypeLiteral = (typeof DISPLAY_TYPE_VALUES)[number]

export function isCurrencyDisplayType(
  value: unknown
): value is CurrencyDisplayType {
  return (
    typeof value === 'string' &&
    DISPLAY_TYPE_VALUES.includes(value as DisplayTypeLiteral)
  )
}

export function parseCurrencyDisplayType(
  value: unknown,
  fallback: CurrencyDisplayType = 'CNY'
): CurrencyDisplayType {
  return isCurrencyDisplayType(value) ? value : fallback
}

function getConfig(): CurrencyConfig {
  const { config } = useSystemConfigStore.getState()
  const currency = config?.currency ?? DEFAULT_CURRENCY_CONFIG
  return {
    ...DEFAULT_CURRENCY_CONFIG,
    ...currency,
    quotaPerUnit:
      currency?.quotaPerUnit && currency.quotaPerUnit > 0
        ? currency.quotaPerUnit
        : DEFAULT_CURRENCY_CONFIG.quotaPerUnit,
    customCurrencyExchangeRate:
      currency?.customCurrencyExchangeRate &&
      currency.customCurrencyExchangeRate > 0
        ? currency.customCurrencyExchangeRate
        : DEFAULT_CURRENCY_CONFIG.customCurrencyExchangeRate,
    customCurrencySymbol:
      currency?.customCurrencySymbol?.trim() ||
      DEFAULT_CURRENCY_CONFIG.customCurrencySymbol,
  }
}

function getDisplayMeta(config: CurrencyConfig): DisplayMeta {
  switch (config.quotaDisplayType) {
    case 'CUSTOM':
      return {
        kind: 'custom',
        symbol: config.customCurrencySymbol,
        exchangeRate: config.customCurrencyExchangeRate,
      }
    case 'TOKENS':
      return {
        kind: 'tokens',
        quotaPerUnit: config.quotaPerUnit,
      }
    case 'CNY':
    default:
      // 人民币为计费基准：内部金额已是 ¥，无需汇率换算
      return {
        kind: 'currency',
        symbol: '¥',
        currencyCode: 'CNY',
        exchangeRate: 1,
      }
  }
}

function getBillingDisplayMeta(config: CurrencyConfig): DisplayMeta {
  const meta = getDisplayMeta(config)
  if (meta.kind === 'tokens') {
    return {
      kind: 'currency',
      symbol: '¥',
      currencyCode: 'CNY',
      exchangeRate: 1,
    }
  }
  return meta
}

function mergeOptions(
  options?: CurrencyFormatOptions
): ResolvedCurrencyFormatOptions {
  if (!options) return DEFAULT_FORMAT_OPTIONS
  return {
    digitsLarge: options.digitsLarge ?? DEFAULT_FORMAT_OPTIONS.digitsLarge,
    digitsSmall: options.digitsSmall ?? DEFAULT_FORMAT_OPTIONS.digitsSmall,
    abbreviate: options.abbreviate ?? DEFAULT_FORMAT_OPTIONS.abbreviate,
    minimumNonZero:
      options.minimumNonZero ?? DEFAULT_FORMAT_OPTIONS.minimumNonZero,
    compact: options.compact ?? DEFAULT_FORMAT_OPTIONS.compact,
    locale: options.locale ?? DEFAULT_FORMAT_OPTIONS.locale,
  }
}

function removeTrailingZeros(str: string): string {
  if (!str.includes('.')) return str
  return str.replace(/(\.[0-9]*?)0+$/, '$1').replace(/\.$/, '')
}

function formatNumberWithSuffix(
  value: number,
  digitsLarge: number,
  digitsSmall: number,
  abbreviate: boolean
): string {
  const abs = Math.abs(value)
  if (abbreviate && abs >= 1000) {
    const result = value / 1000
    return `${removeTrailingZeros(result.toFixed(1))}k`
  }

  const digits = abs >= 1 ? digitsLarge : digitsSmall
  return removeTrailingZeros(value.toFixed(digits))
}

function adjustForMinimum(
  value: number,
  digits: number,
  minimumNonZero: number
): number {
  if (value === 0) return value

  const threshold = minimumNonZero > 0 ? minimumNonZero : Math.pow(10, -digits)
  const abs = Math.abs(value)
  if (abs > 0 && abs < threshold) {
    return value > 0 ? threshold : -threshold
  }
  return value
}

function formatCurrencyValue(
  value: number,
  options: ResolvedCurrencyFormatOptions,
  meta: DisplayMeta
): string {
  if (meta.kind === 'tokens') {
    if (options.compact) {
      return new Intl.NumberFormat(options.locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(value)
    }
    return formatNumberWithSuffix(
      value,
      options.digitsLarge,
      options.digitsSmall,
      options.abbreviate
    )
  }

  const digits =
    Math.abs(value) >= 1 ? options.digitsLarge : options.digitsSmall
  const adjustedValue = adjustForMinimum(value, digits, options.minimumNonZero)

  if (meta.kind === 'currency') {
    const formatted = new Intl.NumberFormat(options.locale, {
      style: 'currency',
      currency: meta.currencyCode,
      currencyDisplay: 'narrowSymbol',
      notation: options.compact ? 'compact' : 'standard',
      minimumFractionDigits: 0,
      maximumFractionDigits: options.compact ? 1 : digits,
    }).format(adjustedValue)
    return formatted
  }

  const decimal = new Intl.NumberFormat(options.locale, {
    notation: options.compact ? 'compact' : 'standard',
    minimumFractionDigits: 0,
    maximumFractionDigits: options.compact ? 1 : digits,
  }).format(adjustedValue)

  return `${meta.symbol} ${decimal}`
}

/**
 * Get the current currency configuration and display metadata.
 *
 * @internal Most consumers should use the higher-level formatting functions.
 */
export function getCurrencyDisplay() {
  const config = getConfig()
  const meta = getDisplayMeta(config)
  return { config, meta }
}

/**
 * Format a ¥ amount according to the admin-configured display settings.
 *
 * This is the PRIMARY function for displaying quota/balance/credit amounts, which
 * reach the frontend already denominated in ¥.
 *
 * @param amountCNY - Amount in ¥ (e.g. user balance, quota converted to currency)
 * @returns Formatted string with currency symbol or token count
 *
 * @example
 * // quotaDisplayType: 'CNY'    → formatCurrencyFromCNY(10) → "¥10"
 * // quotaDisplayType: 'CUSTOM' (symbol '$', rate 0.14) → "$1.4"
 * // quotaDisplayType: 'TOKENS' (quotaPerUnit 500000)   → "5,000,000"
 */
export function formatCurrencyFromCNY(
  amountCNY: number | null | undefined,
  options?: CurrencyFormatOptions
): string {
  if (amountCNY == null || Number.isNaN(amountCNY)) return '-'

  const { config, meta } = getCurrencyDisplay()
  const merged = mergeOptions(options)

  if (meta.kind === 'tokens') {
    const tokens = amountCNY * config.quotaPerUnit
    if (merged.compact) {
      return new Intl.NumberFormat(merged.locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(tokens)
    }
    return formatNumberWithSuffix(
      tokens,
      0,
      merged.digitsSmall,
      merged.abbreviate
    )
  }

  const value = amountCNY * meta.exchangeRate

  return formatCurrencyValue(value, merged, meta)
}

/**
 * Format ¥ amounts for billing/payment contexts (never shows tokens).
 *
 * Like formatCurrencyFromCNY, but always renders a real currency value even when the
 * system is configured to display quotas as tokens elsewhere.
 *
 * @param amountCNY - Amount in ¥
 * @returns Formatted string with currency symbol (never tokens)
 */
export function formatBillingCurrencyFromCNY(
  amountCNY: number | null | undefined,
  options?: CurrencyFormatOptions
): string {
  if (amountCNY == null || Number.isNaN(amountCNY)) return '-'

  const { config } = getCurrencyDisplay()
  const meta = getBillingDisplayMeta(config)
  const merged = mergeOptions(options)
  const value =
    meta.kind === 'currency' || meta.kind === 'custom'
      ? amountCNY * meta.exchangeRate
      : amountCNY

  return formatCurrencyValue(value, merged, meta)
}

/**
 * Format raw quota values (token units) to display currency.
 *
 * Converts raw quota to ¥ first (quota / quotaPerUnit), then formats according to
 * display settings. Use when you have quota in token units (e.g. 5000000).
 *
 * @param quota - Raw quota amount in token units (e.g. 5000000)
 * @returns Formatted string with currency symbol or token count
 *
 * @example
 * // quotaPerUnit 500000, quotaDisplayType 'CNY' → formatQuotaWithCurrency(5000000) → "¥10"
 */
export function formatQuotaWithCurrency(
  quota: number | null | undefined,
  options?: CurrencyFormatOptions
): string {
  if (quota == null || Number.isNaN(quota)) return '-'

  const { config } = getCurrencyDisplay()
  const amountCNY = quota / config.quotaPerUnit
  return formatCurrencyFromCNY(amountCNY, options)
}

/**
 * Get the current currency label for UI display.
 *
 * @returns Currency label string (e.g. "CNY", the custom symbol, or "Tokens")
 */
export function getCurrencyLabel(): string {
  const { config, meta } = getCurrencyDisplay()

  if (meta.kind === 'tokens') {
    return 'Tokens'
  }

  switch (config.quotaDisplayType) {
    case 'CUSTOM':
      return meta.kind === 'custom' ? meta.symbol : 'Custom'
    case 'CNY':
    default:
      return 'CNY'
  }
}

/**
 * Check if currency display is enabled (not in token-only mode).
 *
 * @returns True if displaying in actual currency (CNY / custom), false if tokens only
 */
export function isCurrencyDisplayEnabled(): boolean {
  const { meta } = getCurrencyDisplay()
  return meta.kind !== 'tokens'
}

/**
 * Format an amount that is ALREADY in the final display currency.
 *
 * ⚠️ CRITICAL: This function does NOT apply exchange-rate conversion. Only use it for
 * values already converted to the display currency (e.g. a computed payment amount).
 *
 * @param amount - Amount already in the display currency
 * @returns Formatted string with the appropriate currency symbol
 *
 * @example
 * // quotaDisplayType 'CNY' → formatLocalCurrencyAmount(50) → "¥50"
 */
export function formatLocalCurrencyAmount(
  amount: number | null | undefined,
  options?: CurrencyFormatOptions
): string {
  if (amount == null || Number.isNaN(amount)) return '-'

  const { config } = getCurrencyDisplay()
  const meta = getBillingDisplayMeta(config)
  const merged = mergeOptions(options)

  return formatCurrencyValue(amount, merged, meta)
}
