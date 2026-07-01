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
import { formatCurrencyFromCNY } from '@/lib/currency'
import { QUOTA_TYPE_VALUES, TOKEN_UNIT_DIVISORS } from '../constants'
import type { PricingModel, TokenUnit, PriceType } from '../types'

// ----------------------------------------------------------------------------
// Price Calculation Utilities
// ----------------------------------------------------------------------------

/**
 * Strip trailing zeros from formatted price string while preserving currency symbols
 */
export function stripTrailingZeros(formatted: string): string {
  // Match currency symbol at start, number, and potential 'k' suffix
  const match = formatted.match(/^([^\d-]*)([-\d,]+\.?\d*)(k?)$/)
  if (!match) return formatted

  const [, symbol, number, suffix] = match

  // Remove commas for processing
  const cleanNumber = number.replace(/,/g, '')

  // Convert to number and back to remove trailing zeros
  const parsed = parseFloat(cleanNumber)
  if (isNaN(parsed)) return formatted

  // Convert to string, which automatically removes trailing zeros
  let result = parsed.toString()

  // If the result is in scientific notation, format it properly
  if (result.includes('e')) {
    result = parsed.toFixed(20).replace(/\.?0+$/, '')
  }

  return `${symbol}${result}${suffix}`
}

/**
 * Find minimum group ratio from enabled groups
 */
function getMinGroupRatio(
  enableGroups: string[],
  groupRatio: Record<string, number>
): number {
  if (enableGroups.length === 0) return 1

  let minRatio = Number.POSITIVE_INFINITY

  for (const group of enableGroups) {
    const ratio = groupRatio[group]
    if (ratio !== undefined && ratio < minRatio) {
      minRatio = ratio
    }
  }

  return minRatio === Number.POSITIVE_INFINITY ? 1 : minRatio
}

/**
 * Calculate the raw token price in ¥ (before recharge-rate / display conversion).
 *
 * Returns NaN when the required ratio field is missing/null so callers can
 * skip rendering that price type.
 */
function calculateTokenPrice(
  model: PricingModel,
  type: PriceType,
  ratio: number
): number {
  const base = model.model_ratio * 2 * ratio

  switch (type) {
    case 'input':
      return base
    case 'output':
      return base * model.completion_ratio
    case 'cache':
      return hasRatio(model.cache_ratio)
        ? base * Number(model.cache_ratio)
        : NaN
    case 'create_cache':
      return hasRatio(model.create_cache_ratio)
        ? base * Number(model.create_cache_ratio)
        : NaN
    case 'image':
      return hasRatio(model.image_ratio)
        ? base * Number(model.image_ratio)
        : NaN
    case 'audio_input':
      return hasRatio(model.audio_ratio)
        ? base * Number(model.audio_ratio)
        : NaN
    case 'audio_output':
      return hasRatio(model.audio_ratio) &&
        hasRatio(model.audio_completion_ratio)
        ? base *
            Number(model.audio_ratio) *
            Number(model.audio_completion_ratio)
        : NaN
  }
}

function hasRatio(value: number | null | undefined): boolean {
  return value !== undefined && value !== null && Number.isFinite(Number(value))
}

/**
 * Apply the recharge rate to a price.
 *
 * `priceRate` is how much a user recharges (in the display currency) to get ¥1 of credit.
 * `displayExchangeRate` converts ¥ into the display currency (1 for CNY; the custom rate
 * for a custom display currency). The result is later formatted by formatCurrencyFromCNY.
 *
 * Example (CNY display, displayExchangeRate = 1):
 *   - Model price: ¥1, priceRate = 0.8 (recharge ¥0.8 to get ¥1 credit)
 *   - Return: 1 × 0.8 / 1 = 0.8 → formatCurrencyFromCNY(0.8) → "¥0.8"
 */
function applyRechargeRate(
  price: number,
  showWithRecharge: boolean,
  priceRate: number,
  displayExchangeRate: number
): number {
  if (!showWithRecharge) return price
  return (price * priceRate) / displayExchangeRate
}

/**
 * Format token-based price for display
 */
export function formatPrice(
  model: PricingModel,
  type: PriceType,
  tokenUnit: TokenUnit,
  showWithRecharge = false,
  priceRate = 1,
  displayExchangeRate = 1
): string {
  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    return '-'
  }

  const enableGroups = Array.isArray(model.enable_groups)
    ? model.enable_groups
    : []
  const groupRatio = model.group_ratio || {}
  const minRatio = getMinGroupRatio(enableGroups, groupRatio)

  let priceInCNY = calculateTokenPrice(model, type, minRatio)
  priceInCNY = applyRechargeRate(
    priceInCNY,
    showWithRecharge,
    priceRate,
    displayExchangeRate
  )

  const price = priceInCNY / TOKEN_UNIT_DIVISORS[tokenUnit]
  return formatCurrencyFromCNY(price, {
    digitsLarge: 4,
    digitsSmall: 6,
    abbreviate: false,
  })
}

/**
 * Format price for a specific group (token-based)
 */
export function formatGroupPrice(
  model: PricingModel,
  group: string,
  type: PriceType,
  tokenUnit: TokenUnit,
  showWithRecharge = false,
  priceRate = 1,
  displayExchangeRate = 1,
  groupRatio: Record<string, number>
): string {
  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    return '-'
  }

  const ratio = groupRatio[group] || 1
  let priceInCNY = calculateTokenPrice(model, type, ratio)

  priceInCNY = applyRechargeRate(
    priceInCNY,
    showWithRecharge,
    priceRate,
    displayExchangeRate
  )

  const price = priceInCNY / TOKEN_UNIT_DIVISORS[tokenUnit]
  return formatCurrencyFromCNY(price, {
    digitsLarge: 4,
    digitsSmall: 6,
    abbreviate: false,
  })
}

/**
 * Format fixed price for pay-per-request models (with specific group)
 */
export function formatFixedPrice(
  model: PricingModel,
  group: string,
  showWithRecharge = false,
  priceRate = 1,
  displayExchangeRate = 1,
  groupRatio: Record<string, number>
): string {
  if (model.quota_type !== QUOTA_TYPE_VALUES.REQUEST) {
    return '-'
  }

  const ratio = groupRatio[group] || 1
  let priceInCNY = (model.model_price || 0) * ratio

  priceInCNY = applyRechargeRate(
    priceInCNY,
    showWithRecharge,
    priceRate,
    displayExchangeRate
  )

  return formatCurrencyFromCNY(priceInCNY, {
    digitsLarge: 4,
    digitsSmall: 4,
    abbreviate: false,
  })
}

/**
 * Format fixed price for pay-per-request models (minimum price from all groups)
 */
export function formatRequestPrice(
  model: PricingModel,
  showWithRecharge = false,
  priceRate = 1,
  displayExchangeRate = 1
): string {
  if (model.quota_type !== QUOTA_TYPE_VALUES.REQUEST) {
    return '-'
  }

  const enableGroups = Array.isArray(model.enable_groups)
    ? model.enable_groups
    : []
  const groupRatio = model.group_ratio || {}
  const minRatio = getMinGroupRatio(enableGroups, groupRatio)

  let priceInCNY = (model.model_price || 0) * minRatio

  priceInCNY = applyRechargeRate(
    priceInCNY,
    showWithRecharge,
    priceRate,
    displayExchangeRate
  )

  return formatCurrencyFromCNY(priceInCNY, {
    digitsLarge: 4,
    digitsSmall: 4,
    abbreviate: false,
  })
}
