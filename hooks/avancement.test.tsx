import { expect, test } from 'claude-code/testing'

for (const surface of ['terminal', 'desktop'] as const) {
  test(`la bande suit les étapes (${surface})`, async ($, on) => {
    let n = 0
    on('tool.call', { tool: 'TaskCreate' }, () => ({ result: { task: { id: String(++n), subject: 'x' } } }) as never)
    on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }) as never)

    const vide = await $.ui.mount({ plugin: 'avancement', surface, component: 'AbovePrompt', props: {} as never })
    expect(JSON.stringify(await vide.find({ type: 'Text' }) ?? null)).not.toContain('Avancement')
    await vide.unmount()

    await $.tool.call({ tool: 'TaskCreate', subject: 'Lire', description: 'a', activeForm: 'Lecture' })
    await $.tool.call({ tool: 'TaskCreate', subject: 'Écrire', description: 'b', activeForm: 'Écriture' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })

    const ui = await $.ui.mount({ plugin: 'avancement', surface, component: 'AbovePrompt', props: {} as never })
    const txt = JSON.stringify(await ui.find({ type: "Box" }))
    expect(txt).toContain('Écrire')
    expect(txt).toContain(surface === 'terminal' ? '1/2' : 'Écriture')
    if (surface === 'desktop') expect(txt).toContain('#d97757')
    await ui.unmount()
  })
}
