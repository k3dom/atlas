import type * as Artifact from 'atlas/artifact'
import * as Atlas from 'atlas/artifact'
import ReactECharts from 'echarts-for-react/lib/core'
import { TreemapChart, type TreemapSeriesOption } from 'echarts/charts'
import {
  TooltipComponent,
  type TooltipComponentOption,
} from 'echarts/components'
import * as ECharts from 'echarts/core'
import { use as register } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { Array, Order, Predicate } from 'effect'
import { useMemo } from 'react'

import * as Tier from '#/tier.ts'

register([TreemapChart, TooltipComponent, CanvasRenderer])

type Node = Artifact.Artifact['chunks'][number]
type Item = NonNullable<TreemapSeriesOption['data']>[number]

const depth = (node: Node): number =>
  node.kind === 'group'
    ? 1 + Array.max(Array.map(node.children, depth), Order.Number)
    : 1

const item = (node: Node): Item =>
  node.kind === 'group'
    ? {
        id: node.id,
        name: node.name,
        children: Array.map(node.children, item),
        itemStyle: { borderColor: '#d6d3d1' },
      }
    : {
        id: node.id,
        name: node.name,
        value: Atlas.lines(node),
        itemStyle: { color: Tier.color[node.tier] },
        label: { color: Tier.ink[node.tier] },
      }

export const Treemap = ({
  artifact,
  selected,
  onSelect,
}: {
  readonly artifact: Artifact.Artifact
  readonly selected: string | undefined
  readonly onSelect: (id: string | undefined) => void
}) => {
  const byId = useMemo(
    () => new Map(Array.map(Atlas.nodes(artifact.chunks), (n) => [n.id, n])),
    [artifact]
  )

  const option = useMemo(
    (): ECharts.ComposeOption<
      TreemapSeriesOption | TooltipComponentOption
    > => ({
      tooltip: {
        formatter: (params) => {
          const data = (Array.isArray(params) ? params[0] : params)?.data
          const node = Predicate.hasProperty(data, 'id')
            ? byId.get(globalThis.String(data.id))
            : undefined
          if (node === undefined) {
            return ''
          }
          const name = `<b>${ECharts.format.encodeHTML(node.name)}</b>`
          const lines = `${Atlas.lines(node)} lines`
          return node.kind === 'group'
            ? `${name}<br/>${lines}`
            : `${name}<br/>Tier ${node.tier}, ${Tier.label[node.tier]}<br/>${lines}`
        },
      },
      series: [
        {
          type: 'treemap',
          name: Array.join(artifact.roots, ', '),
          data: Array.map(artifact.chunks, item),
          nodeClick: false,
          leafDepth: Array.max(Array.map(artifact.chunks, depth), Order.Number),
          selectedMode: 'single',
          top: 8,
          left: 8,
          right: 8,
          bottom: 40,
          visibleMin: 100,
          animationDurationUpdate: 500,
          breadcrumb: { left: 8, bottom: 8 },
          label: { formatter: '{b}' },
          upperLabel: { show: true, height: 22, color: '#1c1917' },
          itemStyle: { borderColor: '#fafaf9', borderWidth: 2, gapWidth: 2 },
          select: { itemStyle: { borderColor: '#eb6834' } },
        },
      ],
    }),
    [artifact, byId]
  )

  return (
    <ReactECharts
      echarts={ECharts}
      option={option}
      notMerge
      style={{ width: '100%', height: '100%' }}
      onEvents={{
        click: (
          params: { readonly data?: { readonly id?: string } },
          chart: ECharts.EChartsType
        ) => {
          const node = byId.get(params.data?.id ?? '')
          if (node === undefined) {
            return
          }
          if (node.kind === 'group') {
            chart.dispatchAction({
              type: 'treemapRootToNode',
              seriesIndex: 0,
              targetNodeId: node.id,
            })
          }
          // ECharts toggles the selection of the node on click by itself.
          onSelect(node.id === selected ? undefined : node.id)
        },
      }}
    />
  )
}
