import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

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

    // Frise en texte à largeur fixe : deux lignes (points, puis noms), découpées en
    // trois parts (fait, en cours en orange, à faire en gris) pour garder l'alignement
    const orange = '#d97757'
    const L = 14
    const centre = (t: string, c: string) => {
      const reste = L - t.length
      const g = Math.floor(reste / 2)
      return c.repeat(g) + t + c.repeat(reste - g)
    }
    const point = (i: number) => {
      const x = list[i]
      const sym = x.statut === 'completed' ? '●' : x.statut === 'in_progress' ? '◉' : '○'
      const moitie = Math.floor((L - 1) / 2)
      const gauche = (i > 0 ? '─' : ' ').repeat(moitie)
      const droite = (i < list.length - 1 ? '─' : ' ').repeat(L - 1 - moitie)
      return gauche + sym + droite
    }
    const nom = (i: number) => centre(court(list[i].titre, L - 2), ' ')
    const iActif = list.findIndex(x => x.statut === 'in_progress')
    const coupe = iActif >= 0 ? iActif : faites
    const parts = (f: (i: number) => string) => {
      const idx = list.map((_, i) => i)
      return {
        avant: idx.slice(0, coupe).map(f).join(''),
        actif: iActif >= 0 ? f(iActif) : '',
        apres: idx.slice(iActif >= 0 ? iActif + 1 : coupe).map(f).join(''),
      }
    }
    const p1 = parts(point)
    const p2 = parts(nom)

    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderDimColor>
        <Text bold>Avancement</Text>
        <Text dimColor>{sousTitre}</Text>
        <Box overflowX="scroll">
          <Box flexDirection="column">
            <Box flexDirection="row">
              <Text mono>{p1.avant}</Text>
              <Text mono color={orange}>{p1.actif}</Text>
              <Text mono dimColor>{p1.apres}</Text>
            </Box>
            <Box flexDirection="row">
              <Text mono dimColor>{p2.avant}</Text>
              <Text mono color={orange}>{p2.actif}</Text>
              <Text mono dimColor>{p2.apres}</Text>
            </Box>
          </Box>
        </Box>
        {fini ? <Button key="effacer" label="Effacer" onPress={() => update($, etapes, () => [])} /> : null}
      </Box>
    )
  })
}

function court(t: string, n: number): string {
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}


