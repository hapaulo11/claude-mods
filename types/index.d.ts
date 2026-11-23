export type Etape = { id: string; titre: string; enCours: string; statut: 'pending' | 'in_progress' | 'completed' }

declare module 'claude-code' {
  interface PluginState {
    avancement: { etapes: Etape[] }
  }
}
