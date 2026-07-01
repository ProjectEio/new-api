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
import type { IconBaseProps, IconType } from 'react-icons'
import {
  FaBitcoinSign,
  FaBuilding,
  FaBuildingColumns,
  FaCreditCard,
  FaDollarSign,
  FaMobileScreenButton,
  FaMoneyBill,
  FaMoneyBillWave,
  FaMoneyCheckDollar,
  FaQrcode,
  FaWallet,
} from 'react-icons/fa6'
import {
  SiAlipay,
  SiAmericanexpress,
  SiApplepay,
  SiBinance,
  SiBitcoin,
  SiBitcoincash,
  SiCashapp,
  SiCoinbase,
  SiDiscover,
  SiDogecoin,
  SiEthereum,
  SiGooglepay,
  SiKofi,
  SiLitecoin,
  SiMastercard,
  SiPaddle,
  SiPatreon,
  SiPayoneer,
  SiPaypal,
  SiPaytm,
  SiQiwi,
  SiRevolut,
  SiStripe,
  SiTelegram,
  SiTether,
  SiVenmo,
  SiVisa,
  SiWebmoney,
  SiWechat,
  SiWise,
} from 'react-icons/si'

// Curated payment/brand icons resolvable by name. The full `react-icons` set is
// ~38MB across 28 families; loading whole families (as a dynamic name resolver
// must) dwarfs the rest of the bundle. Payment methods only ever need a handful
// of brand/finance glyphs, so they are imported by name (tree-shaken) instead.
// To support a new payment icon, add its `react-icons` export here.
const CURATED_PAYMENT_ICONS: Record<string, IconType> = {
  FaBitcoinSign,
  FaBuilding,
  FaBuildingColumns,
  FaCreditCard,
  FaDollarSign,
  FaMobileScreenButton,
  FaMoneyBill,
  FaMoneyBillWave,
  FaMoneyCheckDollar,
  FaQrcode,
  FaWallet,
  SiAlipay,
  SiAmericanexpress,
  SiApplepay,
  SiBinance,
  SiBitcoin,
  SiBitcoincash,
  SiCashapp,
  SiCoinbase,
  SiDiscover,
  SiDogecoin,
  SiEthereum,
  SiGooglepay,
  SiKofi,
  SiLitecoin,
  SiMastercard,
  SiPaddle,
  SiPatreon,
  SiPayoneer,
  SiPaypal,
  SiPaytm,
  SiQiwi,
  SiRevolut,
  SiStripe,
  SiTelegram,
  SiTether,
  SiVenmo,
  SiVisa,
  SiWebmoney,
  SiWechat,
  SiWise,
}

type ReactIconByNameProps = IconBaseProps & {
  name?: string | null
}

/**
 * Render a curated payment/brand icon by its `react-icons` export name.
 * Unknown or invalid names render nothing, matching the previous resolver.
 */
export function ReactIconByName({ name, ...props }: ReactIconByNameProps) {
  const Icon = name ? CURATED_PAYMENT_ICONS[name.trim()] : undefined
  if (!Icon) return null
  return <Icon {...props} />
}
