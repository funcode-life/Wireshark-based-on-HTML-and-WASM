<template>
  <a-alert message="WebAssembly Wireshark" type="info" show-icon />
  <input type="file" @change="fileChangeHandler">
  <div v-if="processed" class="my-10px">
    <ATag color="green">总包数: {{ summary.total_packets }}</ATag>
    <ATag color="green">开始时间: {{ start_time }}</ATag>
    <ATag color="green">结束时间: {{ stop_time }}</ATag>
  </div>
  <AInput v-model:value="filter_input" placeholder="display filter, example: tcp" />
  <ATable
    :loading="loading"
    :columns="columns"
    :data-source="data_source"
    :pagination="pagination"
    size="small"
    :customRow="customRowHandler"
    :scroll="{ y: 240 }"
    class="packet-table"
    @change="tableChangeHandler"
  />
  <AAlert v-if="(typeof filter_ret !== 'boolean')">
    {{ filter_ret }}
  </AAlert>
  <div class="flex">
    <ATree
      :tree-data="selected_packet_tree"
      :fieldNames="{ children:'tree', title:'label', key:'id' }"
      block-node
    />

  </div>
</template>
<script lang="ts" setup>
  import { get, map, reduce } from 'lodash'
  import { MessageData } from '~/utils/wireshark.worker'

  const selected_row_idx = ref(0)
  const selected_packet_tree = ref([] as Tree[])
  const customRowHandler = ({ raw }: any, idx: number) => {
    const bg = raw.number === selected_row_idx.value ? 'blue' : `#${Number(raw.bg).toString(16)}`
    const fg = raw.number === selected_row_idx.value ? 'white' : `#${Number(raw.fg).toString(16)}`
    return {
      style: `background: ${bg}; color: ${fg};cursor: pointer;`,
      onClick: () => selected_row_idx.value = raw.number
    }
  }

  const initialized = ref(false)
  const processed = ref(false)
  const loading = ref(true)
  const summary = ref({
    start_time: 0,
    stop_time: 0,
    total_packets: 0,
  })
  const start_time = computed(() => {
    return new Date(summary.value.start_time * 1000)
  })
  const stop_time = computed(() => {
    return new Date(summary.value.stop_time * 1000)
  })

  const columns = ref([] as Record<string, any>)
  const column_width = {
    'No.': 60,
    'Source': 150,
    'Destination': 150,
    default: 100,
  } as Record<string, number>
  const data_source = ref([] as Record<string, any>)
  const worker = new Worker(new URL('~/utils/wireshark.worker.ts', import.meta.url), {
    type: 'module',
  })

  const fileChangeHandler = async (ev: Event) => {
    const f = (ev.target as HTMLInputElement).files?.[0]
    if (!f) return window.alert('文件不存在')
    processed.value = false
    const buf = await f?.arrayBuffer()
    worker.postMessage({
      type: 'process:buffer',
      data: buf,
    }, [buf])
  }

  const page_index = ref(1)
  const page_size = ref(10)
  const pagination = computed(() => ({
    total: summary.value.total_packets,
    current: page_index.value,
    pageSize: page_size.value,
  }))
  const fetchTableData = async () => {
    loading.value = true
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = ev => {
      const { data } = ev.data
      data_source.value = map(data?.frames, (f: any) => {
        return reduce(columns.value, (acc: Record<string, any>, col: Record<string, any>, idx: any) => {
          acc[col.dataIndex] = get(f, ['columns', idx])
          return acc
        }, {
          raw: f,
        })
      })
      port1.onmessage = null
      port1.close()
      port2.close()
      loading.value = false
    }
    worker.postMessage({
      type: 'select-frames',
      skip: (page_index.value - 1) *  page_size.value,
      limit: page_size.value,
      filter: filter_input.value,
    }, [port2])
  }
  const tableChangeHandler = (page: { pageSize: number, current: number }) => {
    page_index.value = page.current
    page_size.value = page.pageSize
    fetchTableData()
  }

  async function fetchPacketDetail() {
    if (!processed.value) return
    worker.postMessage({
      type: 'select',
      number: selected_row_idx.value,
    })
  }
  watchEffect(() => fetchPacketDetail())

  const filter_input = ref('')
  const filter_ret = ref(true)
  const filterChangeHandler = () => {
    if (!processed.value) return
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = ev => {
      filter_ret.value = ev.data.data
      if (filter_ret.value === true) fetchTableData()
    }
    worker.postMessage({
      type: 'check-filter',
      data: filter_input.value,
    }, [port2])
  }
  watchEffect(() => filterChangeHandler())

  interface Tree {
    label: string;
    [key: string]: any;
  }
  const processPacketTree = (tree: Tree[], id_prefix = ''): Tree[] => map(tree, (t: Tree, idx: number) => {
    const id = `${id_prefix}${idx}`
    return {
      ...t,
      id,
      tree: processPacketTree(t.tree, `${id}-`)
    }
  })

  const MESSAGE_STRATEGIES = {
    init: ev => {
      initialized.value = true
      loading.value = false
      worker.postMessage({ type: 'columns' })
    },
    columns: ev => {
      const cols = ev.data.data
      const end = cols.length - 1
      columns.value = map(cols, (c: string, idx: number) => {
        return {
          title: c,
          dataIndex: c,
          width: idx < end ? (column_width[c] || column_width['default']) : undefined,
        }
      })
    },
    processed: ev => {
      const { summary: _summary } = ev.data.data
      summary.value = {
        start_time: _summary.start_time,
        stop_time: _summary.stop_time,
        total_packets: _summary.packet_count,
      }
      processed.value = true
      fetchTableData()
      selected_row_idx.value = 1
    },
    selected: ev => {
      selected_packet_tree.value = processPacketTree(ev.data.data?.tree)
    }
  } as Record<string, (ev: MessageEvent<MessageData>) => void>

  worker.addEventListener('message', (ev: MessageEvent) => {
    const type = ev.data.type as string
    MESSAGE_STRATEGIES[type]?.(ev)
  })
</script>
<style lang="scss" scoped>
  .packet-table {
    :deep(.ant-table-tbody > tr > td.ant-table-cell-row-hover),
    :deep(.ant-table-tbody > tr.ant-table-row:hover > td) {
      background: transparent;
    }

    :deep(.ant-table.ant-table-small .ant-table-tbody > tr > td) {
      padding: 0;
    }

    :deep(.ant-table-pagination.ant-pagination) {
      margin: 5px 0;
    }
  }
</style>
