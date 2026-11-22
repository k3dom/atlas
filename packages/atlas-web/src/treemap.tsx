import * as Artifact from 'atlas/artifact'
import ReactECharts from 'echarts-for-react/lib/core'
import { TreemapChart, type TreemapSeriesOption } from 'echarts/charts'
import {
  TooltipComponent,
  type TooltipComponentOption,
} from 'echarts/components'
import * as ECharts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { Array, Order, Predicate } from 'effect'
import { useMemo } from 'react'

import * as Tier from '#/tier.ts'

// oxlint-disable-next-line react/rules-of-hooks -- registers chart parts, not a hook
ECharts.use([TreemapChart, TooltipComponent, CanvasRenderer])

type Node = Artifact.Node<Artifact.MeasuredFile>

const surface = '#fafaf9'
const ink = '#1c1917'
const groupBorder = '#d6d3d1'
const selection = '#eb6834'

const depth = (node: Node): number =>
  node.kind === 'group'
    ? 1 + Array.max(Array.map(node.children, depth), Order.Number)
    : 1

const item = (node: Node): NonNullable<TreemapSeriesOption['data']>[number] =>
  node.kind === 'group'
    ? {
        id: node.id,
        name: node.name,
        children: Array.map(node.children, item),
        itemStyle: { borderColor: groupBorder },
      }
    : {
        id: node.id,
        name: node.name,
        value: Artifact.lines(node),
        itemStyle: { color: Tier.color[node.tier] },
        label: { color: Tier.ink[node.tier] },
      }

const nodeOf = (nodes: ReadonlyMap<string, Node>, params: unknown) => {
  const data = Predicate.hasProperty(params, 'data') ? params.data : undefined
  return Predicate.hasProperty(data, 'id') && Predicate.isString(data.id)
    ? nodes.get(data.id)
    : undefined
}

export const Treemap = ({
  artifact,
  nodes,
  selected,
  onSelect,
}: {
  readonly artifact: Artifact.Artifact
  readonly nodes: ReadonlyMap<string, Node>
  readonly selected: string | undefined
  readonly onSelect: (id: string | undefined) => void
}) => {
  const option = useMemo(
    (): ECharts.ComposeOption<
      TreemapSeriesOption | TooltipComponentOption
    > => ({
      tooltip: {
        formatter: (params) => {
          const node = nodeOf(nodes, params)
          if (node === undefined) {
            return ''
          }
          const name = `<b>${ECharts.format.encodeHTML(node.name)}</b>`
          const lines = `${Artifact.lines(node)} lines`
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
          upperLabel: { show: true, height: 22, color: ink },
          itemStyle: { borderColor: surface, borderWidth: 2, gapWidth: 2 },
          select: { itemStyle: { borderColor: selection } },
        },
      ],
    }),
    [artifact, nodes]
  )

  return (
    <ReactECharts
      echarts={ECharts}
      option={option}
      notMerge
      style={{ width: '100%', height: '100%' }}
      onEvents={{
        click: (params: unknown, chart: ECharts.EChartsType) => {
          const node = nodeOf(nodes, params)
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
