<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
    <div>
      <h1 class="font-display text-xl font-semibold text-white">Platform MDM</h1>
      <p class="mt-2 text-sm text-slate-400">
        Hier pflegst du die <strong class="font-medium text-slate-200">kanonischen Asset-Daten</strong> (park_assets, ride/show/restaurant_master_data,
        asset_targets, Runtime-Overrides), die aus den Integrationen (z.&nbsp;B. ThemeParks.wiki) befüllt werden.
      </p>
    </div>

    <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h2 class="text-sm font-semibold text-white">Asset-Daten bearbeiten</h2>
      <ol class="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-300">
        <li>
          <RouterLink to="/admin/master-data/rides" class="text-brand-400 hover:text-brand-300">{{ t('menu.masterData') }} → Attractions</RouterLink>
          öffnen und dort filtern/suchen (Park, Status, Provider, etc.).
        </li>
        <li>
          Attraktion öffnen und auf
          <strong class="text-slate-200">Ride MDM</strong> wechseln — dort öffnet sich die Seite
          <span class="font-mono text-xs text-slate-500">/platform/rides/&lt;assetId&gt;</span>
          (Kapazität, Personal, KPI-Ziele <code class="text-xs text-slate-500">asset_targets</code>, …).
        </li>
        <li>
          Shows, Restaurants und Shops werden aktuell per Sync angelegt; eigene Formular-Editoren dafür sind noch nicht in der UI
          (Daten liegen in der API / DB).
        </li>
      </ol>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <RouterLink
        to="/admin/master-data/rides"
        class="rounded-xl border border-slate-700 bg-slate-950/60 p-4 transition hover:border-brand-500/50 hover:bg-slate-900"
      >
        <p class="text-sm font-medium text-white">{{ t('menu.masterData') }}</p>
        <p class="mt-1 text-xs text-slate-500">Attractions/Shows/Restaurants mit Filtern</p>
      </RouterLink>
      <RouterLink
        to="/platform/oee"
        class="rounded-xl border border-slate-700 bg-slate-950/60 p-4 transition hover:border-brand-500/50 hover:bg-slate-900"
      >
        <p class="text-sm font-medium text-white">OEE — Verfügbarkeit &amp; Stillstände</p>
        <p class="mt-1 text-xs text-slate-500">Gauge · Stillstände · Ziele aus Ride MDM</p>
      </RouterLink>
      <RouterLink
        to="/platform/shift-handover"
        class="rounded-xl border border-slate-700 bg-slate-950/60 p-4 transition hover:border-brand-500/50 hover:bg-slate-900"
      >
        <p class="text-sm font-medium text-white">Schichtübergabe</p>
        <p class="mt-1 text-xs text-slate-500">Handover · Stillstands-Snapshot pro Schichtfenster</p>
      </RouterLink>
      <RouterLink
        to="/platform/shift-handover/logbook"
        class="rounded-xl border border-slate-700 bg-slate-950/60 p-4 transition hover:border-brand-500/50 hover:bg-slate-900"
      >
        <p class="text-sm font-medium text-white">Schicht-Logbuch</p>
        <p class="mt-1 text-xs text-slate-500">Chronologie · Drucken / PDF aus dem Browser</p>
      </RouterLink>
      <RouterLink
        to="/platform/parks"
        class="rounded-xl border border-slate-700 bg-slate-950/60 p-4 transition hover:border-brand-500/50 hover:bg-slate-900"
      >
        <p class="text-sm font-medium text-white">Park explorer</p>
        <p class="mt-1 text-xs text-slate-500">Integration / Sync aus gespeicherter Park-Auswahl</p>
      </RouterLink>
      <RouterLink
        to="/platform/live-queue"
        class="rounded-xl border border-slate-700 bg-slate-950/60 p-4 transition hover:border-brand-500/50 hover:bg-slate-900"
      >
        <p class="text-sm font-medium text-white">Live queue</p>
        <p class="mt-1 text-xs text-slate-500">Letzte Observations (Wartezeit, Status)</p>
      </RouterLink>
      <RouterLink
        to="/platform/map"
        class="rounded-xl border border-slate-700 bg-slate-950/60 p-4 transition hover:border-brand-500/50 hover:bg-slate-900"
      >
        <p class="text-sm font-medium text-white">Asset map</p>
        <p class="mt-1 text-xs text-slate-500">Karte der Assets</p>
      </RouterLink>
      <RouterLink
        to="/platform/visitor-flow"
        class="rounded-xl border border-slate-700 bg-slate-950/60 p-4 transition hover:border-brand-500/50 hover:bg-slate-900"
      >
        <p class="text-sm font-medium text-white">Besucherstrom</p>
        <p class="mt-1 text-xs text-slate-500">Simulierte Pfade · Replay (process-mining-artig)</p>
      </RouterLink>
      <RouterLink
        to="/platform/templates"
        class="rounded-xl border border-slate-700 bg-slate-950/60 p-4 transition hover:border-brand-500/50 hover:bg-slate-900"
      >
        <p class="text-sm font-medium text-white">Templates</p>
        <p class="mt-1 text-xs text-slate-500">Ride-Default-Profile u.&nbsp;a.</p>
      </RouterLink>
      <RouterLink
        to="/integrations"
        class="rounded-xl border border-slate-700 bg-slate-950/60 p-4 transition hover:border-brand-500/50 hover:bg-slate-900"
      >
        <p class="text-sm font-medium text-white">Integrations</p>
        <p class="mt-1 text-xs text-slate-500">Park-Auswahl &amp; Sync (ThemeParks)</p>
      </RouterLink>
    </div>

    <p class="text-xs text-slate-600">
      <span class="text-slate-500">Hinweis:</span> Der Menüpunkt „Ride MDM“ unter
      <span class="font-mono">/mdm</span> ist das <strong class="text-slate-500">ältere</strong> MDM-Modell und nicht dieselbe Datenbank wie die Platform-Assets.
    </p>
  </div>
</template>
