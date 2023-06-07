import { Wiregasm, vectorToArray } from '@goodtools/wiregasm'
// @ts-ignore
import loadWiregasm from '@goodtools/wiregasm/dist/wiregasm'
// @ts-ignore
import wasmModuleCompressed from '@goodtools/wiregasm/dist/wiregasm.wasm.gz?url'
// @ts-ignore
import wasmDataCompressed from '@goodtools/wiregasm/dist/wiregasm.data.gz?url'
import { Buffer } from "buffer"
import pako from "pako";

const wg = new Wiregasm();

function replacer(key: string, value: any) {
  if (value.constructor.name.startsWith("Vector")) {
    return vectorToArray(value);
  }
  return value;
}

const inflateRemoteBuffer = async (url: string) => {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  try {
    return pako.inflate(buf).buffer;
  } catch (err) {
    return buf;
  }
}

const fetchPackages = async () => {
  let [ wasm, data ] = await Promise.all([
    await inflateRemoteBuffer(wasmModuleCompressed),
    await inflateRemoteBuffer(wasmDataCompressed),
  ]);

  return { wasm, data };
}

fetchPackages().then(({ wasm, data }) => {
  wg.init(loadWiregasm, {
    wasmBinary: wasm,
    getPreloadedPackage(name, size) {
      return data;
    },
    handleStatus: (type, status) => postMessage({ type: "status", code: type, status: status }),
  }).then(() => {
    postMessage({ type: "init" })
  }).catch((e) => {
    postMessage({ type: "error", error: e })
  })
}).catch((e) => {
  postMessage({ type: "error", error: e })
})

const MESSAGE_STRATEGIES = {
  columns: () => postMessage({ type: "columns", data: wg.columns() }),
  select: (ev) => {
    const number = ev.data.number;
    const res = wg.frame(number);
    postMessage({ type: "selected", data: JSON.parse(JSON.stringify(res, replacer)) })
  },
  "select-frames": (ev) => {
    const skip = ev.data.skip;
    const limit = ev.data.limit;
    const filter = ev.data.filter;
    const res = wg.frames(filter, skip, limit);
    ev.ports[0].postMessage({ data: JSON.parse(JSON.stringify(res, replacer)) });
  },
  "check-filter": (ev) => {
    const filter = ev.data.filter;
    const res = wg.lib.checkFilter(filter);
    if (res.ok) {
      ev.ports[0].postMessage({result: true });
    } else {
      ev.ports[0].postMessage({error: res.error });
    }
  },
  "process:buffer": (ev) => {
    const name = ev.data.name;
    const data = ev.data.data;
    const res = wg.load(name, Buffer.from(data));
    postMessage({ type: "processed", name: name, data: res });
  },
  "process:file": (ev) => {
    const f = ev.data.file;
    const reader = new FileReader();
    reader.addEventListener('load', (event) => {
      // @ts-ignore
      const res = wg.load(f.name, Buffer.from(event.target.result));
      postMessage({ type: "processed", name: f.name, data: res });
    });
    reader.readAsArrayBuffer(f);
  }
} as Record<string, (ev: MessageEvent) => void>

onmessage = (event) => {
  const type = event.data.type
  MESSAGE_STRATEGIES[type]?.(event)
};
