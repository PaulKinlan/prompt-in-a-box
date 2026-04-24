/**
 * Tool registry keyed by Chrome permission.
 *
 * Each permission the manifest declares (or the user grants optionally at
 * runtime) unlocks a set of tools. The agent loop is given only those the
 * manifest actually grants — a permission declaration is a capability
 * declaration, full stop. That's the contract the browser already enforces;
 * we just pass it through to the prompt.
 *
 * When a prompt asks for capability it doesn't have, the tool is simply
 * not in its ToolSet. The model can't see what it can't call.
 */

import type { ToolSet } from 'ai';
import { tabList } from './tab-list';
import { tabClose } from './tab-close';
import { tabOpen } from './tab-open';
import { tabFocus } from './tab-focus';
import { tabNavigate } from './tab-navigate';
import { tabDuplicate } from './tab-duplicate';
import { tabMove } from './tab-move';
import { tabMute } from './tab-mute';
import { tabPin } from './tab-pin';
import { tabGroup } from './tab-group';
import { tabRead } from './tab-read';
import { tabScreenshot } from './tab-screenshot';
import { notificationShow } from './notification-show';
import { bookmarkSearch } from './bookmark-search';
import { bookmarkAdd } from './bookmark-add';
import { bookmarkList } from './bookmark-list';
import { bookmarkRemove } from './bookmark-remove';
import { historySearch } from './history-search';
import { storageGet } from './storage-get';
import { storageSet } from './storage-set';
import { opfsRead } from './opfs-read';
import { opfsWrite } from './opfs-write';
import { opfsList } from './opfs-list';
import { alarmSet } from './alarm-set';
import { alarmList } from './alarm-list';
import { alarmClear } from './alarm-clear';
import { windowList } from './window-list';
import { windowCreate } from './window-create';
import { windowClose } from './window-close';
import { windowFocus } from './window-focus';
import { windowResize } from './window-resize';
import { downloadFile } from './download-file';
import { downloadList } from './download-list';
import { contextMenuCreate } from './context-menu-create';
import { contextMenuUpdate } from './context-menu-update';
import { contextMenuRemove } from './context-menu-remove';
import { contextMenuList } from './context-menu-list';
import { readingListAdd } from './reading-list-add';
import { readingListQuery } from './reading-list-query';
import { clipboardWrite } from './clipboard-write';
import { artifactCreate } from './artifact-create';

/**
 * Map Chrome permission → tools it unlocks.
 *
 * `__always__` is a meta-bucket for tools that work regardless of
 * Chrome permissions — notably OPFS, which is part of the Web Platform
 * (navigator.storage) rather than the chrome.* API set. Window tools
 * also live here because the `windows` namespace needs no permission.
 */
const TOOLS_BY_PERMISSION: Record<string, ToolSet> = {
  __always__: {
    storage_get: storageGet,
    storage_set: storageSet,
    opfs_read: opfsRead,
    opfs_write: opfsWrite,
    opfs_list: opfsList,
    artifact_create: artifactCreate,
    window_list: windowList,
    window_create: windowCreate,
    window_close: windowClose,
    window_focus: windowFocus,
    window_resize: windowResize,
  },
  tabs: {
    tab_list: tabList,
    tab_close: tabClose,
    tab_open: tabOpen,
    tab_focus: tabFocus,
    tab_navigate: tabNavigate,
    tab_duplicate: tabDuplicate,
    tab_move: tabMove,
    tab_mute: tabMute,
    tab_pin: tabPin,
    tab_group: tabGroup,
  },
  scripting: {
    tab_read: tabRead,
    tab_screenshot: tabScreenshot,
  },
  notifications: {
    notification_show: notificationShow,
  },
  bookmarks: {
    bookmark_search: bookmarkSearch,
    bookmark_add: bookmarkAdd,
    bookmark_list: bookmarkList,
    bookmark_remove: bookmarkRemove,
  },
  history: {
    history_search: historySearch,
  },
  alarms: {
    alarm_set: alarmSet,
    alarm_list: alarmList,
    alarm_clear: alarmClear,
  },
  downloads: {
    download_file: downloadFile,
    download_list: downloadList,
  },
  contextMenus: {
    context_menu_create: contextMenuCreate,
    context_menu_update: contextMenuUpdate,
    context_menu_remove: contextMenuRemove,
    context_menu_list: contextMenuList,
  },
  readingList: {
    reading_list_add: readingListAdd,
    reading_list_query: readingListQuery,
  },
  clipboardWrite: {
    clipboard_write: clipboardWrite,
  },
};

export async function buildToolSet(): Promise<ToolSet> {
  const granted = await listGrantedPermissions();
  const tools: ToolSet = { ...TOOLS_BY_PERMISSION.__always__ };
  for (const perm of granted) {
    const bucket = TOOLS_BY_PERMISSION[perm];
    if (bucket) Object.assign(tools, bucket);
  }
  return tools;
}

async function listGrantedPermissions(): Promise<string[]> {
  return await new Promise((resolve) => {
    chrome.permissions.getAll((p) => resolve(p.permissions ?? []));
  });
}
