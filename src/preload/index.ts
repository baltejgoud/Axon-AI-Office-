import { contextBridge, ipcRenderer } from 'electron';
import type { PlatformAPI } from '../shared/platform';
import type { StreamEvent } from '../shared/types';
const invoke = <K extends keyof Omit<PlatformAPI, 'onStream'>>(method: K) =>
  (...args: Parameters<PlatformAPI[K]>) => ipcRenderer.invoke(`platform:${method}`, ...args) as ReturnType<PlatformAPI[K]>;
const api: PlatformAPI = {
  snapshot: invoke('snapshot'), providerSave: invoke('providerSave'), providerDelete: invoke('providerDelete'),
  workspaceSave: invoke('workspaceSave'), workspaceDelete: invoke('workspaceDelete'), agentSave: invoke('agentSave'),
  agentDelete: invoke('agentDelete'), agentExport: invoke('agentExport'), agentImport: invoke('agentImport'),
  settingsSave: invoke('settingsSave'), chatCreate: invoke('chatCreate'), chatRename: invoke('chatRename'),
  chatDelete: invoke('chatDelete'), chatSend: invoke('chatSend'), chatStop: invoke('chatStop'), attach: invoke('attach'),
  knowledgeImport: invoke('knowledgeImport'), knowledgeDelete: invoke('knowledgeDelete'), knowledgeSearch: invoke('knowledgeSearch'),
  projectChoose: invoke('projectChoose'), projectList: invoke('projectList'), projectRead: invoke('projectRead'),
  projectWrite: invoke('projectWrite'), projectSearch: invoke('projectSearch'),
  onStream(callback) {
    const listener = (_: Electron.IpcRendererEvent, event: StreamEvent) => callback(event);
    ipcRenderer.on('platform:stream', listener);
    return () => ipcRenderer.removeListener('platform:stream', listener);
  }
};
contextBridge.exposeInMainWorld('axon', api);
