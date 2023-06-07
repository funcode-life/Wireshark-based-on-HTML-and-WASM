import { nodePolyfills } from 'vite-plugin-node-polyfills'
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    'nuxt-windicss',
  ],
  plugins: [
    './plugins/antd.ts',
  ],
  ssr: false,
  vite: {
    plugins: [
      nodePolyfills()
    ]
  }
})
