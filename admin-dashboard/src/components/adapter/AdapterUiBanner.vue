<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/** Fixed-height banner so all integrations look consistent (Home Assistant–style strip). */
const props = withDefaults(
  defineProps<{
    src?: string | null
    /** Shown when there is no image or the image fails to load (generated-style banner). */
    title?: string
    /** lg = detail hero (10rem), md = cards (6rem), sm = compact lists (4.5rem) */
    size?: 'lg' | 'md' | 'sm'
    rounded?: string
  }>(),
  { size: 'lg', rounded: 'rounded-xl', title: '' }
)

const heightClass = computed(() => {
  if (props.size === 'md') return 'h-24 min-h-[6rem]'
  if (props.size === 'sm') return 'h-[4.5rem] min-h-[4.5rem]'
  return 'h-40 min-h-[10rem]'
})

const titleText = computed(() => props.title?.trim() || 'Adapter')

const imageFailed = ref(false)
watch(
  () => props.src,
  () => {
    imageFailed.value = false
  }
)

const showImage = computed(() => Boolean(props.src) && !imageFailed.value)

/** Match illustrated integration banners: heavy DM Sans, large headline, cool pastel (not body UI grey). */
const titleClass = computed(() => {
  if (props.size === 'sm') return 'text-base font-extrabold leading-tight tracking-tight sm:text-lg'
  if (props.size === 'md') return 'text-xl font-extrabold leading-[1.1] tracking-tight sm:text-2xl md:text-[1.65rem]'
  return 'text-2xl font-extrabold leading-[1.08] tracking-tight sm:text-3xl md:text-4xl'
})

function onImgError() {
  imageFailed.value = true
}
</script>

<template>
  <div
    class="relative w-full overflow-hidden bg-slate-900 ring-1 ring-slate-700/50"
    :class="[rounded, heightClass]"
  >
    <div
      class="absolute inset-0 flex items-center bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 px-3 py-2 sm:px-4 sm:py-2.5"
      aria-hidden="true"
    >
      <p
        class="line-clamp-2 max-w-full font-sans text-sky-100 drop-shadow-[0_2px_14px_rgb(15_23_42/0.55)] [text-shadow:0_1px_0_rgb(255_255_255/0.12)]"
        :class="titleClass"
      >
        {{ titleText }}
      </p>
    </div>
    <img
      v-if="showImage"
      :src="String(src ?? '')"
      alt=""
      class="relative z-10 h-full w-full object-cover object-center"
      loading="lazy"
      @error="onImgError"
    />
  </div>
</template>
