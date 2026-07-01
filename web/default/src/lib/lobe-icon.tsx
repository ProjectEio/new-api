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
/* eslint-disable react-refresh/only-export-components */
/**
 * LobeHub Icon Loader (curated)
 *
 * The full `@lobehub/icons` package is ~12MB. Since this build serves a fixed
 * set of providers, only a curated set of provider/model-family icons is
 * imported statically (tree-shaken) instead of pulling the whole package via a
 * wildcard. Icons are resolved by name; names outside the curated set fall back
 * to a neutral letter placeholder.
 *
 * To support a new icon, add its `@lobehub/icons` export to CURATED_ICONS.
 *
 * Supports:
 * - Basic: "OpenAI", "OpenAI.Color"
 * - Chained properties: "OpenAI.Avatar.type={'platform'}"
 * - Size parameter: getLobeIcon("OpenAI", 20)
 */
import Ai360 from '@lobehub/icons/es/Ai360'
import Anthropic from '@lobehub/icons/es/Anthropic'
import Aws from '@lobehub/icons/es/Aws'
import Azure from '@lobehub/icons/es/Azure'
import Baidu from '@lobehub/icons/es/Baidu'
import ChatGLM from '@lobehub/icons/es/ChatGLM'
import Claude from '@lobehub/icons/es/Claude'
import Cloudflare from '@lobehub/icons/es/Cloudflare'
import Cohere from '@lobehub/icons/es/Cohere'
import DeepSeek from '@lobehub/icons/es/DeepSeek'
import Doubao from '@lobehub/icons/es/Doubao'
import Gemini from '@lobehub/icons/es/Gemini'
import Google from '@lobehub/icons/es/Google'
import Grok from '@lobehub/icons/es/Grok'
import Groq from '@lobehub/icons/es/Groq'
import HuggingFace from '@lobehub/icons/es/HuggingFace'
import Hunyuan from '@lobehub/icons/es/Hunyuan'
import Kimi from '@lobehub/icons/es/Kimi'
import Meta from '@lobehub/icons/es/Meta'
import Microsoft from '@lobehub/icons/es/Microsoft'
import Minimax from '@lobehub/icons/es/Minimax'
import Mistral from '@lobehub/icons/es/Mistral'
import Moonshot from '@lobehub/icons/es/Moonshot'
import NewAPI from '@lobehub/icons/es/NewAPI'
import Nvidia from '@lobehub/icons/es/Nvidia'
import Ollama from '@lobehub/icons/es/Ollama'
import OpenAI from '@lobehub/icons/es/OpenAI'
import OpenRouter from '@lobehub/icons/es/OpenRouter'
import Perplexity from '@lobehub/icons/es/Perplexity'
import Qwen from '@lobehub/icons/es/Qwen'
import Spark from '@lobehub/icons/es/Spark'
import Volcengine from '@lobehub/icons/es/Volcengine'
import Wenxin from '@lobehub/icons/es/Wenxin'
import XAI from '@lobehub/icons/es/XAI'
import Yi from '@lobehub/icons/es/Yi'
import Zhipu from '@lobehub/icons/es/Zhipu'

// Curated provider / model-family icons (kept providers + common families).
const CURATED_ICONS: Record<string, unknown> = {
  Ai360,
  Anthropic,
  Aws,
  Azure,
  Baidu,
  ChatGLM,
  Claude,
  Cloudflare,
  Cohere,
  DeepSeek,
  Doubao,
  Gemini,
  Google,
  Grok,
  Groq,
  HuggingFace,
  Hunyuan,
  Kimi,
  Meta,
  Microsoft,
  Minimax,
  Mistral,
  Moonshot,
  NewAPI,
  Nvidia,
  Ollama,
  OpenAI,
  OpenRouter,
  Perplexity,
  Qwen,
  Spark,
  Volcengine,
  Wenxin,
  XAI,
  Yi,
  Zhipu,
}

/**
 * Parse a property value from string to appropriate type
 * @param raw - Raw string value
 * @returns Parsed value (boolean, number, or string)
 */
function parseValue(raw: string | undefined | null): string | number | boolean {
  if (raw == null) return true

  let v = String(raw).trim()

  // Remove curly braces
  if (v.startsWith('{') && v.endsWith('}')) {
    v = v.slice(1, -1).trim()
  }

  // Remove quotes
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1)
  }

  // Boolean
  if (v === 'true') return true
  if (v === 'false') return false

  // Number
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v)

  // Return as string
  return v
}

function FallbackIcon({ size, char }: { size: number; char: string }) {
  return (
    <div
      className='bg-muted text-muted-foreground flex items-center justify-center rounded-full text-xs font-medium'
      style={{ width: size, height: size }}
    >
      {char}
    </div>
  )
}

function resolveLobeIcon(
  icons: Record<string, unknown>,
  iconName: string,
  size: number
): React.ReactNode {
  const trimmedName = iconName.trim()

  // Parse component path and chained properties
  const segments = trimmedName.split('.')
  const baseKey = segments[0]
  const BaseIcon = icons[baseKey] as Record<string, unknown> | undefined

  let IconComponent: React.ComponentType<Record<string, unknown>> | undefined
  let propStartIndex: number

  if (BaseIcon && segments.length > 1 && BaseIcon[segments[1]]) {
    IconComponent = BaseIcon[segments[1]] as React.ComponentType<
      Record<string, unknown>
    >
    propStartIndex = 2
  } else {
    IconComponent = icons[baseKey] as
      | React.ComponentType<Record<string, unknown>>
      | undefined
    propStartIndex = segments.length > 1 && /^[A-Z]/.test(segments[1]) ? 2 : 1
  }

  // Fallback if icon not found
  if (
    !IconComponent ||
    (typeof IconComponent !== 'function' && typeof IconComponent !== 'object')
  ) {
    return (
      <FallbackIcon size={size} char={trimmedName.charAt(0).toUpperCase()} />
    )
  }

  // Parse chained properties (e.g., "type={'platform'}", "shape='square'")
  const props: Record<string, string | number | boolean> = {}

  for (let i = propStartIndex; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg) continue

    const eqIdx = seg.indexOf('=')
    if (eqIdx === -1) {
      props[seg.trim()] = true
      continue
    }

    const key = seg.slice(0, eqIdx).trim()
    const valRaw = seg.slice(eqIdx + 1).trim()
    props[key] = parseValue(valRaw)
  }

  // Set size if not explicitly specified in the string
  if (props.size == null && size != null) {
    props.size = size
  }

  return <IconComponent {...props} />
}

/**
 * Render a LobeHub icon from the curated set.
 */
export function LobeIcon({
  name,
  size = 20,
}: {
  name?: string | null
  size?: number
}): React.ReactNode {
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  if (!trimmedName) {
    return <FallbackIcon size={size} char='?' />
  }

  return resolveLobeIcon(CURATED_ICONS, trimmedName, size)
}

/**
 * Get LobeHub icon node by name. Returns a `<LobeIcon>` element so existing
 * call sites keep working unchanged.
 *
 * @example
 * getLobeIcon("OpenAI", 24)
 * getLobeIcon("OpenAI.Color", 20)
 * getLobeIcon("Claude.Avatar.type={'platform'}", 32)
 */
export function getLobeIcon(
  iconName: string | undefined | null,
  size: number = 20
): React.ReactNode {
  return <LobeIcon name={iconName} size={size} />
}
