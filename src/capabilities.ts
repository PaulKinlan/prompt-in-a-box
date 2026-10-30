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

// ─── Permission Inference from prompt.md & config.json ─────────────────────

export interface PermissionInferenceResult {
  permissions: string[];
  hostPermissions: string[];
  reasons: Record<string, string[]>;
  missingPermissions: string[];
  missingHostPermissions: string[];
}

export interface InferPermissionsOptions {
  prompt: string;
  description?: string;
  agentSettings?: Array<{ id: string; label?: string; hint?: string }>;
  currentPermissions?: string[];
  currentHostPermissions?: string[];
}

/**
 * Deterministically analyzes prompt.md text, extension description, and agentSettings
 * to infer required Chrome permissions and host_permissions, returning detailed
 * rationale for why each permission is required and which ones are currently missing.
 */
export function inferPermissionsFromPrompt(options: InferPermissionsOptions): PermissionInferenceResult {
  const {
    prompt = '',
    description = '',
    agentSettings = [],
    currentPermissions = [],
    currentHostPermissions = [],
  } = options;

  const combinedText = `${prompt}\n${description}`;
  const reasons: Record<string, string[]> = {};

  function addReason(perm: string, reason: string) {
    if (!reasons[perm]) {
      reasons[perm] = [];
    }
    if (!reasons[perm].includes(reason)) {
      reasons[perm].push(reason);
    }
  }

  // 1. Tool name detection mapped to capabilities
  // Extract all tools from CAPABILITIES gates string
  const toolToCapMap: Record<string, string> = {
    // Tabs & Windows
    tab_list: 'tabs',
    tab_open: 'tabs',
    tab_close: 'tabs',
    tab_focus: 'tabs',
    tab_navigate: 'tabs',
    tab_duplicate: 'tabs',
    tab_move: 'tabs',
    tab_pin: 'tabs',
    tab_reload: 'tabs',
    tab_discard: 'tabs',
    tab_mute: 'tabs',
    window_list: 'tabs',
    window_create: 'tabs',
    window_update: 'tabs',
    window_close: 'tabs',
    action_toast: 'tabs',

    // Tab Groups
    tab_group: 'tabGroups',
    tab_group_list: 'tabGroups',
    tab_group_update: 'tabGroups',
    tab_ungroup: 'tabGroups',

    // Bookmarks
    bookmark_search: 'bookmarks',
    bookmark_add: 'bookmarks',
    bookmark_list: 'bookmarks',
    bookmark_remove: 'bookmarks',
    bookmark_tree: 'bookmarks',
    bookmark_recent: 'bookmarks',
    bookmark_children: 'bookmarks',
    bookmark_move: 'bookmarks',
    bookmark_update: 'bookmarks',

    // History
    history_search: 'history',
    history_visits: 'history',
    history_add: 'history',
    history_delete_url: 'history',
    history_delete_range: 'history',

    // Sessions
    sessions_recent: 'sessions',
    sessions_restore: 'sessions',

    // Reading list
    reading_list_query: 'readingList',
    reading_list_add: 'readingList',
    reading_list_update: 'readingList',
    reading_list_remove: 'readingList',

    // Context menus
    context_menu_create: 'contextMenus',
    context_menu_list: 'contextMenus',
    context_menu_update: 'contextMenus',
    context_menu_remove: 'contextMenus',
    context_menu_clear: 'contextMenus',

    // Page Content & Scripting
    tab_read: 'scripting',
    read_page: 'scripting',
    capture_page: 'scripting',
    find_elements: 'scripting',
    click_element: 'scripting',
    type_text: 'scripting',
    select_option: 'scripting',
    scroll_page: 'scripting',
    wait_for: 'scripting',
    wait_for_selector: 'scripting',
    extract_tables: 'scripting',
    evaluate_script: 'scripting',
    press_key: 'scripting',
    fill_form: 'scripting',
    hover_element: 'scripting',

    // Cookies
    cookies_get: 'cookies',
    cookies_get_all: 'cookies',
    cookies_set: 'cookies',
    cookies_remove: 'cookies',

    // Browsing data
    browsing_data_remove: 'browsingData',

    // Page capture
    page_capture_mhtml: 'pageCapture',

    // Search
    browser_search: 'search',

    // System & hardware
    idle_query: 'idle',
    notification_show: 'notifications',
    notify: 'notifications',
    alarm_set: 'alarms',
    alarm_list: 'alarms',
    alarm_clear: 'alarms',
    download_list: 'downloads',
    download_file: 'downloads',
    download_cancel: 'downloads',
    download_open: 'downloads',
    download_erase: 'downloads',
    download_show: 'downloads',
    tts_speak: 'tts',
    tts_stop: 'tts',
    power_keep_awake: 'power',
    power_release: 'power',
    extensions_list: 'management',
    extension_get: 'management',
    system_cpu_info: 'system.cpu',
    system_memory_info: 'system.memory',
    system_storage_info: 'system.storage',
    system_display_info: 'system.display',
    clipboard_write: 'clipboardWrite',
    top_sites: 'topSites',
  };

  for (const [tool, capId] of Object.entries(toolToCapMap)) {
    const regex = new RegExp(`\\b${tool}\\b`, 'i');
    if (regex.test(combinedText)) {
      addReason(capId, `Uses tool \`${tool}\``);
    }
  }

  // 2. Chrome Event triggers detection in prompt
  const eventTriggers: Array<{ pattern: RegExp; capId: string; name: string }> = [
    { pattern: /tabs\.(onCreated|onUpdated|onRemoved|onActivated|onMoved|onHighlighted)/i, capId: 'tabs', name: 'tabs events' },
    { pattern: /tabGroups\.(onCreated|onUpdated|onRemoved|onMoved)/i, capId: 'tabGroups', name: 'tabGroups events' },
    { pattern: /bookmarks\.(onCreated|onRemoved|onChanged|onMoved)/i, capId: 'bookmarks', name: 'bookmarks events' },
    { pattern: /history\.(onVisited|onVisitRemoved)/i, capId: 'history', name: 'history events' },
    { pattern: /downloads\.(onCreated|onChanged|onErased)/i, capId: 'downloads', name: 'downloads events' },
    { pattern: /contextMenus\.(onClicked)/i, capId: 'contextMenus', name: 'contextMenus events' },
    { pattern: /idle\.(onStateChanged)/i, capId: 'idle', name: 'idle events' },
    { pattern: /cookies\.(onChanged)/i, capId: 'cookies', name: 'cookies events' },
    { pattern: /management\.(onInstalled|onUninstalled|onEnabled|onDisabled)/i, capId: 'management', name: 'management events' },
    { pattern: /alarms\.(onAlarm)/i, capId: 'alarms', name: 'alarms events' },
  ];

  for (const ev of eventTriggers) {
    if (ev.pattern.test(combinedText)) {
      addReason(ev.capId, `Listens to Chrome ${ev.name}`);
      if (ev.capId === 'tabGroups') {
        addReason('tabs', 'Tab group workflows require tab access');
      }
    }
  }

  // 3. Natural language semantic heuristics
  const heuristics: Array<{ pattern: RegExp; capId: string; reason: string }> = [
    { pattern: /\b(tab group|tab groups|tab_group|grouping tabs|organize tabs into groups|collapse groups?|ungroup tabs?)\b/i, capId: 'tabGroups', reason: 'Mentions tab groups / grouping tabs' },
    { pattern: /\b(open tab|close tab|active tab|pinned tab|tab strip|all tabs|list tabs|switch tab|duplicate tab|tabs in window)\b/i, capId: 'tabs', reason: 'Mentions tab operations / tab management' },
    { pattern: /\b(read page|page content|DOM inspection|page body|extract text from page|click button on page|scrape page|summarize page content|webpage text)\b/i, capId: 'scripting', reason: 'Mentions reading or inspecting page DOM / content' },
    { pattern: /\b(bookmark|bookmarks|favorite folders?|reading list bookmarks?)\b/i, capId: 'bookmarks', reason: 'Mentions bookmarks / bookmark management' },
    { pattern: /\b(browsing history|visited pages?|recent visits|history search|visit history)\b/i, capId: 'history', reason: 'Mentions browsing history' },
    { pattern: /\b(recently closed|restore closed tab|restore session)\b/i, capId: 'sessions', reason: 'Mentions recently closed tabs / sessions' },
    { pattern: /\b(reading list|chrome reading list|articles to read later)\b/i, capId: 'readingList', reason: 'Mentions Chrome Reading List' },
    { pattern: /\b(context menu|right-click menu|context-menu)\b/i, capId: 'contextMenus', reason: 'Mentions right-click context menus' },
    { pattern: /\b(cookies?|session cookies?|auth cookies?)\b/i, capId: 'cookies', reason: 'Mentions cookies inspection / management' },
    { pattern: /\b(clear cache|clear browsing data|wipe history and cookies)\b/i, capId: 'browsingData', reason: 'Mentions clearing browsing data' },
    { pattern: /\b(mhtml|page capture|save page offline|offline archive)\b/i, capId: 'pageCapture', reason: 'Mentions saving page as MHTML archive' },
    { pattern: /\b(idle detection|user is away|wait for idle|idle state|when idle)\b/i, capId: 'idle', reason: 'Mentions idle detection' },
    { pattern: /\b(desktop notification|notification_show|push notification|alert the user with a notification)\b/i, capId: 'notifications', reason: 'Mentions desktop notifications' },
    { pattern: /\b(download files?|download list|save downloaded file)\b/i, capId: 'downloads', reason: 'Mentions file downloads' },
    { pattern: /\b(text to speech|speak aloud|tts_speak|read aloud)\b/i, capId: 'tts', reason: 'Mentions text-to-speech (TTS)' },
    { pattern: /\b(keep awake|prevent sleep|power_keep_awake)\b/i, capId: 'power', reason: 'Mentions power keep-awake' },
    { pattern: /\b(installed extensions|list extensions|manage extensions)\b/i, capId: 'management', reason: 'Mentions extension management' },
    { pattern: /\b(clipboard|copy to clipboard|clipboard_write)\b/i, capId: 'clipboardWrite', reason: 'Mentions copying to clipboard' },
    { pattern: /\b(top sites|frequently visited sites)\b/i, capId: 'topSites', reason: 'Mentions top visited sites' },
  ];

  for (const h of heuristics) {
    if (h.pattern.test(combinedText)) {
      addReason(h.capId, h.reason);
    }
  }

  // 4. Check agentSettings fields for preferences implying permissions
  for (const setting of agentSettings) {
    const sId = (setting.id || '').toLowerCase();
    const sLabel = (setting.label || '').toLowerCase();
    const sHint = (setting.hint || '').toLowerCase();
    const settingCombined = `${sId} ${sLabel} ${sHint}`;

    if (settingCombined.includes('idle') || sId.includes('waitforidle')) {
      addReason('idle', `Setting "${setting.label || setting.id}" references idle detection`);
    }
    if (settingCombined.includes('group') || settingCombined.includes('preferexistinggroups')) {
      addReason('tabGroups', `Setting "${setting.label || setting.id}" configures tab groups`);
      addReason('tabs', `Setting "${setting.label || setting.id}" configures tab grouping`);
    }
    if (settingCombined.includes('content') || settingCombined.includes('usepagecontent') || settingCombined.includes('dom')) {
      addReason('scripting', `Setting "${setting.label || setting.id}" enables page content inspection`);
    }
    if (settingCombined.includes('notification')) {
      addReason('notifications', `Setting "${setting.label || setting.id}" configures notifications`);
    }
  }

  // If tabGroups is inferred, tabs is always required as well
  if (reasons['tabGroups']) {
    addReason('tabs', 'Tab grouping operations require the `tabs` permission');
  }

  // Compile final permissions list (always including standard storage and alarms if referenced)
  const inferredPerms = new Set<string>();
  for (const perm of Object.keys(reasons)) {
    inferredPerms.add(perm);
  }

  // 5. Host permissions inference (URL access)
  const inferredHostPerms = new Set<string>();
  const hostReasons: Record<string, string[]> = {};

  function addHostReason(pattern: string, reason: string) {
    inferredHostPerms.add(pattern);
    if (!hostReasons[pattern]) {
      hostReasons[pattern] = [];
    }
    if (!hostReasons[pattern].includes(reason)) {
      hostReasons[pattern].push(reason);
    }
  }

  // If scripting, cookies, or pageCapture is inferred, check domain targets
  const needsHostAccess =
    inferredPerms.has('scripting') ||
    inferredPerms.has('cookies') ||
    inferredPerms.has('pageCapture');

  if (needsHostAccess) {
    // Look for specific domain patterns in prompt text
    const explicitHostRegex = /(?:https?:\/\/|\*:\/\/)(?:[a-zA-Z0-9*_-]+\.)+[a-zA-Z0-9*_-]+(?:\/[^\s"'`<>]*)?/g;
    const matches = combinedText.match(explicitHostRegex) || [];
    const foundSpecific = new Set<string>();

    for (const match of matches) {
      if (match.includes('schema.org') || match.includes('w3.org') || match.includes('github.com/paulkinlan')) {
        continue;
      }
      try {
        const u = new URL(match.replace(/^\*:\/\//, 'https://'));
        const hostPattern = `*://*.${u.hostname.replace(/^www\./, '')}/*`;
        foundSpecific.add(hostPattern);
        addHostReason(hostPattern, `Prompt references domain ${u.hostname}`);
      } catch {
        // Not a standard URL
      }
    }

    // If specific domains weren't found, or prompt operates across general user tabs, infer <all_urls>
    const isGeneralBrowsing =
      foundSpecific.size === 0 ||
      /\b(all tabs|any tab|open tabs|current tab|active tab|any page|every tab|all pages|general browsing|web pages)\b/i.test(combinedText) ||
      inferredPerms.has('tabGroups') ||
      inferredPerms.has('tabs');

    if (isGeneralBrowsing) {
      addHostReason('<all_urls>', 'Required by page content & scripting tools to inspect and read tabs across origins');
    }
  }

  // Merge host reasons into reasons object for unified display
  for (const [hp, rList] of Object.entries(hostReasons)) {
    reasons[hp] = rList;
  }

  const permissionsList = Array.from(inferredPerms);
  const hostPermissionsList = Array.from(inferredHostPerms);

  // 6. Compute diffs vs currentPermissions and currentHostPermissions
  const currentPermsSet = new Set(currentPermissions);
  const missingPermissions = permissionsList.filter((p) => !currentPermsSet.has(p));

  const hasBroadHostAccess =
    currentHostPermissions.includes('<all_urls>') ||
    currentHostPermissions.includes('*://*/*');

  const missingHostPermissions = hasBroadHostAccess
    ? []
    : hostPermissionsList.filter((hp) => !currentHostPermissions.includes(hp));

  return {
    permissions: permissionsList,
    hostPermissions: hostPermissionsList,
    reasons,
    missingPermissions,
    missingHostPermissions,
  };
}
