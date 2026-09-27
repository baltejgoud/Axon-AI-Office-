import { contextBridge, ipcRenderer } from 'electron';
import type { PlatformAPI } from '../shared/platform';
import type { StreamEvent } from '../shared/types';
const invoke = <K extends keyof Omit<PlatformAPI, 'onStream'>>(method: K) =>
  (...args: Parameters<PlatformAPI[K]>) => ipcRenderer.invoke(`platform:${method}`, ...args) as ReturnType<PlatformAPI[K]>;
const api: PlatformAPI = {
  snapshot: invoke('snapshot'), providerSave: invoke('providerSave'), providerTest: invoke('providerTest'), providerModels: invoke('providerModels'), providerConnect: invoke('providerConnect'), providerDelete: invoke('providerDelete'),
  workspaceSave: invoke('workspaceSave'), workspaceDelete: invoke('workspaceDelete'), agentSave: invoke('agentSave'),
  agentDelete: invoke('agentDelete'), agentExport: invoke('agentExport'), agentImport: invoke('agentImport'),
  settingsSave: invoke('settingsSave'), mcpServerSave: invoke('mcpServerSave'), mcpServerDelete: invoke('mcpServerDelete'),
  connectorAdd: invoke('connectorAdd'), connectorReconnect: invoke('connectorReconnect'), connectorSignInCancel: invoke('connectorSignInCancel'),
  connectorSignOut: invoke('connectorSignOut'), connectorAppSave: invoke('connectorAppSave'), chatCreate: invoke('chatCreate'), chatRename: invoke('chatRename'),
  chatSelectionSet: invoke('chatSelectionSet'),
  chatDelete: invoke('chatDelete'), chatSend: invoke('chatSend'), chatStop: invoke('chatStop'), toolApprove: invoke('toolApprove'), attach: invoke('attach'),
  getContextUsage: invoke('getContextUsage'), usageReport: invoke('usageReport'), listBackups: invoke('listBackups'), restoreBackup: invoke('restoreBackup'),
  auditList: invoke('auditList'), auditExport: invoke('auditExport'),
  knowledgeImport: invoke('knowledgeImport'), knowledgeDelete: invoke('knowledgeDelete'), knowledgeSearch: invoke('knowledgeSearch'),
  projectChoose: invoke('projectChoose'), projectRecent: invoke('projectRecent'), projectOpen: invoke('projectOpen'), projectForget: invoke('projectForget'), projectList: invoke('projectList'), projectRead: invoke('projectRead'),
  projectWrite: invoke('projectWrite'), projectSearch: invoke('projectSearch'),
  taskAdd: invoke('taskAdd'), taskUpdate: invoke('taskUpdate'), taskDelete: invoke('taskDelete'), officeStart: invoke('officeStart'),
  accountsGet: invoke('accountsGet'), githubSignInStart: invoke('githubSignInStart'), githubSignInFinish: invoke('githubSignInFinish'),
  githubSignInCancel: invoke('githubSignInCancel'), githubSignOut: invoke('githubSignOut'), googleSignIn: invoke('googleSignIn'), accountAppSave: invoke('accountAppSave'),
  googleSignInCancel: invoke('googleSignInCancel'), googleSignOut: invoke('googleSignOut'), githubRepos: invoke('githubRepos'), gitCheck: invoke('gitCheck'),
  scmStatus: invoke('scmStatus'), scmDiff: invoke('scmDiff'), scmStage: invoke('scmStage'), scmUnstage: invoke('scmUnstage'), scmCommit: invoke('scmCommit'),
  scmSync: invoke('scmSync'), scmBranches: invoke('scmBranches'), scmCheckout: invoke('scmCheckout'), scmCreateBranch: invoke('scmCreateBranch'),
  scmClone: invoke('scmClone'), scmPublish: invoke('scmPublish'), openLink: invoke('openLink'),
  processStop: invoke('processStop'), processOpen: invoke('processOpen'),
  onStream(callback) {
    const listener = (_: Electron.IpcRendererEvent, event: StreamEvent) => callback(event);
    ipcRenderer.on('platform:stream', listener);
    return () => ipcRenderer.removeListener('platform:stream', listener);
  }
};
contextBridge.exposeInMainWorld('axon', api);
