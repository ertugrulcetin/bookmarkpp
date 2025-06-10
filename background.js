/**
 * BookmarkPp Background Service Worker
 * Handles context menus, extension lifecycle, and communication with content scripts
 */

// Import storage utility
importScripts('storage.js');

// Context menu IDs
const CONTEXT_MENU_IDS = {
    ADD_NOTE: 'bookmarkpp-add-note',
    BOOKMARK_PAGE: 'bookmarkpp-bookmark-page',
    DASHBOARD: 'bookmarkpp-dashboard'
};

// GitHub sync functionality
let githubToken = null;
let gistId = null;

/**
 * Initialize extension on startup
 */
chrome.runtime.onStartup.addListener(() => {
    console.log('BookmarkPp extension started');
    setupContextMenus();
});

/**
 * Initialize extension on installation
 */
chrome.runtime.onInstalled.addListener(() => {
    console.log('BookmarkPp extension installed');
    setupContextMenus();
});

/**
 * Set up context menus
 */
function setupContextMenus() {
    // Remove existing menus first
    chrome.contextMenus.removeAll(() => {
        // Add note context menu (appears when text is selected)
        chrome.contextMenus.create({
            id: CONTEXT_MENU_IDS.ADD_NOTE,
            title: 'Add to Bookmark++',
            contexts: ['selection'],
            documentUrlPatterns: ['http://*/*', 'https://*/*']
        });

        // Bookmark page context menu (appears on page right-click)
        chrome.contextMenus.create({
            id: CONTEXT_MENU_IDS.BOOKMARK_PAGE,
            title: 'Bookmark this page',
            contexts: ['page'],
            documentUrlPatterns: ['http://*/*', 'https://*/*']
        });

        // Dashboard context menu (appears on extension icon right-click)
        chrome.contextMenus.create({
            id: CONTEXT_MENU_IDS.DASHBOARD,
            title: 'Open Dashboard',
            contexts: ['action']
        });
    });
}

/**
 * Handle context menu clicks
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    switch (info.menuItemId) {
        case CONTEXT_MENU_IDS.ADD_NOTE:
            await handleAddNote(info, tab);
            break;
        case CONTEXT_MENU_IDS.BOOKMARK_PAGE:
            await bookmarkCurrentPage(tab);
            break;
        case CONTEXT_MENU_IDS.DASHBOARD:
            await openDashboard();
            break;
    }
});

/**
 * Handle adding selected text as a note
 */
async function handleAddNote(info, tab) {
    try {
        const selectedText = info.selectionText;
        const url = tab.url;
        const title = tab.title;
        
        // Get page metadata first
        const pageData = await getPageMetadata(tab.id);
        
        // Check if bookmark already exists
        const domain = bookmarkStorage.extractDomain(url);
        const existingBookmarks = await bookmarkStorage.getBookmarksByDomain(domain);
        const existingBookmark = existingBookmarks.find(bookmark => bookmark.url === url);
        
        if (existingBookmark) {
            // Add note to existing bookmark
            const result = await bookmarkStorage.addNoteToBookmark(url, selectedText);
            if (result.success) {
                showNotification('Note added to existing bookmark!', 'success');
                // Show toast on the page with domain info
                chrome.tabs.sendMessage(tab.id, {
                    action: 'showNotification',
                    message: `Note added to bookmark for ${domain}`,
                    type: 'success'
                });
                
                // Trigger auto-sync
                triggerAutoSyncIfEnabled();
            } else {
                showNotification('Failed to add note: ' + result.error, 'error');
                chrome.tabs.sendMessage(tab.id, {
                    action: 'showNotification',
                    message: 'Failed to add note',
                    type: 'error'
                });
            }
        } else {
            // Create new bookmark with note
            const bookmarkData = {
                url,
                title: pageData.title || title,
                description: pageData.description || '',
                favicon: pageData.favicon || '',
                ogImage: pageData.ogImage || '',
                notes: [{
                    text: selectedText,
                    created_at: new Date().toISOString()
                }]
            };
            
            const result = await bookmarkStorage.saveBookmark(bookmarkData);
            if (result.success) {
                showNotification('Bookmark created with note!', 'success');
                // Show toast on the page with domain info
                chrome.tabs.sendMessage(tab.id, {
                    action: 'showNotification',
                    message: `Bookmark created with note for ${domain}`,
                    type: 'success'
                });
                
                // Trigger auto-sync
                triggerAutoSyncIfEnabled();
            } else {
                showNotification('Failed to create bookmark: ' + result.error, 'error');
                chrome.tabs.sendMessage(tab.id, {
                    action: 'showNotification',
                    message: 'Failed to create bookmark',
                    type: 'error'
                });
            }
        }
    } catch (error) {
        console.error('Error handling add note:', error);
        showNotification('Error adding note', 'error');
        // Show toast on the page
        chrome.tabs.sendMessage(tab.id, {
            action: 'showNotification',
            message: 'Error adding note',
            type: 'error'
        });
    }
}

/**
 * Bookmark the current page
 */
async function bookmarkCurrentPage(tab) {
    try {
        const pageData = await getPageMetadata(tab.id);
        
        const bookmarkData = {
            url: tab.url,
            title: pageData.title || tab.title,
            description: pageData.description || '',
            favicon: pageData.favicon || tab.favIconUrl || '',
            ogImage: pageData.ogImage || '',
            notes: []
        };
        
        const result = await bookmarkStorage.saveBookmark(bookmarkData);
        if (result.success) {
            showNotification('Page bookmarked!', 'success');
            // Show toast on the page with domain info
            chrome.tabs.sendMessage(tab.id, {
                action: 'showNotification',
                message: `Page bookmarked for ${bookmarkStorage.extractDomain(tab.url)}`,
                type: 'success'
            });
            
            // Trigger auto-sync
            triggerAutoSyncIfEnabled();
        } else {
            showNotification('Failed to bookmark page: ' + result.error, 'error');
            chrome.tabs.sendMessage(tab.id, {
                action: 'showNotification',
                message: 'Failed to bookmark page',
                type: 'error'
            });
        }
    } catch (error) {
        console.error('Error bookmarking page:', error);
        showNotification('Error bookmarking page', 'error');
    }
}

/**
 * Open the dashboard
 */
async function openDashboard() {
    try {
        const dashboardUrl = chrome.runtime.getURL('dashboard.html');
        await chrome.tabs.create({ url: dashboardUrl });
    } catch (error) {
        console.error('Error opening dashboard:', error);
        showNotification('Error opening dashboard', 'error');
    }
}

/**
 * Get page metadata from content script
 */
async function getPageMetadata(tabId) {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'getPageMetadata' });
        return response || {};
    } catch (error) {
        console.error('Error getting page metadata:', error);
        return {};
    }
}

/**
 * Save current page as bookmark (called from popup)
 */
async function saveCurrentPage(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId);
        const pageData = await getPageMetadata(tabId);
        
        const bookmarkData = {
            url: tab.url,
            title: pageData.title || tab.title,
            description: pageData.description || '',
            favicon: pageData.favicon || tab.favIconUrl || '',
            ogImage: pageData.ogImage || '',
            notes: []
        };
        
        const result = await bookmarkStorage.saveBookmark(bookmarkData);
        
        // Trigger auto-sync if bookmark was saved successfully
        if (result.success) {
            triggerAutoSyncIfEnabled();
        }
        
        return result;
    } catch (error) {
        console.error('Error saving current page:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Show notification to user
 */
function showNotification(message, type = 'info') {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'BookmarkPp',
        message: message
    });
}

/**
 * Trigger auto-sync if enabled and connected
 */
async function triggerAutoSyncIfEnabled() {
    try {
        // Check if auto-sync is enabled
        const result = await chrome.storage.local.get(['auto_sync_enabled']);
        const autoSyncEnabled = result.auto_sync_enabled !== false; // Default to true
        
        if (!autoSyncEnabled) return;
        
        // Initialize GitHub sync data
        await initGitHubSync();
        
        // Check if authenticated
        if (!isGitHubAuthenticated()) {
            console.log('Auto-sync skipped: Not authenticated with GitHub');
            return;
        }
        
        console.log('Auto-sync triggered by data change');
        
        // Get all bookmarks
        const allBookmarks = await bookmarkStorage.getAllBookmarksSorted();
        
        // Perform GitHub sync
        const syncResult = await syncToGitHub(allBookmarks);
        
        if (syncResult.success) {
            console.log(`Auto-synced ${allBookmarks.length} bookmarks to GitHub`);
            
            // Show subtle notification
            showNotification(`Auto-synced ${allBookmarks.length} bookmarks to GitHub`);
            
            // Send status update to dashboard using our forwardMessageToDashboard function
            await forwardMessageToDashboard({ 
                action: 'syncStatusUpdate',
                syncSuccess: true,
                bookmarkCount: allBookmarks.length
            });
        } else {
            console.error('Auto-sync failed:', syncResult.error);
            // Don't show error notifications for auto-sync to avoid spam
        }
        
    } catch (error) {
        console.error('Error in auto-sync:', error);
    }
}

/**
 * Handle messages from popup and content scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        try {
            switch (request.action) {
                case 'saveCurrentPage':
                    const result = await saveCurrentPage(request.tabId);
                    sendResponse(result);
                    break;
                    
                case 'getPageMetadata':
                    const metadata = await getPageMetadata(request.tabId);
                    sendResponse(metadata);
                    break;
                    
                case 'addNoteToBookmark':
                    const noteResult = await bookmarkStorage.addNoteToBookmark(request.url, request.note);
                    if (noteResult.success) {
                        triggerAutoSyncIfEnabled();
                    }
                    sendResponse(noteResult);
                    break;
                    
                case 'deleteNoteFromBookmark':
                    const deleteNoteResult = await bookmarkStorage.deleteNoteFromBookmark(request.url, request.noteId);
                    if (deleteNoteResult.success) {
                        triggerAutoSyncIfEnabled();
                    }
                    sendResponse(deleteNoteResult);
                    break;
                    
                case 'getAllBookmarks':
                    const bookmarks = await bookmarkStorage.getAllBookmarksSorted();
                    sendResponse(bookmarks);
                    break;
                    
                case 'searchBookmarks':
                    const searchResults = await bookmarkStorage.searchBookmarks(request.query);
                    sendResponse(searchResults);
                    break;
                    
                case 'deleteBookmark':
                    const deleteResult = await bookmarkStorage.deleteBookmark(request.url);
                    if (deleteResult.success) {
                        triggerAutoSyncIfEnabled();
                    }
                    sendResponse(deleteResult);
                    break;
                    
                case 'getStorageStats':
                    const stats = await bookmarkStorage.getStorageStats();
                    sendResponse(stats);
                    break;
                    
                case 'exportBookmarks':
                    const exportData = await bookmarkStorage.exportBookmarks();
                    sendResponse({ success: true, data: exportData });
                    break;
                    
                case 'importBookmarks':
                    const importResult = await bookmarkStorage.importBookmarks(request.data, request.merge);
                    if (importResult.success) {
                        triggerAutoSyncIfEnabled();
                    }
                    sendResponse(importResult);
                    break;
                    
                case 'saveBookmark':
                    const saveResult = await bookmarkStorage.saveBookmark(request.bookmarkData);
                    if (saveResult.success) {
                        triggerAutoSyncIfEnabled();
                    }
                    sendResponse(saveResult);
                    break;
                    
                case 'clearAllBookmarks':
                    const clearResult = await bookmarkStorage.clearAllBookmarks();
                    if (clearResult.success) {
                        triggerAutoSyncIfEnabled();
                    }
                    sendResponse(clearResult);
                    break;
                    
                case 'syncStatusUpdate':
                    // Forward sync status updates to dashboard
                    forwardMessageToDashboard(request);
                    sendResponse({ success: true });
                    return true;
                    
                case 'openDashboard':
                    // Open dashboard in new tab
                    try {
                        await chrome.tabs.create({
                            url: chrome.runtime.getURL('dashboard.html')
                        });
                        sendResponse({ success: true });
                    } catch (error) {
                        console.error('Error opening dashboard:', error);
                        sendResponse({ success: false, error: error.message });
                    }
                    return true;
                    
                case 'updateKeyboardShortcuts':
                    // Update keyboard shortcut in all content scripts
                    try {
                        const tabs = await chrome.tabs.query({});
                        const promises = tabs.map(tab => {
                            return chrome.tabs.sendMessage(tab.id, {
                                action: 'updateKeyboardShortcuts',
                                shortcut: request.shortcut
                            }).catch(error => {
                                // Ignore errors for tabs that don't have content script
                                console.log(`Could not update shortcut for tab ${tab.id}:`, error.message);
                            });
                        });
                        
                        await Promise.all(promises);
                        sendResponse({ success: true });
                    } catch (error) {
                        console.error('Error updating keyboard shortcut:', error);
                        sendResponse({ success: false, error: error.message });
                    }
                    return true;
                    
                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Error handling message:', error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    
    // Return true to indicate we'll send a response asynchronously
    return true;
});

/**
 * Handle extension icon click (when popup is not available)
 */
chrome.action.onClicked.addListener(async (tab) => {
    // This will only fire if no popup is defined, but we want popup behavior
    // So this is mainly for fallback purposes
    console.log('Extension icon clicked on tab:', tab.url);
});

// Initialize GitHub sync data
async function initGitHubSync() {
    try {
        const result = await chrome.storage.local.get(['github_access_token', 'github_gist_id']);
        githubToken = result.github_access_token || null;
        gistId = result.github_gist_id || null;
        return true;
    } catch (error) {
        console.error('Error initializing GitHub sync:', error);
        return false;
    }
}

// Check if authenticated with GitHub
function isGitHubAuthenticated() {
    return githubToken !== null;
}

// Perform GitHub sync
async function syncToGitHub(bookmarks) {
    if (!githubToken) {
        console.log('GitHub sync skipped: Not authenticated');
        return { success: false, error: 'Not authenticated' };
    }

    try {
        const bookmarkData = {
            bookmarks: bookmarks,
            exported_at: new Date().toISOString(),
            version: '1.0'
        };

        const gistData = {
            description: 'BookmarkPp - Bookmarks Backup',
            public: false,
            files: {
                'bookmarks.json': {
                    content: JSON.stringify(bookmarkData, null, 2)
                }
            }
        };

        let response;
        if (gistId) {
            // Update existing gist
            response = await fetch(`https://api.github.com/gists/${gistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json'
                },
                body: JSON.stringify(gistData)
            });
        } else {
            // Create new gist
            response = await fetch('https://api.github.com/gists', {
                method: 'POST',
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json'
                },
                body: JSON.stringify(gistData)
            });
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`GitHub API error: ${response.status} - ${errorData.message || 'Unknown error'}`);
        }

        const responseData = await response.json();
        
        // Save gist ID if this was a new gist
        if (!gistId && responseData.id) {
            gistId = responseData.id;
            await chrome.storage.local.set({ github_gist_id: gistId });
        }

        // Save last sync time
        await chrome.storage.local.set({ last_sync_time: new Date().toISOString() });

        return { success: true, gistId: responseData.id };

    } catch (error) {
        console.error('GitHub sync failed:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Forward messages to dashboard tab if open
 */
async function forwardMessageToDashboard(message) {
    try {
        const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('dashboard.html') });
        if (tabs.length > 0) {
            // Send to the first dashboard tab found
            await chrome.tabs.sendMessage(tabs[0].id, message);
        }
    } catch (error) {
        console.log('Could not forward message to dashboard:', error.message);
    }
} 