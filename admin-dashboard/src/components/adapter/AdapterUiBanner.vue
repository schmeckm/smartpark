<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * Fixed-height banner so all integrations look consistent.
 *
 * Typography is owned by the template (Smart Park design system):
 * every adapter renders its title with the same font (Outfit / display),
 * the same weight, the same colour (slate-50) and the same dark
 * brand-tinted background — no matter what the provider's banner image
 * looks like. Provider banner images are rendered behind the title with
 * a darkening scrim so the text always reads consistently.
 */
const props = withDefaults(
  defineProps<{
    src?: string | null
    /** Shown for every adapter — the template controls font + colour. */
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

/** Same display font family + weight + tracking for every adapter & every size. */
const titleClass = computed(() => {
  if (props.size === 'sm') return 'text-base font-semibold leading-tight tracking-tight sm:text-lg'
  if (props.size === 'md') return 'text-xl font-semibold leading-[1.1] tracking-tight sm:text-2xl md:text-[1.6rem]'
  return 'text-2xl font-semibold leading-[1.08] tracking-tight sm:text-3xl md:text-[2.25rem]'
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
    <img
      v-if="showImage"
      :src="String(src ?? '')"
      alt=""
      class="absolute inset-0 h-full w-full object-cover object-center opacity-40"
      loading="lazy"
      @error="onImgError"
    />
    <div
      class="absolute inset-0 bg-gradient-to-br from-slate-950/90 via-slate-950/70 to-brand-900/60"
      aria-hidden="true"
    />
    <div
      class="relative flex h-full items-center px-3 py-2 sm:px-4 sm:py-2.5"
    >
      <p
        class="line-clamp-2 max-w-full font-display text-slate-50 drop-shadow-[0_2px_14px_rgb(15_23_42/0.55)]"
        :class="titleClass"
      >
        {{ titleText }}
      </p>
    </div>
  </div>
</template>
