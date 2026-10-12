; Uninstalling Axon also removes the task that opens it for recurring work (src/main/shell/lifecycle.ts, WAKE_TASK).
!macro customUnInstall
  nsExec::Exec 'schtasks.exe /Delete /TN "Axon recurring work" /F'
!macroend
