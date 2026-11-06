import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { PushEvent, RevvaApi } from '@shared/types'

const api: RevvaApi = {
  service: {
    status: () => ipcRenderer.invoke(IPC.serviceStatus),
    retry: () => ipcRenderer.invoke(IPC.serviceRetry)
  },
  toolchain: {
    probe: () => ipcRenderer.invoke(IPC.toolchainProbe)
  },
  mcp: {
    list: (directory) => ipcRenderer.invoke(IPC.mcpList, directory),
    reconnect: (server, directory) => ipcRenderer.invoke(IPC.mcpReconnect, server, directory)
  },
  inventory: {
    agents: (sessionId) => ipcRenderer.invoke(IPC.inventoryAgents, sessionId),
    models: () => ipcRenderer.invoke(IPC.inventoryModels),
    skills: () => ipcRenderer.invoke(IPC.inventorySkills)
  },
  settings: {
    get: (key) => ipcRenderer.invoke(IPC.settingsGet, key),
    set: (key, value) => ipcRenderer.invoke(IPC.settingsSet, key, value)
  },
  keepAwake: {
    get: () => ipcRenderer.invoke(IPC.keepAwakeGet),
    set: (enabled) => ipcRenderer.invoke(IPC.keepAwakeSet, enabled)
  },
  dictation: {
    detect: () => ipcRenderer.invoke(IPC.dictationDetect)
  },
  workspace: {
    list: () => ipcRenderer.invoke(IPC.workspaceList),
    repositories: (id) => ipcRenderer.invoke(IPC.workspaceRepositories, id),
    add: (path) => ipcRenderer.invoke(IPC.workspaceAdd, path),
    remove: (id) => ipcRenderer.invoke(IPC.workspaceRemove, id),
    pickFolder: () => ipcRenderer.invoke(IPC.dialogPickFolder),
    setSetupCommand: (id, command) => ipcRenderer.invoke(IPC.workspaceSetSetupCommand, id, command),
    runSetupCommand: (workId) => ipcRenderer.invoke(IPC.workspaceRunSetupCommand, workId)
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IPC.shellOpenExternal, url)
  },
  app: {
    meta: () => ipcRenderer.invoke(IPC.appMeta)
  },
  chat: {
    list: () => ipcRenderer.invoke(IPC.chatList),
    create: (input) => ipcRenderer.invoke(IPC.chatCreate, input),
    messages: (sessionId, since, requestId) => ipcRenderer.invoke(IPC.chatMessages, sessionId, since, requestId),
    prompt: (sessionId, text, images, queued, refs, sentAt) => ipcRenderer.invoke(IPC.chatPrompt, sessionId, text, images, queued, refs, sentAt),
    interrupt: (sessionId) => ipcRenderer.invoke(IPC.chatInterrupt, sessionId),
    rename: (sessionId, title) => ipcRenderer.invoke(IPC.chatRename, sessionId, title),
    repoStatus: (sessionId) => ipcRenderer.invoke(IPC.chatRepoStatus, sessionId),
    openVSCode: (sessionId) => ipcRenderer.invoke(IPC.chatOpenVSCode, sessionId),
    setTicket: (sessionId, ticketKey) => ipcRenderer.invoke(IPC.chatSetTicket, sessionId, ticketKey),
    markSeen: (sessionId) => ipcRenderer.invoke(IPC.chatSeen, sessionId),
    remove: (sessionId) => ipcRenderer.invoke(IPC.chatDelete, sessionId)
  },
  session: {
    children: (sessionId) => ipcRenderer.invoke(IPC.sessionChildren, sessionId),
    subscribe: (sessionId, token) => ipcRenderer.invoke(IPC.transcriptSubscribe, sessionId, token),
    unsubscribe: (token) => ipcRenderer.invoke(IPC.transcriptUnsubscribe, token),
    cancelRequest: (requestId) => ipcRenderer.invoke(IPC.transcriptCancel, requestId),
    latestAnswer: (sessionId, generation, requestId) => ipcRenderer.invoke(IPC.transcriptLatest, sessionId, generation, requestId),
    performanceFrame: (delayMs) => ipcRenderer.invoke(IPC.performanceFrame, delayMs),
    model: (sessionId) => ipcRenderer.invoke(IPC.sessionModel, sessionId),
    setModel: (sessionId, model) => ipcRenderer.invoke(IPC.sessionSetModel, sessionId, model),
    agent: (sessionId) => ipcRenderer.invoke(IPC.sessionAgent, sessionId),
    setAgent: (sessionId, agentID) => ipcRenderer.invoke(IPC.sessionSetAgent, sessionId, agentID),
    copyId: (sessionId) => ipcRenderer.invoke(IPC.sessionCopyId, sessionId),
    contextUsage: (sessionId) => ipcRenderer.invoke(IPC.sessionContextUsage, sessionId),
    active: () => ipcRenderer.invoke(IPC.sessionActive),
    agentActivity: () => ipcRenderer.invoke(IPC.sessionAgentActivity),
    queue: (sessionId) => ipcRenderer.invoke(IPC.sessionQueue, sessionId),
    cancelQueued: (sessionId, inboxId) => ipcRenderer.invoke(IPC.sessionQueueCancel, sessionId, inboxId),
    promoteQueued: (sessionId, inboxId) => ipcRenderer.invoke(IPC.sessionQueuePromote, sessionId, inboxId),
    openCodeUi: (sessionId) => ipcRenderer.invoke(IPC.sessionOpenCodeUi, sessionId)
  },
  worktrees: {
    list: (input) => ipcRenderer.invoke(IPC.worktreeList, input),
    branches: (input) => ipcRenderer.invoke(IPC.worktreeBranches, input),
    preflight: (input) => ipcRenderer.invoke(IPC.worktreePreflight, input),
    remove: (input) => ipcRenderer.invoke(IPC.worktreeRemove, input),
    cleanupChat: () => ipcRenderer.invoke(IPC.worktreeCleanupChat)
  },
  jira: {
    status: () => ipcRenderer.invoke(IPC.jiraStatus),
    connect: () => ipcRenderer.invoke(IPC.jiraConnect),
    reconnect: () => ipcRenderer.invoke(IPC.jiraReconnect),
    disconnect: () => ipcRenderer.invoke(IPC.jiraDisconnect),
    board: () => ipcRenderer.invoke(IPC.boardFetch),
    detail: (key) => ipcRenderer.invoke(IPC.jiraDetail, key),
    tickets: (keys) => ipcRenderer.invoke(IPC.jiraTicketBriefs, keys),
    readyToTest: (key, confirmed) => ipcRenderer.invoke(IPC.jiraReadyToTest, key, confirmed)
  },
  work: {
    start: (input) => ipcRenderer.invoke(IPC.workStart, input),
    list: () => ipcRenderer.invoke(IPC.workList),
    conversationContext: (sessionId, directory) => ipcRenderer.invoke(IPC.conversationContext, sessionId, directory),
    setCheckout: (sessionId, input) => ipcRenderer.invoke(IPC.workSetCheckout, sessionId, input),
    abandonPreflight: (id) => ipcRenderer.invoke(IPC.workAbandonPreflight, id),
    abandon: (input) => ipcRenderer.invoke(IPC.workAbandon, input),
    messages: (sessionId, since, requestId) => ipcRenderer.invoke(IPC.workMessages, sessionId, since, requestId),
    prompt: (sessionId, text, images, queued, refs, sentAt) => ipcRenderer.invoke(IPC.workPrompt, sessionId, text, images, queued, refs, sentAt),
    promptNow: (sessionId, text, images, refs) => ipcRenderer.invoke(IPC.workPromptNow, sessionId, text, images, refs),
    queue: (workId) => ipcRenderer.invoke(IPC.workQueue, workId),
    editQueued: (workId, id, text, refs) => ipcRenderer.invoke(IPC.workQueueEdit, workId, id, text, refs),
    cancelQueued: (workId, id) => ipcRenderer.invoke(IPC.workQueueCancel, workId, id),
    sendQueuedNow: (workId, id) => ipcRenderer.invoke(IPC.workQueueSend, workId, id),
    interrupt: (sessionId) => ipcRenderer.invoke(IPC.workInterrupt, sessionId),
    reviews: (workId) => ipcRenderer.invoke(IPC.workReviews, workId),
    reviewStart: (workId) => ipcRenderer.invoke(IPC.workReviewStart, workId),
  chatReview: (input) => ipcRenderer.invoke(IPC.workChatReview, input),
    reviewRetry: (workId, reviewId, modelOverride) => ipcRenderer.invoke(IPC.workReviewRetry, workId, reviewId, modelOverride),
    reviewFinishEarly: (workId, reviewId) => ipcRenderer.invoke(IPC.workReviewFinishEarly, workId, reviewId),
    reviewStop: (workId) => ipcRenderer.invoke(IPC.workReviewStop, workId),
    shipCheck: (workId) => ipcRenderer.invoke(IPC.workShipCheck, workId),
    ship: (workId) => ipcRenderer.invoke(IPC.workShip, workId)
  },
  roleConfig: {
    list: () => ipcRenderer.invoke(IPC.roleConfigList),
    save: (cfg) => ipcRenderer.invoke(IPC.roleConfigSave, cfg)
  },
  comments: {
    pending: () => ipcRenderer.invoke(IPC.commentsPending),
    tackle: (workId) => ipcRenderer.invoke(IPC.commentsTackle, workId),
    dismiss: (workId) => ipcRenderer.invoke(IPC.commentsDismiss, workId),
    reply: (workId, body) => ipcRenderer.invoke(IPC.commentsReply, workId, body)
  },
  github: {
    list: (scope, force) => ipcRenderer.invoke(IPC.githubList, scope, force),
    review: (prUrl, sel) => ipcRenderer.invoke(IPC.githubReview, prUrl, sel),
    reviewSetup: (sessionId) => ipcRenderer.invoke(IPC.githubReviewSetup, sessionId),
    chat: (prUrl) => ipcRenderer.invoke(IPC.githubChat, prUrl),
    solveConflicts: (prUrl, sel) => ipcRenderer.invoke(IPC.githubSolveConflicts, prUrl, sel),
    solveComments: (prUrl, sel) => ipcRenderer.invoke(IPC.githubSolveComments, prUrl, sel),
    markSeen: (prUrl) => ipcRenderer.invoke(IPC.githubSeen, prUrl),
    alerts: () => ipcRenderer.invoke(IPC.githubAlerts),
    markAlertsSeen: (urls) => ipcRenderer.invoke(IPC.githubAlertsSeen, urls),
    merge: (prUrl, method) => ipcRenderer.invoke(IPC.githubMerge, prUrl, method),
    rebase: (prUrl) => ipcRenderer.invoke(IPC.githubRebase, prUrl),
    detail: (prUrl) => ipcRenderer.invoke(IPC.githubPrDetail, prUrl),
    push: (prUrl, directory) => ipcRenderer.invoke(IPC.githubPush, prUrl, directory),
    stack: (prUrl, directory) => ipcRenderer.invoke(IPC.githubStack, prUrl, directory),
    stackRebase: (prUrl, directory) => ipcRenderer.invoke(IPC.githubStackRebase, prUrl, directory),
    describe: (prUrl, instructions) => ipcRenderer.invoke(IPC.githubDescribe, prUrl, instructions),
    describeSave: (prUrl, original, head, body) => ipcRenderer.invoke(IPC.githubDescribeSave, prUrl, original, head, body)
  },
  task: {
    ticketSession: (input) => ipcRenderer.invoke(IPC.taskTicketSession, input)
  },
  models: {
    favorites: () => ipcRenderer.invoke(IPC.modelsFavorites),
    toggleFavorite: (key) => ipcRenderer.invoke(IPC.modelsFavoriteToggle, key)
  },
  file: {
    find: (sessionId, query) => ipcRenderer.invoke(IPC.fileFind, sessionId, query)
  },
  inbox: {
    list: () => ipcRenderer.invoke(IPC.inboxList),
    replyForm: (sessionId, formId, answer) => ipcRenderer.invoke(IPC.inboxReplyForm, sessionId, formId, answer),
    replyPermission: (sessionId, requestId, decision) => ipcRenderer.invoke(IPC.inboxReplyPermission, sessionId, requestId, decision)
  },
  triage: {
    list: () => ipcRenderer.invoke(IPC.triageList),
    markRead: (source, id) => ipcRenderer.invoke(IPC.triageMarkRead, source, id)
  },
  scripts: {
    list: () => ipcRenderer.invoke(IPC.scriptList),
    save: (input) => ipcRenderer.invoke(IPC.scriptSave, input),
    remove: (id) => ipcRenderer.invoke(IPC.scriptRemove, id),
    run: (id) => ipcRenderer.invoke(IPC.scriptRun, id),
    kill: (id) => ipcRenderer.invoke(IPC.scriptKill, id),
    status: () => ipcRenderer.invoke(IPC.scriptStatus),
    history: (id) => ipcRenderer.invoke(IPC.scriptHistory, id),
    providerNeeds: () => ipcRenderer.invoke(IPC.scriptProviderNeeds)
  },
  events: {
    on(handler: (event: PushEvent) => void) {
      // Payloads are validated in main before sending; zod cannot run in the preload context.
      const listener = (_e: IpcRendererEvent, payload: PushEvent): void => handler(payload)
      ipcRenderer.on(IPC.eventPush, listener)
      return () => ipcRenderer.removeListener(IPC.eventPush, listener)
    }
  }
}

contextBridge.exposeInMainWorld('revva', api)
