# Campus Office — Stage 4: Files room hub and Hand-to — Implementation Plan (as built)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Folders live on a wall in the Files room. Open one, tick up to five files, and hand them to any coworker. The camera flies to that person and the files wait in their message box, then go with the task as labelled file context.

**Spec:** [2026-09-23-campus-office-design.md](../specs/2026-09-23-campus-office-design.md) §4.8.

## Tasks (all done)
1. **Main-owned folder wall** (`src/main/folderWall.ts`): `remember`, `forget`, `isOnWall`, `loadWall`, `saveWall`, holding at most 12 folders in `office-folders.json` in the data directory. `projectChoose` remembers the folder the user picked. New IPC calls: `projectRecent`, `projectOpen(folder)` (**only folders already on the wall**, so a renderer can never open arbitrary paths) and `projectForget`. Deviation from spec §4.8: the wall is kept by the main process rather than in `Settings`, for that security reason.
2. **File context** (`activity/fileContext.ts`): `withFileContext(text, files)` appends `<file path="…">` blocks, capped at 30,000 characters per file and 100,000 in total, with a truncation note.
3. **Store:** `pendingFiles`, `handFiles` (dedupe by path, at most 5), `removeFile`, `clearFiles`, and `flyTo`/`flyToAgent`.
4. **Files panel** (`activity/FilesPanel.tsx`, replacing `OfficeFiles.tsx`): folder wall cabinets (open, remove), an "Open a folder" tile, a browser with checkboxes, and a **Hand to…** picker (search anyone, or pick from recent coworkers). An inline error offers "Remove from wall".
5. **Composer:** handed files show as removable chips and are sent with `withFileContext`, then cleared. Messages hide the appended blocks.
6. **3D:** an invisible hotspot over the Files room cabinets opens the wall (selects the Files Agent). The "Files room" label does the same. The Files Agent walks to the cabinets while the wall is open.
7. **Tests:** `tests/office-files.test.cjs` covers the wall and file context. The desktop check covers opening a folder, ticking a file, handing it to the Frontend Developer, the chip, the send, and the provider receiving the file contents.
