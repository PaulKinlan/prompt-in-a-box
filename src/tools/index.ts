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
import { notificationShow } from './notification-show';
import { bookmarkSearch } from './bookmark-search';
import { historySearch } from './history-search';
import { storageGet } from './storage-get';
import { storageSet } from './storage-set';
import { opfsRead } from './opfs-read';
import { opfsWrite } from './opfs-write';
import { opfsList } from './opfs-list';
import { alarmSet } from './alarm-set';

/**
 * Map Chrome permission → tools it unlocks.
 *
 * `__always__` is a meta-bucket for tools that work regardless of
 * Chrome permissions — notably OPFS, which is part of the Web Platform
 * (navigator.storage) rather than the chrome.* API set.
 */
const TOOLS_BY_PERMISSION: Record<string, ToolSet> = {
  __always__: {
    storage_get: storageGet,
    storage_set: storageSet,
    opfs_read: opfsRead,
    opfs_write: opfsWrite,
    opfs_list: opfsList,
  },
  tabs: {
    tab_list: tabList,
    tab_close: tabClose,
    tab_open: tabOpen,
    tab_focus: tabFocus,
  },
  notifications: {
    notification_show: notificationShow,
  },
  bookmarks: {
    bookmark_search: bookmarkSearch,
  },
  history: {
    history_search: historySearch,
  },
  alarms: {
    alarm_set: alarmSet,
  },
  // `storage` permission is required for storage_get/set too, but storage is
  // listed in the always-on bucket because the extension couldn't function
  // at all without it, so we don't re-gate.
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
  // `getAll` returns both manifest-declared and runtime-granted permissions.
  return await new Promise((resolve) => {
    chrome.permissions.getAll((p) => resolve(p.permissions ?? []));
  });
}
