import { atom, read, update } from 'claude-code'
import type { Register, RenderChildren } from 'claude-code'

import type { Etape } from '../types'

const etapes = atom({ plugin: 'avancement', key: 'etapes' } as const, [] as Etape[])

// Compaction automatique vers 400 000 tokens
const SEUIL_COMPACT = 400_000

export const register: Register = on => {
  // Une étape créée par Claude
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) try {
      const id = ran.result.task.id
      await update($, etapes, (list): Etape[] => [
        ...list.filter(x => x.id !== id),
        { id, titre: e.subject, enCours: e.activeForm ?? e.subject, statut: 'pending' },
      ])
    } catch {}
    return ran
  })

  // Une étape qui change d'état
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) try {
      await update($, etapes, (list): Etape[] =>
        e.status === 'deleted'
          ? list.filter(x => x.id !== e.taskId)
          : list.map(x =>
              x.id !== e.taskId
                ? x
                : {
                    ...x,
                    titre: e.subject ?? x.titre,
                    enCours: e.activeForm ?? x.enCours,
                    statut: e.status && e.status !== 'deleted' ? e.status : x.statut,
                  },
            ),
      )
    } catch {}
    return ran
  })

  // Ancienne liste de tâches (TodoWrite) : elle remplace tout
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) try {
      await update($, etapes, (): Etape[] =>
        e.todos.map((t, i) => ({ id: `todo-${i}`, titre: t.content, enCours: t.activeForm, statut: t.status })),
      )
    } catch {}
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    try {
      const { context } = await $.session.usage()
      if ((context.tokens ?? 0) >= SEUIL_COMPACT) {
        $.ui.toast('Conversation longue : compaction automatique')
        await $.session.compact({
          instructions: "Garde l'essentiel : décisions prises, fichiers modifiés, et ce qui reste à faire.",
        })
      }
    } catch {
      $.ui.status('Conversation longue : tape /compact')
    }
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, etapes)
    if (e.props.hasSurvey || list.length === 0) return next(e)

    const faites = list.filter(x => x.statut === 'completed').length
    const total = list.length
    const courante = list.find(x => x.statut === 'in_progress')
    const fini = faites === total
    const numero = Math.min(faites + (courante ? 1 : 0), total)
    const sousTitre = fini
      ? `${total} étapes sur ${total} · tout est fait`
      : `Étape ${Math.max(numero, 1)} sur ${total}${courante ? ' · ' + courante.enCours : ''}`

    const { Box, Button, Text } = $.ui.resolve(e)

    if (e.surface === 'terminal') {
      const ligne = list
        .map(x => `${x.statut === 'completed' ? '●' : x.statut === 'in_progress' ? '◉' : '○'} ${court(x.titre, 14)}`)
        .join(' ── ')
      return (
        <Box>
          <Text color={fini ? 'green' : undefined}>Avancement {faites}/{total}  </Text>
          <Text dimColor>{ligne}</Text>
          {fini ? <Button key="effacer" label="Effacer" onPress={() => update($, etapes, () => [])} /> : null}
        </Box>
      )
    }

    // Frise en texte : point plein = fait, cercle orange = en cours, cercle vide = à faire
    const orange = '#d97757'
    const morceaux: RenderChildren[] = []
    list.forEach((x, i) => {
      if (i > 0) {
        morceaux.push(
          <Box key={`trait-${i}`} flexDirection="column" alignItems="center" flexGrow={1}>
            <Text dimColor={list[i - 1].statut !== 'completed'}>──────</Text>
            <Text> </Text>
          </Box>,
        )
      }
      const fait = x.statut === 'completed'
      const actif = x.statut === 'in_progress'
      morceaux.push(
        <Box key={`etape-${i}`} flexDirection="column" alignItems="center">
          <Text color={actif ? orange : undefined} dimColor={!fait && !actif} bold={actif}>
            {fait ? '●' : actif ? '◉' : '○'}
          </Text>
          <Text size="footnote" color={actif ? orange : undefined} dimColor={!actif}>
            {court(x.titre, 16)}
          </Text>
        </Box>,
      )
    })

    return (
      <Box
        flexDirection="row"
        alignItems="center"
        gap={2}
        paddingX={2}
        paddingY={1}
        borderStyle="round"
        borderDimColor
      >
        <Box flexDirection="column" minWidth={120}>
          <Text bold>Avancement</Text>
          <Text dimColor>{sousTitre}</Text>
        </Box>
        <Box flexDirection="row" alignItems="flex-start" flexGrow={1}>
          {morceaux}
        </Box>
        {fini ? <Button key="effacer" label="Effacer" onPress={() => update($, etapes, () => [])} /> : null}
      </Box>
    )
  })
}

function court(t: string, n: number): string {
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}


