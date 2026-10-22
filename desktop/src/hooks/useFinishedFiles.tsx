import { useCallback, useEffect, useRef, useState } from "react";
import type { useConfirm } from "../components/ConfirmDialog";
import type { Page } from "../components/Sidebar";
import { deleteFiles, errorText, setManagedFolders } from "../lib/api";
import type { HistoryItem, Settings } from "../lib/storage";
import { useAutoDelete } from "./useAutoDelete";
import { useAutoMove } from "./useAutoMove";
import { useDownloadedFiles } from "./useDownloadedFiles";
import { validateSiteRule } from "../lib/siteRules";

interface Args {
  settings: Settings;
  /** Where downloads are saved. */
  outDir: string;
  settingsLoaded: boolean;
  queueLoaded: boolean;
  relocationReady: boolean;
  onRelocated: (from: string, to: string) => void;
  prepareMove: (paths: string[]) => () => void;
  page: Page;
  history: HistoryItem[];
  historyRef: React.MutableRefObject<HistoryItem[]>;
  updateHistory: (next: HistoryItem[]) => void;
  confirm: ReturnType<typeof useConfirm>;
  showFlash: (text: string, error?: boolean) => void;
  announce: (note: { title: string; subtitle?: string }) => void;
}

/**
 * Everything about files that are already downloaded: which still exist, opening them, moving them to another drive,
 * cleaning up old ones and deleting one on request. Kaisu only moves and deletes inside the two folders it has been told
 * about, so they are registered first.
 */
export function useFinishedFiles({ settings, outDir, settingsLoaded, queueLoaded, relocationReady, onRelocated, prepareMove, page, history, historyRef, updateHistory, confirm, showFlash, announce }: Args) {
  const files = useDownloadedFiles(history, page, showFlash);
  const { existing, sizes, recheck } = files;

  const siteFoldersKey = JSON.stringify([...new Set(settings.siteRules.filter((rule) => validateSiteRule(rule) === null).map((rule) => rule.folder.trim()).filter(Boolean))].sort());
  const folderKey = JSON.stringify([outDir, settings.moveDir, siteFoldersKey]);
  const [registeredFolders, setRegisteredFolders] = useState("");
  const lastFolderProblem = useRef("");
  useEffect(() => {
    if (!settingsLoaded || outDir === "") return;
    let stale = false;
    setManagedFolders(outDir, settings.moveDir, JSON.parse(siteFoldersKey))
      .then(({ problem }) => {
        if (stale) return;
        if (problem && problem !== lastFolderProblem.current) showFlash(problem, true);
        lastFolderProblem.current = problem ?? "";
        setRegisteredFolders(folderKey);
      })
      .catch((e) => { if (!stale) showFlash(errorText(e), true); });
    return () => { stale = true; };
  }, [settingsLoaded, outDir, settings.moveDir, siteFoldersKey, folderKey, showFlash]);
  const ready = settingsLoaded && queueLoaded && registeredFolders === folderKey;

  const mover = useAutoMove({
    settings,
    outDir,
    getHistory: () => historyRef.current,
    history,
    existing,
    updateHistory,
    announce,
    showFlash,
    ready: ready && relocationReady,
    onRelocated,
    prepareMove,
  });
  const cleaner = useAutoDelete({ settings, outDir, history, existing, sizes, announce, showFlash, onDeleted: recheck, ready });

  /** Deletes a downloaded file from the computer (after asking), and forgets it in History. */
  const deleteDownloaded = useCallback(
    async (path: string) => {
      const title = historyRef.current.find((h) => h.path === path)?.title ?? path.split(/[\\/]/).pop() ?? "this file";
      const answer = await confirm.ask({
        title: "Delete this file?",
        body: (
          <p className="m-0">
            <b>{title}</b> can be moved to the Recycle Bin or Trash and restored there. Permanent deletion cannot be undone. Subtitle and lyrics files follow the same choice.
          </p>
        ),
        buttons: [
          { id: "cancel", label: "Cancel", primary: true },
          { id: "trash", label: "Move to Recycle Bin" },
          { id: "delete", label: "Delete file permanently" },
        ],
        cancelId: "cancel",
      });
      if (answer !== "delete" && answer !== "trash") return;
      try {
        const [result] = await deleteFiles([path], true, answer === "delete", true);
        if (!result?.ok) {
          showFlash(result?.error ?? "Couldn't delete the file.", true);
          return;
        }
        updateHistory(historyRef.current.filter((h) => h.path !== path));
        recheck();
        announce({ title: answer === "delete" ? "File deleted permanently" : "File moved to Recycle Bin or Trash", subtitle: title });
        if (result.warning) showFlash(result.warning, true);
      } catch (e) {
        showFlash(errorText(e), true);
      }
    },
    [confirm, historyRef, recheck, showFlash, updateHistory, announce],
  );

  return { ...files, ready, mover, cleaner, deleteDownloaded };
}
