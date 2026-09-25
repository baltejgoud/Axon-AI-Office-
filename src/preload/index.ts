import { contextBridge, ipcRenderer } from 'electron';
import type { PlatformAPI } from '../shared/platform';
import type { StreamEvent } from '../shared/types';
const invoke = <K extends keyof Omit<PlatformAPI, 'onStream'>>(method: K) =>
  (...args: Parameters<PlatformAPI[K]>) => ipcRenderer.invoke(`platform:${method}`, ...args) as ReturnType<PlatformAPI[K]>;
const api: PlatformAPI = {
  snapshot: invoke('snapshot'), providerSave: invoke('providerSave'), providerTest: invoke('providerTest'), providerDelete: invoke('providerDelete'),
  workspaceSave: invoke('workspaceSave'), workspaceDelete: invoke('workspaceDelete'), agentSave: invoke('agentSave'),
  agentDelete: invoke('agentDelete'), agentExport: invoke('agentExport'), agentImport: invoke('agentImport'),
  settingsSave: invoke('settingsSave'), mcpServerSave: invoke('mcpServerSave'), mcpServerDelete: invoke('mcpServerDelete'), chatCreate: invoke('chatCreate'), chatRename: invoke('chatRename'),
  chatSelectionSet: invoke('chatSelectionSet'),
  chatDelete: invoke('chatDelete'), chatSend: invoke('chatSend'), chatStop: invoke('chatStop'), toolApprove: invoke('toolApprove'), attach: invoke('attach'),
  knowledgeImport: invoke('knowledgeImport'), knowledgeDelete: invoke('knowledgeDelete'), knowledgeSearch: invoke('knowledgeSearch'),
  projectChoose: invoke('projectChoose'), projectRecent: invoke('projectRecent'), projectOpen: invoke('projectOpen'), projectForget: invoke('projectForget'), projectList: invoke('projectList'), projectRead: invoke('projectRead'),
  projectWrite: invoke('projectWrite'), projectSearch: invoke('projectSearch'),
  taskAdd: invoke('taskAdd'), taskUpdate: invoke('taskUpdate'), taskDelete: invoke('taskDelete'), officeStart: invoke('officeStart'),
  onStream(callback) {
    const listener = (_: Electron.IpcRendererEvent, event: StreamEvent) => callback(event);
    ipcRenderer.on('platform:stream', listener);
    return () => ipcRenderer.removeListener('platform:stream', listener);
  }
};
contextBridge.exposeInMainWorld('axon', api);
