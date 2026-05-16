import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'
import '@vue-flow/controls/dist/style.css'
import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import { initThemeFromStorage } from './composables/useUiTheme'
import { useAuthStore } from './stores/auth'

initThemeFromStorage()

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(i18n)
app.use(router)

window.addEventListener('sp:unauthorized', () => {
  const auth = useAuthStore()
  auth.clearSession()
  if (router.currentRoute.value.name !== 'login') {
    void router.replace({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
  }
})

app.mount('#app')
