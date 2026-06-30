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
 * LobeHub Icon Loader
 *
 * `@lobehub/icons` is ~12MB because admins can reference *any* provider icon
 * by name (free-text field), so the whole package is pulled via a wildcard.
 * To keep that weight off the critical path, the package is loaded lazily on
 * first render via dynamic import — the module is fetched once, cached, and
 * shared across every icon.
 *
 * Supports:
 * - Basic: "OpenAI", "OpenAI.Color"
 * - Chained properties: "OpenAI.Avatar.type={'platform'}"
 * - Size parameter: getLobeIcon("OpenAI", 20)
 */
import { useEffect, useState } from 'react'

type LobeModule = typeof import('@lobehub/icons')

let lobeModule: LobeModule | null = null
let lobePromise: Promise<LobeModule> | null = null

function loadLobeModule(): Promise<LobeModule> {
  if (!lobePromise) {
    lobePromise = import('@lobehub/icons')
      .then((m) => {
        lobeModule = m
        return m
      })
      .catch((err) => {
        // Allow a later retry if the chunk failed to load.
        lobePromise = null
        throw err
      })
  }
  return lobePromise
}

function useLobeModule(): LobeModule | null {
  const [mod, setMod] = useState<LobeModule | null>(lobeModule)

  useEffect(() => {
    if (mod) return
    let active = true
    loadLobeModule()
      .then((m) => {
        if (active) setMod(m)
      })
      .catch(() => {
        // Swallow load errors; the fallback placeholder stays rendered.
      })
    return () => {
      active = false
    }
  }, [mod])

  return mod
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
  LobeIcons: LobeModule,
  iconName: string,
  size: number
): React.ReactNode {
  const trimmedName = iconName.trim()

  // Parse component path and chained properties
  const segments = trimmedName.split('.')
  const baseKey = segments[0]
  const BaseIcon = (LobeIcons as Record<string, unknown>)[baseKey] as
    | Record<string, unknown>
    | undefined

  let IconComponent: React.ComponentType<Record<string, unknown>> | undefined
  let propStartIndex: number

  if (BaseIcon && segments.length > 1 && BaseIcon[segments[1]]) {
    IconComponent = BaseIcon[segments[1]] as React.ComponentType<
      Record<string, unknown>
    >
    propStartIndex = 2
  } else {
    IconComponent = (LobeIcons as Record<string, unknown>)[baseKey] as
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
 * Render a LobeHub icon, lazy-loading the icon package on first mount.
 */
export function LobeIcon({
  name,
  size = 20,
}: {
  name?: string | null
  size?: number
}): React.ReactNode {
  const mod = useLobeModule()

  const trimmedName = typeof name === 'string' ? name.trim() : ''
  if (!trimmedName) {
    return <FallbackIcon size={size} char='?' />
  }

  // While the package is still loading, reserve the space with a neutral
  // placeholder so layout does not shift once the icon resolves.
  if (!mod) {
    return <FallbackIcon size={size} char='' />
  }

  return resolveLobeIcon(mod, trimmedName, size)
}

/**
 * Get LobeHub icon node by name. Returns a `<LobeIcon>` element so existing
 * call sites keep working unchanged while the heavy package loads lazily.
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
