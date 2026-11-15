// Escritas no Trello/Power-Up pelo Produzia: uma camada só, usada pelo editor de card (drawer),
// pelo cronograma e pelo reagendamento do resumo do dia.
import { ApiError, api } from './api.js'
import { addDays, parseDay, toIso } from './format.js'

const card = (id) => `/cards/${id}`

export const cardApi = {
  get: (id) => api(card(id)),
  update: (id, body) => api(card(id), { method: 'PATCH', body }),
  addMember: (id, memberId) => api(`${card(id)}/membros`, { method: 'POST', body: { id: memberId } }),
  removeMember: (id, memberId) => api(`${card(id)}/membros/${memberId}`, { method: 'DELETE' }),
  addLabel: (id, labelId) => api(`${card(id)}/etiquetas`, { method: 'POST', body: { id: labelId } }),
  removeLabel: (id, labelId) => api(`${card(id)}/etiquetas/${labelId}`, { method: 'DELETE' }),
  addComment: (id, texto) => api(`${card(id)}/comentarios`, { method: 'POST', body: { texto } }),
  editComment: (id, actionId, texto) => api(`${card(id)}/comentarios/${actionId}`, { method: 'PATCH', body: { texto } }),
  deleteComment: (id, actionId) => api(`${card(id)}/comentarios/${actionId}`, { method: 'DELETE' }),
  addChecklist: (id, nome) => api(`${card(id)}/checklists`, { method: 'POST', body: { nome } }),
  addItem: (id, checklistId, body) => api(`${card(id)}/checklists/${checklistId}/itens`, { method: 'POST', body }),
  updateItem: (id, itemId, body) => api(`${card(id)}/itens/${itemId}`, { method: 'PATCH', body }),
  deleteItem: (id, itemId) => api(`${card(id)}/itens/${itemId}`, { method: 'DELETE' }),
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

// Uma chamada com novas tentativas quando o Trello limita (429): 2 s, 4 s, 8 s.
export async function withRetry(fn, tries = 3) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 429 || attempt >= tries) throw err
      await wait(2000 * 2 ** attempt)
    }
  }
}

// Executa as tarefas uma de cada vez (o Trello aceita ~100 chamadas a cada 10 s por token),
// com um respiro entre elas. Devolve { ok: [{task, result}], falhas: [{task, erro}] }.
export async function runQueue(tasks, { onProgress, gap = 150 } = {}) {
  const ok = []
  const falhas = []
  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i]
    try {
      ok.push({ task, result: await withRetry(task.run) })
    } catch (err) {
      falhas.push({ task, erro: err.message || 'Erro desconhecido' })
    }
    onProgress?.(i + 1, tasks.length)
    if (i < tasks.length - 1) await wait(gap)
  }
  return { ok, falhas }
}

// Atalhos de data do reagendamento.
export function dateShortcuts(today) {
  const d = parseDay(today)
  const toMonday = ((8 - d.getDay()) % 7) || 7
  return [
    { key: 'hoje', label: 'Hoje', date: today },
    { key: 'amanha', label: 'Amanhã', date: addDays(today, 1) },
    { key: 'segunda', label: 'Próxima segunda', date: addDays(today, toMonday) },
    { key: 'semana', label: '+1 semana', date: addDays(today, 7) },
  ]
}

export const todayIso = () => toIso(new Date())

// Teclas de atalho só valem fora de campos de texto.
export const typing = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable

// Tarefas de lote do resumo do dia. `e` é uma pendência do buildFeeds (kind, cardId, itemId, prazo, inicio).
// Cada tarefa sabe se desfazer a partir do resultado.
export function rescheduleTask(e, date) {
  if (e.kind === 'card') {
    return {
      e, date,
      run: () => cardApi.update(e.cardId, { prazo: date, ajustarInicio: true }),
      undo: (res) => cardApi.update(e.cardId, res?.anterior ? { inicio: res.anterior.inicio, prazo: res.anterior.prazo } : { prazo: null }),
    }
  }
  const body = { dataFim: date }
  if (e.inicio && e.inicio > date) body.dataInicio = date // o início não pode passar do prazo
  return {
    e, date,
    run: () => cardApi.updateItem(e.cardId, e.itemId, body),
    undo: () => cardApi.updateItem(e.cardId, e.itemId, { dataFim: e.prazo || null, dataInicio: e.inicio || null }),
  }
}

export function completeTask(e) {
  return e.kind === 'card'
    ? { e, run: () => cardApi.update(e.cardId, { concluido: true }), undo: () => cardApi.update(e.cardId, { concluido: false }) }
    : { e, run: () => cardApi.updateItem(e.cardId, e.itemId, { feito: true }), undo: () => cardApi.updateItem(e.cardId, e.itemId, { feito: false }) }
}
