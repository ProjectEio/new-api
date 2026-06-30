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
 * Tree-shaken VChart.
 *
 * The full `@visactor/vchart` build registers every chart type (~40MB of
 * source) and is the dominant cost of the production build. We instead pull
 * the modular core constructor and register only the chart types and
 * components actually used by the dashboard / pricing / rankings charts:
 * line, area, bar, pie and sankey, plus tooltip / legend / label / title /
 * cartesian axes. Anything not registered here is tree-shaken away.
 *
 * All chart components must import `VChart` from this module (not from
 * `@visactor/react-vchart`) and read the shared `ChartThemeManager` from here
 * so the full package is never pulled back into the graph.
 */
import { forwardRef } from 'react'
import { VChart as VChartCore } from '@visactor/vchart/esm/core'
import {
  registerAreaChart,
  registerBarChart,
  registerCanvasTooltipHandler,
  registerCartesianBandAxis,
  registerCartesianCrossHair,
  registerCartesianLinearAxis,
  registerDimensionTooltipProcessor,
  registerDiscreteLegend,
  registerDomTooltipHandler,
  registerLabel,
  registerLineChart,
  registerMarkTooltipProcessor,
  registerPieChart,
  registerSankeyChart,
  registerTitle,
  registerTooltip,
} from '@visactor/vchart'
import { VChartSimple } from '@visactor/react-vchart'

// `useRegisters` is VChart's registration API, not a React hook.
// eslint-disable-next-line react-hooks/rules-of-hooks
VChartCore.useRegisters([
  registerLineChart,
  registerAreaChart,
  registerBarChart,
  registerPieChart,
  registerSankeyChart,
  registerCartesianBandAxis,
  registerCartesianLinearAxis,
  registerCartesianCrossHair,
  registerTooltip,
  registerCanvasTooltipHandler,
  registerDomTooltipHandler,
  registerMarkTooltipProcessor,
  registerDimensionTooltipProcessor,
  registerDiscreteLegend,
  registerLabel,
  registerTitle,
])

export const VCHART_OPTION = {
  // 与老前端保持一致（浏览器环境渲染优化）
  mode: 'desktop-browser',
} as const

/** Shared ThemeManager bound to the tree-shaken core constructor. */
export const ChartThemeManager = VChartCore.ThemeManager

/**
 * Drop-in replacement for `@visactor/react-vchart`'s `VChart` that renders
 * through the tree-shaken core constructor.
 */
export const VChart = forwardRef<unknown, Record<string, unknown>>(
  function VChart(props, ref) {
    return (
      <VChartSimple ref={ref} vchartConstructor={VChartCore} {...props} />
    )
  }
)
