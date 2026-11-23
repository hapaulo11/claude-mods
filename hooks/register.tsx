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
    const sousTitre = fini
      ? 'tout est fait'
      : courante
        ? courante.enCours
        : `${faites} sur ${total} étapes`

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

    const { Svg } = $.ui.resolve(e)
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
        <Box flexDirection="column" minWidth={110}>
          <Text bold>Avancement</Text>
          <Text dimColor>{sousTitre}</Text>
        </Box>
        <Box flexGrow={1}>
          <Svg source={frise(list)} alt={`Étape ${Math.min(faites + 1, total)} sur ${total}`} />
        </Box>
        {fini ? <Button key="effacer" label="Effacer" onPress={() => update($, etapes, () => [])} /> : null}
      </Box>
    )
  })
}

function court(t: string, n: number): string {
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function xml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Frise : points reliés par un trait, nom de l'étape dessous, cercle orange sur l'étape en cours
function frise(list: Etape[]): string {
  const pas = 150
  const w = pas * list.length
  const h = 62
  const y = 18
  const cx = (i: number) => pas / 2 + i * pas
  const gris = '#9b9b9b'
  const orange = '#d97757'
  let traits = ''
  for (let i = 0; i < list.length - 1; i++) {
    const fait = list[i].statut === 'completed'
    traits += `<line x1="${cx(i)}" y1="${y}" x2="${cx(i + 1)}" y2="${y}" stroke="${gris}" stroke-width="2" opacity="${fait ? 0.9 : 0.35}"/>`
  }
  const points = list
    .map((x, i) => {
      const c = cx(i)
      const point =
        x.statut === 'completed'
          ? `<circle cx="${c}" cy="${y}" r="9" fill="#b5b5b5"/>`
          : x.statut === 'in_progress'
            ? `<circle cx="${c}" cy="${y}" r="13" fill="none" stroke="${orange}" stroke-width="2.5"/><circle cx="${c}" cy="${y}" r="9" fill="none" stroke="${gris}" stroke-width="1.5"/>`
            : `<circle cx="${c}" cy="${y}" r="9" fill="none" stroke="${gris}" stroke-width="1.5"/>`
      const couleur = x.statut === 'in_progress' ? orange : gris
      const texte = `<text x="${c}" y="${y + 36}" text-anchor="middle" font-family="-apple-system,Segoe UI,sans-serif" font-size="14" fill="${couleur}">${xml(court(x.titre, 16))}</text>`
      return point + texte
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${traits}${points}</svg>`
}
