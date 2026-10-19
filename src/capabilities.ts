/**
 * Capabilities Catalog and Permissions Gate
 * Modeled on chrome-agent-platform/extension/lib/capabilities.js
 */

export interface CapabilityGroup {
  id: 'browsing' | 'content' | 'system';
  label: string;
  hint: string;
}

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  { id: 'browsing', label: 'Browsing', hint: 'Tabs, tab groups, history, bookmarks, and navigation.' },
  { id: 'content', label: 'Content', hint: 'Page reading, DOM inspection, automation, and cookies.' },
  { id: 'system', label: 'System', hint: 'Notifications, idle detection, downloads, and system hardware status.' },
];

export interface Capability {
  id: string;
  group: 'browsing' | 'content' | 'system';
  permissions: string[];
  label: string;
  hint: string;
  gates: string;
}

export const CAPABILITIES: Capability[] = [
  // Browsing Group
  {
    id: 'tabs',
    group: 'browsing',
    permissions: ['tabs'],
    label: 'Tabs',
    hint: 'List, navigate, close, focus, and duplicate browser tabs.',
    gates: 'Gates: tab_list, tab_open, tab_close, tab_focus, tab_navigate, tab_duplicate, tab_move, tab_pin, action_toast.',
  },
  {
    id: 'tabGroups',
    group: 'browsing',
    permissions: ['tabGroups'],
    label: 'Tab Groups',
    hint: 'Create, query, update, collapse, and ungroup browser tab groups.',
    gates: 'Gates: tab_group, tab_group_list, tab_ungroup.',
  },
  {
    id: 'bookmarks',
    group: 'browsing',
    permissions: ['bookmarks'],
    label: 'Bookmarks',
    hint: 'Read, search, create, and organize browser bookmarks.',
    gates: 'Gates: bookmark_search, bookmark_add, bookmark_list, bookmark_remove.',
  },
  {
    id: 'history',
    group: 'browsing',
    permissions: ['history'],
    label: 'History',
    hint: 'Search browsing history and recently visited pages.',
    gates: 'Gates: history_search.',
  },
  {
    id: 'sessions',
    group: 'browsing',
    permissions: ['sessions'],
    label: 'Recently Closed Sessions',
    hint: 'List and restore recently closed tabs and browser windows.',
    gates: 'Gates: sessions_recent, sessions_restore.',
  },
  {
    id: 'topSites',
    group: 'browsing',
    permissions: ['topSites'],
    label: 'Top Sites',
    hint: 'Access user most frequently visited websites.',
    gates: 'Gates: top_sites.',
  },
  {
    id: 'readingList',
    group: 'browsing',
    permissions: ['readingList'],
    label: 'Reading List',
    hint: 'Read and manage entries in the Chrome reading list.',
    gates: 'Gates: reading_list_query, reading_list_add.',
  },
  {
    id: 'webNavigation',
    group: 'browsing',
    permissions: ['webNavigation'],
    label: 'Web Navigation',
    hint: 'Inspect frames and navigation state across tabs.',
    gates: 'Gates: web_navigation_frames.',
  },
  {
    id: 'contextMenus',
    group: 'browsing',
    permissions: ['contextMenus'],
    label: 'Context Menus',
    hint: 'Create right-click context menu options for quick agent actions.',
    gates: 'Gates: context_menu_create, context_menu_list, context_menu_remove.',
  },

  // Content Group
  {
    id: 'scripting',
    group: 'content',
    permissions: ['scripting'],
    label: 'Page Content & DOM Inspection',
    hint: 'Read page text, metadata, headings, convert to clean Markdown, find elements, click, and type.',
    gates: 'Gates: tab_read, read_page, capture_page, find_elements, click_element, type_text, select_option, scroll_page, wait_for, extract_tables.',
  },
  {
    id: 'cookies',
    group: 'content',
    permissions: ['cookies'],
    label: 'Cookies',
    hint: 'Inspect and manage cookies for authorized origins.',
    gates: 'Gates: cookies_get, cookies_set, cookies_remove.',
  },
  {
    id: 'browsingData',
    group: 'content',
    permissions: ['browsingData'],
    label: 'Browsing Data',
    hint: 'Clear cache, cookies, downloads, and history upon request.',
    gates: 'Gates: browsing_data_remove.',
  },
  {
    id: 'pageCapture',
    group: 'content',
    permissions: ['pageCapture'],
    label: 'Page Capture (MHTML)',
    hint: 'Save complete web pages as offline MHTML archives.',
    gates: 'Gates: page_capture_mhtml.',
  },
  {
    id: 'search',
    group: 'content',
    permissions: ['search'],
    label: 'Browser Search',
    hint: 'Execute queries using the default browser search provider.',
    gates: 'Gates: browser_search.',
  },

  // System Group
  {
    id: 'idle',
    group: 'system',
    permissions: ['idle'],
    label: 'Idle Detection',
    hint: 'Detect when the user is away or browser is idle to run background tasks safely.',
    gates: 'Gates: idle_query, idle.onStateChanged auto-wake.',
  },
  {
    id: 'notifications',
    group: 'system',
    permissions: ['notifications'],
    label: 'Notifications',
    hint: 'Display desktop system notifications to the user.',
    gates: 'Gates: notification_show, notify.',
  },
  {
    id: 'alarms',
    group: 'system',
    permissions: ['alarms'],
    label: 'Alarms & Scheduling',
    hint: 'Schedule periodic or one-off timers and recurring wake-ups.',
    gates: 'Gates: alarm_set, alarm_list, alarm_clear.',
  },
  {
    id: 'downloads',
    group: 'system',
    permissions: ['downloads'],
    label: 'Downloads',
    hint: 'List and initiate file downloads.',
    gates: 'Gates: download_list, download_file.',
  },
  {
    id: 'tts',
    group: 'system',
    permissions: ['tts'],
    label: 'Text to Speech',
    hint: 'Synthesize speech aloud through the Chrome TTS engine.',
    gates: 'Gates: tts_speak, tts_stop.',
  },
  {
    id: 'power',
    group: 'system',
    permissions: ['power'],
    label: 'Power Management',
    hint: 'Request display or system remain awake during critical tasks.',
    gates: 'Gates: power_keep_awake.',
  },
  {
    id: 'management',
    group: 'system',
    permissions: ['management'],
    label: 'Extension Management',
    hint: 'List installed extensions and apps.',
    gates: 'Gates: extensions_list.',
  },
  {
    id: 'system.cpu',
    group: 'system',
    permissions: ['system.cpu'],
    label: 'System CPU Info',
    hint: 'Inspect CPU processor model and core utilization.',
    gates: 'Gates: system_cpu_info.',
  },
  {
    id: 'system.memory',
    group: 'system',
    permissions: ['system.memory'],
    label: 'System Memory Info',
    hint: 'Inspect available physical RAM capacity.',
    gates: 'Gates: system_memory_info.',
  },
  {
    id: 'system.storage',
    group: 'system',
    permissions: ['system.storage'],
    label: 'Storage Devices',
    hint: 'Inspect mounted storage devices and disk capacity.',
    gates: 'Gates: system_storage_info.',
  },
  {
    id: 'system.display',
    group: 'system',
    permissions: ['system.display'],
    label: 'Display Monitors',
    hint: 'Inspect connected monitors, primary display, and resolution.',
    gates: 'Gates: system_display_info.',
  },
  {
    id: 'clipboardWrite',
    group: 'system',
    permissions: ['clipboardWrite'],
    label: 'Clipboard Write',
    hint: 'Copy text to the system clipboard upon agent command.',
    gates: 'Gates: clipboard_write.',
  },
];

/** Check if a capability is required (in manifest permissions) vs optional. */
export function isRequiredCapability(id: string): boolean {
  try {
    const manifest = chrome.runtime.getManifest();
    const reqPerms = manifest.permissions || [];
    const cap = CAPABILITIES.find((c) => c.id === id);
    if (!cap) return reqPerms.includes(id);
    return cap.permissions.every((p) => reqPerms.includes(p));
  } catch {
    return false;
  }
}

/** Check if a capability is currently granted. */
export async function checkCapability(id: string): Promise<boolean> {
  const cap = CAPABILITIES.find((c) => c.id === id);
  const perms = (cap ? cap.permissions : [id]) as chrome.runtime.ManifestPermission[];
  return new Promise((resolve) => {
    chrome.permissions.contains({ permissions: perms }, (granted) => {
      void chrome.runtime.lastError;
      resolve(Boolean(granted));
    });
  });
}

/** Request capability permissions via user gesture. */
export async function requestCapability(id: string): Promise<boolean> {
  const cap = CAPABILITIES.find((c) => c.id === id);
  const perms = (cap ? cap.permissions : [id]) as chrome.runtime.ManifestPermission[];
  return new Promise((resolve) => {
    chrome.permissions.request({ permissions: perms }, (granted) => {
      void chrome.runtime.lastError;
      resolve(Boolean(granted));
    });
  });
}

/** Remove capability permissions. */
export async function removeCapability(id: string): Promise<boolean> {
  const cap = CAPABILITIES.find((c) => c.id === id);
  const perms = (cap ? cap.permissions : [id]) as chrome.runtime.ManifestPermission[];
  return new Promise((resolve) => {
    chrome.permissions.remove({ permissions: perms }, (removed) => {
      void chrome.runtime.lastError;
      resolve(Boolean(removed));
    });
  });
}
