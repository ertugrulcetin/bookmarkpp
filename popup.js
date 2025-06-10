/**
 * BookmarkPp Popup JavaScript
 * Handles popup UI interactions and communication with background script
 */

// DOM elements
let currentPageInfo = null;
let currentTab = null;

/**
 * Initialize popup when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', async () => {
    await initializePopup();
    setupEventListeners();
});

/**
 * Initialize popup with current page information
 */
async function initializePopup() {
    try {
        // Get current active tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        currentTab = tabs[0];

        if (!currentTab) {
            showStatus('Unable to get current tab information', 'error');
            return;
        }

        // Get page metadata
        currentPageInfo = await getPageMetadata(currentTab.id);
        
        // Update UI with page information
        updatePageDisplay();
        
        // Check if page is already bookmarked
        await checkBookmarkStatus();
        
    } catch (error) {
        console.error('Error initializing popup:', error);
        showStatus('Error loading page information', 'error');
    }
}

/**
 * Get page metadata from content script
 */
async function getPageMetadata(tabId) {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'getPageMetadata',
            tabId: tabId
        });
        
        return {
            title: response?.title || currentTab.title || 'Untitled',
            description: response?.description || '',
            favicon: response?.favicon || currentTab.favIconUrl || '',
            ogImage: response?.ogImage || '',
            url: currentTab.url
        };
    } catch (error) {
        console.error('Error getting page metadata:', error);
        return {
            title: currentTab.title || 'Untitled',
            description: '',
            favicon: currentTab.favIconUrl || '',
            ogImage: '',
            url: currentTab.url
        };
    }
}

/**
 * Update the page display in popup
 */
function updatePageDisplay() {
    if (!currentPageInfo) return;

    const titleElement = document.getElementById('pageTitle');
    const urlElement = document.getElementById('pageUrl');
    const faviconElement = document.getElementById('favicon');

    titleElement.textContent = currentPageInfo.title;
    titleElement.title = currentPageInfo.title; // Tooltip for long titles
    
    urlElement.textContent = currentPageInfo.url;
    urlElement.title = currentPageInfo.url; // Tooltip for long URLs

    // Set favicon
    if (currentPageInfo.favicon) {
        const img = document.createElement('img');
        img.src = currentPageInfo.favicon;
        img.alt = 'Site icon';
        img.onerror = () => {
            // Fallback to text icon if image fails to load
            faviconElement.textContent = '🌐';
        };
        faviconElement.innerHTML = '';
        faviconElement.appendChild(img);
    } else {
        faviconElement.textContent = '🌐';
    }
}

/**
 * Check if current page is already bookmarked
 */
async function checkBookmarkStatus() {
    try {
        const domain = extractDomain(currentPageInfo.url);
        const response = await chrome.runtime.sendMessage({
            action: 'getAllBookmarks'
        });
        
        if (response) {
            const existingBookmark = response.find(bookmark => bookmark.url === currentPageInfo.url);
            const saveBtn = document.getElementById('saveBtn');
            const deleteBtn = document.getElementById('deleteBtn');
            
            if (existingBookmark) {
                saveBtn.innerHTML = '<span class="btn-icon">🔄</span>Update Bookmark';
                saveBtn.classList.add('btn-update');
                deleteBtn.style.display = 'flex';
                showStatus('This page is already bookmarked', 'info');
            } else {
                deleteBtn.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error checking bookmark status:', error);
    }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    const saveBtn = document.getElementById('saveBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const dashboardBtn = document.getElementById('dashboardBtn');

    saveBtn.addEventListener('click', handleSaveBookmark);
    deleteBtn.addEventListener('click', handleDeleteBookmark);
    dashboardBtn.addEventListener('click', handleOpenDashboard);

    // Keyboard shortcuts
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleSaveBookmark();
        } else if (event.key === 'Escape') {
            window.close();
        } else if (event.key === 'd' || event.key === 'D') {
            event.preventDefault();
            handleOpenDashboard();
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
            const deleteBtn = document.getElementById('deleteBtn');
            if (deleteBtn.style.display !== 'none') {
                event.preventDefault();
                handleDeleteBookmark();
            }
        }
    });
}

/**
 * Handle save bookmark button click
 */
async function handleSaveBookmark() {
    const saveBtn = document.getElementById('saveBtn');
    const originalText = saveBtn.innerHTML;
    
    try {
        // Show loading state
        saveBtn.innerHTML = '<span class="btn-icon">⏳</span>Saving...';
        saveBtn.disabled = true;

        const response = await chrome.runtime.sendMessage({
            action: 'saveCurrentPage',
            tabId: currentTab.id
        });

        if (response && response.success) {
            const message = response.isNew ? 'Bookmark saved!' : 'Bookmark updated!';
            showStatus(message, 'success');
            
            // Update button to show success
            saveBtn.innerHTML = '<span class="btn-icon">✅</span>' + (response.isNew ? 'Saved!' : 'Updated!');
            
            // Close popup after brief delay
            setTimeout(() => {
                window.close();
            }, 1500);
        } else {
            throw new Error(response?.error || 'Unknown error occurred');
        }
    } catch (error) {
        console.error('Error saving bookmark:', error);
        showStatus('Failed to save bookmark: ' + error.message, 'error');
        
        // Restore button
        saveBtn.innerHTML = originalText;
        saveBtn.disabled = false;
    }
}

/**
 * Handle delete bookmark button click
 */
async function handleDeleteBookmark() {
    if (!currentPageInfo) return;
    
    const deleteBtn = document.getElementById('deleteBtn');
    const originalText = deleteBtn.innerHTML;
    
    try {
        // Show loading state
        deleteBtn.innerHTML = '<span class="btn-icon">⏳</span>Deleting...';
        deleteBtn.disabled = true;

        const response = await chrome.runtime.sendMessage({
            action: 'deleteBookmark',
            url: currentPageInfo.url
        });

        if (response && response.success) {
            showStatus('Bookmark deleted!', 'success');
            
            // Update UI to reflect deletion
            deleteBtn.style.display = 'none';
            const saveBtn = document.getElementById('saveBtn');
            saveBtn.innerHTML = '<span class="btn-icon">💾</span>Save This Page';
            saveBtn.classList.remove('btn-update');
            
            // Show confirmation
            deleteBtn.innerHTML = '<span class="btn-icon">✅</span>Deleted!';
            
            // Close popup after brief delay
            setTimeout(() => {
                window.close();
            }, 1500);
        } else {
            throw new Error(response?.error || 'Unknown error occurred');
        }
    } catch (error) {
        console.error('Error deleting bookmark:', error);
        showStatus('Failed to delete bookmark: ' + error.message, 'error');
        
        // Restore button
        deleteBtn.innerHTML = originalText;
        deleteBtn.disabled = false;
    }
}

/**
 * Handle open dashboard button click
 */
async function handleOpenDashboard() {
    try {
        const dashboardUrl = chrome.runtime.getURL('dashboard.html');
        await chrome.tabs.create({ url: dashboardUrl });
        window.close();
    } catch (error) {
        console.error('Error opening dashboard:', error);
        showStatus('Failed to open dashboard', 'error');
    }
}

/**
 * Show status message
 */
function showStatus(message, type = 'info') {
    const statusElement = document.getElementById('status');
    statusElement.textContent = message;
    statusElement.className = `status ${type}`;
    
    // Auto-hide success and info messages
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 3000);
    }
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace('www.', '');
    } catch (error) {
        console.error('Invalid URL:', url);
        return 'unknown';
    }
}

/**
 * Handle popup errors gracefully
 */
window.addEventListener('error', (event) => {
    console.error('Popup error:', event.error);
    showStatus('An unexpected error occurred', 'error');
});

/**
 * Handle unhandled promise rejections
 */
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    showStatus('An unexpected error occurred', 'error');
}); 