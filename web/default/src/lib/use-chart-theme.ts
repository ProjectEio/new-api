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
import { useEffect, useRef, useState } from 'react'
import { ChartThemeManager } from '@/lib/vchart'
import { useTheme } from '@/context/theme-provider'

/**
 * Switch VChart's `ThemeManager` to follow the resolved app theme
 * (light / dark). Returns flags consumers can use to defer chart rendering
 * until the theme is ready. The ThemeManager comes from the tree-shaken
 * core constructor (see `@/lib/vchart`), so no extra package is loaded.
 */
type ThemeManager = typeof ChartThemeManager

export function useChartTheme() {
  const { resolvedTheme } = useTheme()
  const [themeReady, setThemeReady] = useState(false)
  const themeRef = useRef<ThemeManager | null>(null)

  useEffect(() => {
    themeRef.current = ChartThemeManager
    ChartThemeManager.setCurrentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
    setThemeReady(true)
  }, [resolvedTheme])

  return { resolvedTheme, themeReady }
}
