/**
 * BookmarkPp Dashboard JavaScript
 * Core functionality for bookmark display and management
 */

let allBookmarks = [];
let filteredBookmarks = [];
let currentBookmark = null;
let currentView = 'card'; // Default view

// Fuse.js instance for fuzzy search
let fuse = null;

// Pagination variables
let currentPage = 0;
let isLoadingMore = false;
let hasMoreItems = true;

// Auto-sync variables
let autoSyncTimeout = null;
const AUTO_SYNC_DELAY = 3000; // 3 seconds delay to debounce multiple rapid changes

// Keyboard shortcut variables
let isRecordingShortcut = false;
let currentRecordingInput = null;

/**
 * Initialize Fuse.js for fuzzy search
 */
function initializeFuseSearch() {
    const fuseOptions = {
        // Include score and matched indices for debugging/highlighting
        includeScore: true,
        includeMatches: true,
        
        // Threshold for fuzzy matching (0.0 = exact match, 1.0 = match anything)
        threshold: 0.3,
        
        // At what point does the match algorithm give up (0.0 = perfect match required)
        location: 0,
        distance: 100,
        
        // Minimum character length that will be searched
        minMatchCharLength: 2,
        
        // Fields to search in
        keys: [
            {
                name: 'title',
                weight: 0.4 // Title has highest weight
            },
            {
                name: 'description',
                weight: 0.3
            },
            {
                name: 'url',
                weight: 0.2
            },
            {
                name: 'notes',
                weight: 0.1,
                getFn: (bookmark) => {
                    // Extract text from all notes
                    return (bookmark.notes || []).map(note => note.text).join(' ');
                }
            }
        ]
    };
    
    // Initialize Fuse with current bookmarks
    fuse = new Fuse(allBookmarks, fuseOptions);
}

/**
 * Update Fuse.js with new bookmark data
 */
function updateFuseSearch() {
    if (fuse) {
        fuse.setCollection(allBookmarks);
    } else {
        initializeFuseSearch();
    }
}

/**
 * Get items per page from localStorage with default fallback
 */
function getItemsPerPage() {
    const saved = localStorage.getItem('bookmarkpp-items-per-page');
    return saved ? parseInt(saved) : 50; // Default to 50
}

/**
 * Save items per page to localStorage
 */
function saveItemsPerPage(itemsPerPage) {
    localStorage.setItem('bookmarkpp-items-per-page', itemsPerPage.toString());
}

/**
 * Get open on click preference from localStorage
 */
function getOpenOnClickPreference() {
    const saved = localStorage.getItem('bookmarkpp-open-on-click');
    return saved === 'true'; // Default to false
}

/**
 * Save open on click preference to localStorage
 */
function saveOpenOnClickPreference(openOnClick) {
    localStorage.setItem('bookmarkpp-open-on-click', openOnClick.toString());
}

/**
 * Format key combination for display
 */
function formatKeyCombo(keys) {
    const modifierMap = {
        'Meta': '⌘',
        'Control': 'Ctrl',
        'Alt': '⌥',
        'Shift': '⇧'
    };
    
    const parts = [];
    const modifiers = ['Meta', 'Control', 'Alt', 'Shift'];
    
    // Add modifiers in standard order
    modifiers.forEach(mod => {
        if (keys[mod]) {
            parts.push(modifierMap[mod] || mod);
        }
    });
    
    // Add the main key
    if (keys.key && !modifiers.includes(keys.key)) {
        parts.push(keys.key.toUpperCase());
    }
    
    return parts.join('+');
}

/**
 * Parse key combination from string
 */
function parseKeyCombo(comboString) {
    if (!comboString) return null;
    
    const parts = comboString.split('+');
    const keys = {
        Meta: false,
        Control: false,
        Alt: false,
        Shift: false,
        key: ''
    };
    
    parts.forEach(part => {
        switch (part) {
            case '⌘':
                keys.Meta = true;
                break;
            case 'Ctrl':
                keys.Control = true;
                break;
            case '⌥':
                keys.Alt = true;
                break;
            case '⇧':
                keys.Shift = true;
                break;
            default:
                keys.key = part.toLowerCase();
        }
    });
    
    return keys;
}

/**
 * Save keyboard shortcuts to storage
 */
async function saveKeyboardShortcuts(shortcut) {
    try {
        await chrome.storage.local.set({ dashboard_shortcut: shortcut });
        return true;
    } catch (error) {
        console.error('Error saving keyboard shortcut:', error);
        return false;
    }
}

/**
 * Load keyboard shortcuts from storage
 */
async function loadKeyboardShortcuts() {
    try {
        const result = await chrome.storage.local.get(['dashboard_shortcut']);
        return result.dashboard_shortcut || null;
    } catch (error) {
        console.error('Error loading keyboard shortcut:', error);
        return null;
    }
}

/**
 * Start recording a keyboard shortcut
 */
function startShortcutRecording(inputId) {
    if (isRecordingShortcut) return;
    
    isRecordingShortcut = true;
    currentRecordingInput = inputId;
    
    const input = document.getElementById(inputId);
    if (!input) return;
    
    input.classList.add('recording');
    input.value = 'Press key combination...';
    input.focus();
    
    // Add global keydown listener
    document.addEventListener('keydown', handleShortcutRecording);
}

/**
 * Handle keyboard shortcut recording
 */
async function handleShortcutRecording(event) {
    if (!isRecordingShortcut || !currentRecordingInput) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    // Ignore modifier-only keys
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) {
        return;
    }
    
    // Capture the key combination
    const keyCombo = {
        Meta: event.metaKey,
        Control: event.ctrlKey,
        Alt: event.altKey,
        Shift: event.shiftKey,
        key: event.key
    };
    
    // Require at least one modifier
    if (!keyCombo.Meta && !keyCombo.Control && !keyCombo.Alt) {
        showToast('Please use at least one modifier key (⌘, Ctrl, or ⌥)', 'warning');
        return;
    }
    
    const formattedCombo = formatKeyCombo(keyCombo);
    const input = document.getElementById(currentRecordingInput);
    
    if (input) {
        input.value = formattedCombo;
        input.classList.remove('recording');
    }
    
    // Save the shortcut
    const saved = await saveKeyboardShortcuts(keyCombo);
    if (saved) {
        showToast(`Dashboard shortcut saved: ${formattedCombo}`, 'success');
        
        // Update content script with new shortcut
        updateContentScriptShortcuts(keyCombo);
    } else {
        showToast('Failed to save shortcut', 'error');
    }
    
    // Clean up
    stopShortcutRecording();
}

/**
 * Stop recording keyboard shortcut
 */
function stopShortcutRecording() {
    isRecordingShortcut = false;
    currentRecordingInput = null;
    document.removeEventListener('keydown', handleShortcutRecording);
}

/**
 * Clear a keyboard shortcut
 */
async function clearKeyboardShortcut() {
    const saved = await saveKeyboardShortcuts(null);
    if (saved) {
        const input = document.getElementById('dashboardShortcut');
        if (input) {
            input.value = '';
        }
        
        showToast('Dashboard shortcut cleared', 'success');
        
        // Update content script with cleared shortcut
        updateContentScriptShortcuts(null);
    } else {
        showToast('Failed to clear shortcut', 'error');
    }
}

/**
 * Update content script with current shortcut
 */
async function updateContentScriptShortcuts(shortcut) {
    try {
        // Send message to background script to update content scripts
        await chrome.runtime.sendMessage({
            action: 'updateKeyboardShortcuts',
            shortcut: shortcut
        });
    } catch (error) {
        console.error('Error updating content script shortcut:', error);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    loadViewPreference(); // Load saved view preference
    setupEventListeners();
    await loadBookmarks();
    
    // Listen for sync status updates from background script
    if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === 'syncStatusUpdate') {
                // Update UI to reflect sync status
                if (message.syncSuccess) {
                    console.log(`Background sync completed: ${message.bookmarkCount} bookmarks synced`);
                    
                    // Show toast notification
                    showToast(`Auto-synced ${message.bookmarkCount} bookmarks to GitHub`, 'success');
                    
                    // Update last sync time if settings modal is open
                    const settingsModal = document.getElementById('settingsModal');
                    if (settingsModal && settingsModal.style.display === 'flex') {
                        updateLastSyncTime();
                        updateSyncStatus();
                    }
                }
                sendResponse({ success: true });
            }
        });
    }
});

/**
 * Load view preference from localStorage
 */
function loadViewPreference() {
    const savedView = localStorage.getItem('bookmarkpp-view-preference');
    if (savedView && ['list', 'card', 'detail'].includes(savedView)) {
        currentView = savedView;
    }
    
    // Set initial active button state
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const activeBtn = document.querySelector(`[data-view="${currentView}"]`);
    if (activeBtn) activeBtn.classList.add('active');
}

/**
 * Save view preference to localStorage
 */
function saveViewPreference(viewMode) {
    localStorage.setItem('bookmarkpp-view-preference', viewMode);
}

function setupEventListeners() {
    // Search functionality
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearch');
    
    if (searchInput) {
        searchInput.addEventListener('input', handleSearch);
    }
    
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = '';
                hideSearchResultsCounter();
                resetPagination();
                applyFilters(); // Reset to show all bookmarks
            }
        });
    }

    // Filter and sort
    const sortBy = document.getElementById('sortBy');
    const filterBy = document.getElementById('filterBy');
    if (sortBy) sortBy.addEventListener('change', () => {
        resetPagination();
        applySort();
    });
    if (filterBy) filterBy.addEventListener('change', handleFilterChange);

    // Custom date range controls
    const applyDateRangeBtn = document.getElementById('applyDateRange');
    const clearDateRangeBtn = document.getElementById('clearDateRange');
    const dateFromInput = document.getElementById('dateFrom');
    const dateToInput = document.getElementById('dateTo');
    
    if (applyDateRangeBtn) applyDateRangeBtn.addEventListener('click', applyCustomDateRange);
    if (clearDateRangeBtn) clearDateRangeBtn.addEventListener('click', clearCustomDateRange);
    if (dateFromInput) dateFromInput.addEventListener('change', validateDateRange);
    if (dateToInput) dateToInput.addEventListener('change', validateDateRange);

    // View switcher
    const listViewBtn = document.getElementById('listView');
    const cardViewBtn = document.getElementById('cardView');
    const detailViewBtn = document.getElementById('detailView');
    
    if (listViewBtn) listViewBtn.addEventListener('click', () => switchView('list'));
    if (cardViewBtn) cardViewBtn.addEventListener('click', () => switchView('card'));
    if (detailViewBtn) detailViewBtn.addEventListener('click', () => switchView('detail'));

    // Modal events
    const closeModal = document.getElementById('closeModal');
    const deleteBookmarkBtn = document.getElementById('deleteBookmarkBtn');
    const visitBookmarkBtn = document.getElementById('visitBookmarkBtn');
    const addNoteBtn = document.getElementById('addNoteBtn');
    
    if (closeModal) closeModal.addEventListener('click', closeBookmarkModal);
    if (deleteBookmarkBtn) deleteBookmarkBtn.addEventListener('click', handleDeleteBookmark);
    if (visitBookmarkBtn) visitBookmarkBtn.addEventListener('click', () => {
        if (currentBookmark) window.open(currentBookmark.url, '_blank');
    });
    if (addNoteBtn) addNoteBtn.addEventListener('click', handleAddNote);

    // Notes modal events
    const allNotesBtn = document.getElementById('notesBtn');
    const closeNotesModal = document.getElementById('closeNotesModal');
    
    if (allNotesBtn) allNotesBtn.addEventListener('click', openNotesModal);
    if (closeNotesModal) closeNotesModal.addEventListener('click', handleCloseNotesModal);

    // Import/Export
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const importPocketBtn = document.getElementById('importPocketBtn');
    const importFileInput = document.getElementById('importFile');
    const importPocketInput = document.getElementById('importPocketFile');
    
    if (exportBtn) exportBtn.addEventListener('click', handleExport);
    if (importBtn) importBtn.addEventListener('click', () => importFileInput?.click());
    if (importPocketBtn) importPocketBtn.addEventListener('click', () => importPocketInput?.click());
    if (importFileInput) importFileInput.addEventListener('change', handleImport);
    if (importPocketInput) importPocketInput.addEventListener('change', handlePocketImport);

    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => loadBookmarks(true));

    // Settings modal events
    const settingsBtn = document.getElementById('settingsBtn');
    const closeSettingsModalBtn = document.getElementById('closeSettingsModal');
    
    if (settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);
    if (closeSettingsModalBtn) closeSettingsModalBtn.addEventListener('click', closeSettingsModal);

    // GitHub sync events
    const connectGitHubBtn = document.getElementById('connectGitHubBtn');
    const disconnectGitHubBtn = document.getElementById('disconnectGitHubBtn');
    const syncUpBtn = document.getElementById('syncUpBtn');
    const syncDownBtn = document.getElementById('syncDownBtn');
    
    if (connectGitHubBtn) connectGitHubBtn.addEventListener('click', handleConnectGitHub);
    if (disconnectGitHubBtn) disconnectGitHubBtn.addEventListener('click', handleDisconnectGitHub);
    if (syncUpBtn) syncUpBtn.addEventListener('click', handleSyncUp);
    if (syncDownBtn) syncDownBtn.addEventListener('click', handleSyncDown);

    // Settings controls
    const defaultView = document.getElementById('defaultView');
    const itemsPerPage = document.getElementById('itemsPerPage');
    const autoSync = document.getElementById('autoSync');
    const openOnClick = document.getElementById('openOnClick');
    const exportDataBtn = document.getElementById('exportDataBtn');
    const clearAllDataBtn = document.getElementById('clearAllDataBtn');
    
    if (defaultView) defaultView.addEventListener('change', handleDefaultViewChange);
    if (itemsPerPage) itemsPerPage.addEventListener('change', handleItemsPerPageChange);
    if (autoSync) autoSync.addEventListener('change', handleAutoSyncChange);
    if (openOnClick) openOnClick.addEventListener('change', handleOpenOnClickChange);
    if (exportDataBtn) exportDataBtn.addEventListener('click', handleExport);
    if (clearAllDataBtn) clearAllDataBtn.addEventListener('click', handleClearAllData);

    // Import progress modal
    const cancelImportBtn = document.getElementById('cancelImportBtn');
    const closeImportBtn = document.getElementById('closeImportBtn');
    
    if (cancelImportBtn) cancelImportBtn.addEventListener('click', cancelPocketImport);
    if (closeImportBtn) closeImportBtn.addEventListener('click', closeImportProgressModal);

    // Infinite scroll
    window.addEventListener('scroll', handleScroll);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeBookmarkModal();
            handleCloseNotesModal();
            closeImportProgressModal();
            closeSettingsModal();
        }
    });

    // Keyboard shortcut controls
    const recordDashboardShortcut = document.getElementById('recordDashboardShortcut');
    const clearDashboardShortcut = document.getElementById('clearDashboardShortcut');
    
    if (recordDashboardShortcut) recordDashboardShortcut.addEventListener('click', () => startShortcutRecording('dashboardShortcut'));
    if (clearDashboardShortcut) clearDashboardShortcut.addEventListener('click', () => clearKeyboardShortcut());
}

/**
 * Handle filter dropdown change
 */
function handleFilterChange() {
    const filterBy = document.getElementById('filterBy');
    const customDateRange = document.getElementById('customDateRange');
    const filterValue = filterBy?.value;
    
    // Show/hide custom date range based on selection
    if (customDateRange) {
        if (filterValue === 'custom-range') {
            customDateRange.style.display = 'block';
            // Set default dates if not already set
            const dateFrom = document.getElementById('dateFrom');
            const dateTo = document.getElementById('dateTo');
            if (dateFrom && !dateFrom.value) {
                const oneMonthAgo = new Date();
                oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
                dateFrom.value = oneMonthAgo.toISOString().split('T')[0];
            }
            if (dateTo && !dateTo.value) {
                dateTo.value = new Date().toISOString().split('T')[0];
            }
        } else {
            customDateRange.style.display = 'none';
            // Apply filter immediately for non-custom options
            resetPagination();
            applyFilters();
        }
    }
}

/**
 * Validate date range inputs
 */
function validateDateRange() {
    const dateFromInput = document.getElementById('dateFrom');
    const dateToInput = document.getElementById('dateTo');
    const applyBtn = document.getElementById('applyDateRange');
    
    if (!dateFromInput || !dateToInput || !applyBtn) return;
    
    const fromDate = new Date(dateFromInput.value);
    const toDate = new Date(dateToInput.value);
    
    // Check if from date is after to date
    if (dateFromInput.value && dateToInput.value && fromDate > toDate) {
        dateFromInput.setCustomValidity('From date cannot be after To date');
        dateToInput.setCustomValidity('To date cannot be before From date');
        applyBtn.disabled = true;
    } else {
        dateFromInput.setCustomValidity('');
        dateToInput.setCustomValidity('');
        applyBtn.disabled = false;
    }
}

/**
 * Apply custom date range filter
 */
function applyCustomDateRange() {
    const dateFromInput = document.getElementById('dateFrom');
    const dateToInput = document.getElementById('dateTo');
    
    if (!dateFromInput?.value || !dateToInput?.value) {
        showToast('Please select both From and To dates', 'warning');
        return;
    }
    
    const fromDate = new Date(dateFromInput.value);
    const toDate = new Date(dateToInput.value);
    
    if (fromDate > toDate) {
        showToast('From date cannot be after To date', 'error');
        return;
    }
    
    // Set end of day for toDate to include bookmarks from that day
    toDate.setHours(23, 59, 59, 999);
    
    resetPagination();
    applyFilters();
    
    const fromStr = fromDate.toLocaleDateString();
    const toStr = new Date(dateToInput.value).toLocaleDateString();
    showToast(`Filtered bookmarks from ${fromStr} to ${toStr}`, 'success');
}

/**
 * Clear custom date range
 */
function clearCustomDateRange() {
    const dateFromInput = document.getElementById('dateFrom');
    const dateToInput = document.getElementById('dateTo');
    const filterBy = document.getElementById('filterBy');
    
    if (dateFromInput) dateFromInput.value = '';
    if (dateToInput) dateToInput.value = '';
    if (filterBy) filterBy.value = 'all';
    
    // Hide the date range picker
    const customDateRange = document.getElementById('customDateRange');
    if (customDateRange) customDateRange.style.display = 'none';
    
    resetPagination();
    applyFilters();
    showToast('Date range filter cleared', 'success');
}

function applyFilters() {
    const filterBy = document.getElementById('filterBy');
    const filterValue = filterBy?.value || 'all';
    
    // Check if there's an active search query
    const searchInput = document.getElementById('searchInput');
    const hasActiveSearch = searchInput?.value.trim() !== '';
    
    // If no active search, reset pagination and apply filters to all bookmarks
    if (!hasActiveSearch) {
        resetPagination();
    }
    
    filteredBookmarks = [...allBookmarks];
    
    if (filterValue === 'last-7-days') {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        filteredBookmarks = filteredBookmarks.filter(bookmark => 
            new Date(bookmark.created_at) >= sevenDaysAgo
        );
    } else if (filterValue === 'last-30-days') {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        filteredBookmarks = filteredBookmarks.filter(bookmark => 
            new Date(bookmark.created_at) >= thirtyDaysAgo
        );
    } else if (filterValue === 'custom-range') {
        const dateFromInput = document.getElementById('dateFrom');
        const dateToInput = document.getElementById('dateTo');
        
        if (dateFromInput?.value && dateToInput?.value) {
            const fromDate = new Date(dateFromInput.value);
            const toDate = new Date(dateToInput.value);
            toDate.setHours(23, 59, 59, 999); // Include full day
            
            filteredBookmarks = filteredBookmarks.filter(bookmark => {
                const bookmarkDate = new Date(bookmark.created_at);
                return bookmarkDate >= fromDate && bookmarkDate <= toDate;
            });
        }
    } else if (filterValue === 'has-notes') {
        filteredBookmarks = filteredBookmarks.filter(bookmark => 
            bookmark.notes && bookmark.notes.length > 0
        );
    } else if (filterValue === 'no-notes') {
        filteredBookmarks = filteredBookmarks.filter(bookmark => 
            !bookmark.notes || bookmark.notes.length === 0
        );
    }
    
    // Hide search results counter when not searching
    if (!hasActiveSearch) {
        hideSearchResultsCounter();
    }
    
    applySort();
}

async function loadBookmarks(showMessage = false) {
    try {
        if (showMessage) showLoadingState();
        
        const response = await chrome.runtime.sendMessage({ action: 'getAllBookmarks' });
        allBookmarks = response || [];
        
        // Initialize or update fuzzy search
        updateFuseSearch();
        
        // Reset pagination when loading fresh data
        resetPagination();
        
        updateStats();
        applyFilters(); // This will apply current filters and display bookmarks
        
        if (showMessage && allBookmarks.length > 0) {
            showToast('Bookmarks refreshed!', 'success');
        }
    } catch (error) {
        console.error('Error loading bookmarks:', error);
        showToast('Failed to load bookmarks', 'error');
        showEmptyState();
    }
}

/**
 * Display bookmarks in the selected view mode
 */
function displayBookmarks(append = false) {
    const bookmarksList = document.getElementById('bookmarksList');
    const loadingState = document.getElementById('loadingState');
    const emptyState = document.getElementById('emptyState');
    const noResults = document.getElementById('noResults');
    const bookmarksContainer = document.getElementById('bookmarksContainer');
    
    if (!bookmarksList) return Promise.resolve();
    
    return new Promise((resolve) => {
        // Calculate items to show
        const startIndex = append ? currentPage * getItemsPerPage() : 0;
        const endIndex = (currentPage + 1) * getItemsPerPage();
        const itemsToShow = filteredBookmarks.slice(startIndex, endIndex);
        
        // Update hasMoreItems flag
        hasMoreItems = endIndex < filteredBookmarks.length;
        
        if (filteredBookmarks.length === 0) {
            // Show appropriate empty state
            const searchInput = document.getElementById('searchInput');
            const hasActiveSearch = searchInput?.value.trim() !== '';
            
            hideAllStates();
            if (hasActiveSearch) {
                if (noResults) noResults.style.display = 'flex';
            } else {
                if (emptyState) emptyState.style.display = 'flex';
            }
            resolve();
            return;
        }
        
        // Hide all states and show bookmarks container
        hideAllStates();
        if (bookmarksContainer) bookmarksContainer.style.display = 'block';
        
        // Set view mode class
        bookmarksList.className = `bookmarks-grid ${currentView}-view`;
        
        // Generate HTML for items to show
        const itemsHTML = itemsToShow.map(bookmark => createBookmarkCard(bookmark)).join('');
        
        if (append) {
            // Append new items for infinite scroll
            bookmarksList.insertAdjacentHTML('beforeend', itemsHTML);
        } else {
            // Replace all items (initial load or filter change)
            bookmarksList.innerHTML = itemsHTML;
            // Set up event delegation for bookmark clicks (only once)
            bookmarksList.removeEventListener('click', handleBookmarkClick);
            bookmarksList.addEventListener('click', handleBookmarkClick);
        }
        
        resolve();
    });
}

// Event handler for bookmark clicks using event delegation
function handleBookmarkClick(event) {
    // Don't handle clicks on URLs - they should navigate normally
    if (event.target.classList.contains('bookmark-url')) {
        event.stopPropagation(); // Prevent opening modal when clicking URL
        return;
    }
    
    // Find the bookmark card element
    const card = event.target.closest('.bookmark-card');
    if (!card) return;
    
    // Get the bookmark URL from data attribute
    const url = card.getAttribute('data-url');
    if (!url) return;
    
    // Check user preference for click behavior
    const openOnClick = getOpenOnClickPreference();
    
    if (openOnClick) {
        // Open the bookmark URL directly in a new tab
        window.open(url, '_blank');
    } else {
        // Find the bookmark object and open modal (default behavior)
        const bookmark = filteredBookmarks.find(b => b.url === url);
        if (bookmark) {
            openBookmarkModal(bookmark);
        }
    }
}

/**
 * Highlight matched text based on Fuse.js matches
 */
function highlightMatches(text, matches, fieldName) {
    if (!matches || !text) return escapeHtml(text);
    
    // Find matches for this specific field
    const fieldMatches = matches.filter(match => match.key === fieldName);
    if (fieldMatches.length === 0) return escapeHtml(text);
    
    // Collect all match indices
    const allIndices = [];
    fieldMatches.forEach(match => {
        match.indices.forEach(([start, end]) => {
            allIndices.push({ start, end });
        });
    });
    
    if (allIndices.length === 0) return escapeHtml(text);
    
    // Sort indices by start position
    allIndices.sort((a, b) => a.start - b.start);
    
    // Merge overlapping indices
    const mergedIndices = [];
    let current = allIndices[0];
    
    for (let i = 1; i < allIndices.length; i++) {
        const next = allIndices[i];
        if (current.end >= next.start - 1) {
            // Overlapping or adjacent, merge them
            current.end = Math.max(current.end, next.end);
        } else {
            // No overlap, add current and move to next
            mergedIndices.push(current);
            current = next;
        }
    }
    mergedIndices.push(current);
    
    // Build highlighted text
    let result = '';
    let lastIndex = 0;
    
    mergedIndices.forEach(({ start, end }) => {
        // Add text before the match
        result += escapeHtml(text.substring(lastIndex, start));
        
        // Add highlighted match
        result += `<mark class="search-highlight">${escapeHtml(text.substring(start, end + 1))}</mark>`;
        
        lastIndex = end + 1;
    });
    
    // Add remaining text
    result += escapeHtml(text.substring(lastIndex));
    
    return result;
}

function createBookmarkCard(bookmark) {
    const notesCount = bookmark.notes?.length || 0;
    const domain = extractDomain(bookmark.url);
    const formattedDate = formatDate(bookmark.created_at);
    
    // Check if this bookmark has search matches for highlighting
    const hasMatches = bookmark._fuseMatches && bookmark._fuseMatches.length > 0;
    
    // Use highlighted versions if available, otherwise use regular escaped text
    const displayTitle = hasMatches ? 
        highlightMatches(bookmark.title, bookmark._fuseMatches, 'title') : 
        escapeHtml(bookmark.title);
    
    const displayDescription = bookmark.description ? (hasMatches ? 
        highlightMatches(bookmark.description, bookmark._fuseMatches, 'description') : 
        escapeHtml(bookmark.description)) : '';
    
    // Use ogImage if available, otherwise fall back to favicon
    const displayImage = bookmark.ogImage || bookmark.favicon;
    const faviconElement = bookmark.favicon ? 
        `<img src="${bookmark.favicon}" alt="Favicon" onerror="this.parentElement.innerHTML='🌐'">` : 
        '🌐';
    
    let cardHTML = '';
    
    if (currentView === 'list') {
        // List view layout
        cardHTML = `
            <div class="bookmark-header">
                <div class="bookmark-favicon">
                    ${faviconElement}
                </div>
                <div class="bookmark-info">
                    <h3 class="bookmark-title">${displayTitle}</h3>
                    <a href="${bookmark.url}" class="bookmark-url" target="_blank">${bookmark.url}</a>
                </div>
            </div>
            
            <div class="bookmark-meta">
                <div class="bookmark-date">📅 ${formattedDate}</div>
                <div class="meta-right">
                    ${notesCount > 0 ? `<div class="bookmark-notes">📝 ${notesCount}</div>` : ''}
                    <div class="bookmark-domain">${domain}</div>
                </div>
            </div>
        `;
    } else if (currentView === 'detail') {
        // Detail view layout - use ogImage for preview if available
        cardHTML = `
            <div class="bookmark-preview">
                ${displayImage ? 
                    `<img src="${displayImage}" alt="Preview" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;" onerror="this.parentElement.innerHTML='🌐<br>No Preview'">` : 
                    '🌐<br>No Preview'
                }
            </div>
            <div class="bookmark-content">
                <div class="bookmark-header">
                    <div class="bookmark-info">
                        <h3 class="bookmark-title">${displayTitle}</h3>
                        <a href="${bookmark.url}" class="bookmark-url" target="_blank">${bookmark.url}</a>
                    </div>
                </div>
                
                ${displayDescription ? `<p class="bookmark-description">${displayDescription}</p>` : ''}
                
                <div class="bookmark-meta">
                    <div class="bookmark-date">📅 ${formattedDate}</div>
                    <div class="meta-right">
                        ${notesCount > 0 ? `<div class="bookmark-notes">📝 ${notesCount}</div>` : ''}
                        <div class="bookmark-domain">${domain}</div>
                    </div>
                </div>
            </div>
        `;
    } else {
        // Card view layout with image on top
        cardHTML = `
            <div class="bookmark-card-image">
                ${displayImage ? 
                    `<img src="${displayImage}" alt="Preview" style="width: 100%; height: 100%; object-fit: cover;" 
                          onerror="this.style.display='none'; this.parentNode.querySelector('.placeholder-icon').style.display='flex';">
                     <div class="placeholder-icon" style="display: none;">🌐</div>` : 
                    '<div class="placeholder-icon">🌐</div>'
                }
            </div>
            
            <div class="bookmark-card-content">
                <div class="bookmark-info">
                    <h3 class="bookmark-title">${displayTitle}</h3>
                    <a href="${bookmark.url}" class="bookmark-url" target="_blank">${bookmark.url}</a>
                </div>
                
                ${displayDescription ? `<p class="bookmark-description">${displayDescription}</p>` : ''}
                
                <div class="bookmark-meta">
                    <div class="bookmark-date">📅 ${formattedDate}</div>
                    <div class="meta-right">
                        ${notesCount > 0 ? `<div class="bookmark-notes">📝 ${notesCount}</div>` : ''}
                        <div class="bookmark-domain">${domain}</div>
                    </div>
                </div>
            </div>
        `;
    }
    
    return `<div class="bookmark-card" data-url="${bookmark.url}">${cardHTML}</div>`;
}

/**
 * Update sort options based on search state
 */
function updateSortOptions(isSearching) {
    const sortSelect = document.getElementById('sortBy');
    if (!sortSelect) return;
    
    if (isSearching) {
        // When searching, automatically select relevance if not already selected
        if (sortSelect.value !== 'relevance') {
            sortSelect.value = 'relevance';
        }
        
        // Add visual indicator that relevance is recommended
        const relevanceOption = sortSelect.querySelector('option[value="relevance"]');
        if (relevanceOption) {
            relevanceOption.textContent = 'Sort by Relevance (Recommended)';
        }
    } else {
        // When not searching, remove the recommendation text
        const relevanceOption = sortSelect.querySelector('option[value="relevance"]');
        if (relevanceOption) {
            relevanceOption.textContent = 'Sort by Relevance';
        }
        
        // If relevance was selected, switch to date-desc
        if (sortSelect.value === 'relevance') {
            sortSelect.value = 'date-desc';
        }
    }
}

function handleSearch() {
    const searchInput = document.getElementById('searchInput');
    const query = searchInput?.value.trim() || '';
    
    resetPagination(); // Reset pagination for new search
    
    if (query === '') {
        hideSearchResultsCounter();
        updateSortOptions(false); // Not searching
        applyFilters();
        return;
    }
    
    // Use Fuse.js for fuzzy search
    if (!fuse) {
        initializeFuseSearch();
    }
    
    if (query.length < 2) {
        // For very short queries, show no results
        filteredBookmarks = [];
    } else {
        // Perform fuzzy search
        const searchResults = fuse.search(query);
        
        // Extract bookmark objects from Fuse.js results
        filteredBookmarks = searchResults.map(result => ({
            ...result.item,
            _fuseScore: result.score, // Store search score for potential sorting
            _fuseMatches: result.matches // Store match information for potential highlighting
        }));
    }
    
    updateSearchResultsCounter(filteredBookmarks.length, query);
    updateSortOptions(true); // Is searching
    applySort();
}

function updateSearchResultsCounter(count, query) {
    const searchResults = document.getElementById('searchResults');
    const searchResultsText = document.getElementById('searchResultsText');
    
    if (!searchResults || !searchResultsText) return;
    
    // Hide counter if no results found
    if (count === 0) {
        searchResults.style.display = 'none';
        return;
    }
    
    // Show counter with results
    const resultText = count === 1 ? 'result' : 'results';
    searchResultsText.textContent = `${count} ${resultText}`;
    
    // Remove no-results class since we have results
    searchResults.classList.remove('no-results');
    searchResults.style.display = 'block';
}

function hideSearchResultsCounter() {
    const searchResults = document.getElementById('searchResults');
    if (searchResults) {
        searchResults.style.display = 'none';
    }
}

function applySort() {
    const sortBy = document.getElementById('sortBy');
    const sortValue = sortBy?.value || 'date-desc';
    
    // Check if we have search results with scores for relevance sorting
    const hasSearchScores = filteredBookmarks.length > 0 && 
                           typeof filteredBookmarks[0]._fuseScore !== 'undefined';
    
    switch (sortValue) {
        case 'relevance':
            if (hasSearchScores) {
                // Sort by search relevance (lower score = better match)
                filteredBookmarks.sort((a, b) => {
                    const scoreA = a._fuseScore || 1;
                    const scoreB = b._fuseScore || 1;
                    return scoreA - scoreB;
                });
            } else {
                // Fallback to date if no search scores
                filteredBookmarks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            }
            break;
        case 'date-asc':
            filteredBookmarks.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            break;
        case 'date-desc':
            filteredBookmarks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            break;
        case 'title-asc':
            filteredBookmarks.sort((a, b) => a.title.localeCompare(b.title));
            break;
        case 'title-desc':
            filteredBookmarks.sort((a, b) => b.title.localeCompare(a.title));
            break;
        case 'domain':
            filteredBookmarks.sort((a, b) => {
                const domainA = extractDomain(a.url);
                const domainB = extractDomain(b.url);
                return domainA.localeCompare(domainB);
            });
            break;
    }
    
    displayBookmarks(); // Display with pagination
}

function updateStats() {
    const totalBookmarks = document.getElementById('totalBookmarks');
    const totalDomains = document.getElementById('totalDomains');
    
    if (totalBookmarks) totalBookmarks.textContent = allBookmarks.length;
    if (totalDomains) {
        const domains = new Set(allBookmarks.map(b => extractDomain(b.url)));
        totalDomains.textContent = domains.size;
    }
}

function openBookmarkModal(bookmark) {
    currentBookmark = bookmark;
    const modal = document.getElementById('bookmarkModal');
    if (!modal) return;
    
    // Update modal content
    updateElement('modalBookmarkTitle', bookmark.title);
    updateElement('modalBookmarkDesc', bookmark.description || 'No description');
    updateElement('modalBookmarkDate', formatDate(bookmark.created_at));
    updateElement('modalBookmarkDomain', extractDomain(bookmark.url));
    
    const urlElement = document.getElementById('modalBookmarkUrl');
    if (urlElement) {
        urlElement.href = bookmark.url;
        urlElement.textContent = bookmark.url;
    }
    
    const favicon = document.getElementById('modalFavicon');
    if (favicon) {
        favicon.innerHTML = bookmark.favicon ? 
            `<img src="${bookmark.favicon}" alt="Favicon" onerror="this.innerHTML='🌐'">` : 
            '🌐';
    }
    
    displayNotes(bookmark.notes || []);
    modal.style.display = 'flex';
}

function closeBookmarkModal() {
    const modal = document.getElementById('bookmarkModal');
    const noteText = document.getElementById('newNoteText');
    
    if (modal) modal.style.display = 'none';
    if (noteText) noteText.value = '';
    currentBookmark = null;
}

function displayNotes(notes) {
    const notesList = document.getElementById('notesList');
    const notesCount = document.getElementById('notesCount');
    
    if (notesCount) notesCount.textContent = notes.length;
    if (!notesList) return;
    
    if (notes.length === 0) {
        notesList.innerHTML = '<p style="color: #6c757d;">No notes yet.</p>';
        return;
    }
    
    // Sort notes by date DESC (newest first)
    const sortedNotes = [...notes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    notesList.innerHTML = sortedNotes.map(note => `
        <div class="note-item">
            <div class="note-content">
                <div class="note-text">${escapeHtml(note.text)}</div>
                <div class="note-meta">Added ${formatDate(note.created_at)}</div>
            </div>
            <button class="note-delete-btn" data-note-id="${note.created_at}" title="Delete note">
                ✕
            </button>
        </div>
    `).join('');
    
    // Add event listeners for delete buttons using event delegation
    notesList.removeEventListener('click', handleNoteDeleteClick); // Remove existing listener
    notesList.addEventListener('click', handleNoteDeleteClick);
}

// Event handler for note delete clicks
function handleNoteDeleteClick(event) {
    if (event.target.classList.contains('note-delete-btn')) {
        const noteId = event.target.getAttribute('data-note-id');
        if (noteId) {
            handleDeleteNote(noteId);
        }
    }
}

async function handleAddNote() {
    if (!currentBookmark) return;
    
    const noteText = document.getElementById('newNoteText');
    const text = noteText?.value.trim();
    if (!text) return;
    
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'addNoteToBookmark',
            url: currentBookmark.url,
            note: text
        });
        
        if (response?.success) {
            noteText.value = '';
            // Update current bookmark
            if (!currentBookmark.notes) currentBookmark.notes = [];
            currentBookmark.notes.push({
                created_at: new Date().toISOString(),
                text: text
            });
            displayNotes(currentBookmark.notes);
            await loadBookmarks();
            showToast('Note added!', 'success');
            
            // Trigger auto-sync
            triggerAutoSync();
        }
    } catch (error) {
        showToast('Failed to add note', 'error');
    }
}

async function handleDeleteNote(noteId) {
    if (!currentBookmark) return;
    
    if (!confirm('Delete this note?')) return;
    
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'deleteNoteFromBookmark',
            url: currentBookmark.url,
            noteId: noteId
        });
        
        if (response?.success) {
            // Update current bookmark by removing the deleted note
            if (currentBookmark.notes) {
                currentBookmark.notes = currentBookmark.notes.filter(note => note.created_at !== noteId);
            }
            displayNotes(currentBookmark.notes);
            await loadBookmarks();
            showToast('Note deleted!', 'success');
            
            // Trigger auto-sync
            triggerAutoSync();
        }
    } catch (error) {
        showToast('Failed to delete note', 'error');
    }
}

async function handleDeleteBookmark() {
    if (!currentBookmark) return;
    
    if (!confirm(`Delete bookmark for "${currentBookmark.title}"?`)) return;
    
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'deleteBookmark',
            url: currentBookmark.url
        });
        
        if (response?.success) {
            closeBookmarkModal();
            await loadBookmarks();
            showToast('Bookmark deleted!', 'success');
            
            // Trigger auto-sync
            triggerAutoSync();
        }
    } catch (error) {
        showToast('Failed to delete bookmark', 'error');
    }
}

async function handleExport() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'exportBookmarks' });
        if (response?.success) {
            const blob = new Blob([response.data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bookmarkpp-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Exported successfully!', 'success');
        }
    } catch (error) {
        showToast('Export failed', 'error');
    }
}

/**
 * Validate if a bookmark record has required fields
 */
function isValidBookmark(bookmark) {
    // Check if bookmark has the essential fields
    if (!bookmark || typeof bookmark !== 'object') {
        return false;
    }
    
    // Required fields: url, title, and created_at
    const hasUrl = bookmark.url && typeof bookmark.url === 'string' && bookmark.url.trim().length > 0;
    const hasTitle = bookmark.title && typeof bookmark.title === 'string' && bookmark.title.trim().length > 0;
    const hasCreatedAt = bookmark.created_at && typeof bookmark.created_at === 'string' && bookmark.created_at.trim().length > 0;
    
    // Check if URL is valid
    let isValidUrl = false;
    if (hasUrl) {
        try {
            new URL(bookmark.url);
            isValidUrl = true;
        } catch (e) {
            isValidUrl = false;
        }
    }
    
    // Check if created_at is a valid date
    let isValidDate = false;
    if (hasCreatedAt) {
        const date = new Date(bookmark.created_at);
        isValidDate = !isNaN(date.getTime());
    }
    
    return hasUrl && hasTitle && hasCreatedAt && isValidUrl && isValidDate;
}

async function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
        const text = await file.text();
        const importData = JSON.parse(text);
        
        let bookmarksToImport = [];
        let skippedCount = 0;
        
        // Handle different JSON structures
        if (Array.isArray(importData)) {
            // Direct array of bookmarks
            bookmarksToImport = importData;
        } else if (importData.bookmarks && Array.isArray(importData.bookmarks)) {
            // Object with bookmarks array
            bookmarksToImport = importData.bookmarks;
        } else if (typeof importData === 'object') {
            // Domain-based structure - flatten it
            bookmarksToImport = [];
            Object.values(importData).forEach(domainBookmarks => {
                if (Array.isArray(domainBookmarks)) {
                    bookmarksToImport.push(...domainBookmarks);
                }
            });
        }
        
        // Validate and filter bookmarks
        const validBookmarks = [];
        bookmarksToImport.forEach(bookmark => {
            if (isValidBookmark(bookmark)) {
                validBookmarks.push(bookmark);
            } else {
                skippedCount++;
                console.warn('Skipped invalid bookmark:', bookmark);
            }
        });
        
        if (validBookmarks.length === 0) {
            showToast('No valid bookmarks found in the imported file', 'error');
            event.target.value = '';
            return;
        }
        
        // Import valid bookmarks
        for (const bookmark of validBookmarks) {
            await chrome.runtime.sendMessage({
                action: 'saveBookmark',
                bookmarkData: bookmark
            });
        }
        
        await loadBookmarks();
        
        let message = `Successfully imported ${validBookmarks.length} bookmarks`;
        if (skippedCount > 0) {
            message += ` (${skippedCount} invalid records skipped)`;
        }
        showToast(message, 'success');
        
        // Trigger auto-sync
        triggerAutoSync();
        
    } catch (error) {
        console.error('Import error:', error);
        showToast('Import failed: Invalid JSON format', 'error');
    }
    
    event.target.value = '';
}

// UI state management
function showLoadingState() {
    hideAllStates();
    const loading = document.getElementById('loadingState');
    if (loading) loading.style.display = 'block';
}

function showEmptyState() {
    hideAllStates();
    const empty = document.getElementById('emptyState');
    if (empty) empty.style.display = 'block';
}

function showNoResults() {
    hideAllStates();
    const noResults = document.getElementById('noResults');
    if (noResults) noResults.style.display = 'block';
}

function hideAllStates() {
    const states = ['loadingState', 'emptyState', 'bookmarksContainer', 'noResults'];
    states.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
    });
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${type === 'success' ? '✅' : '❌'}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;
    
    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
}

// Utility functions
function updateElement(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
}

function extractDomain(url) {
    try {
        return new URL(url).hostname.replace('www.', '');
    } catch {
        return 'unknown';
    }
}

function formatDate(dateString) {
    const date = new Date(dateString);
    
    // Format as dd/MM/yyyy HH:mm
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Switch between different view modes
 */
function switchView(viewMode) {
    currentView = viewMode;
    
    // Save preference to localStorage
    saveViewPreference(viewMode);
    
    // Update active button
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const activeBtn = document.querySelector(`[data-view="${viewMode}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    
    // Re-display bookmarks with new view
    displayBookmarks();
}

/**
 * Open Notes modal showing all notes from all bookmarks
 */
async function openNotesModal() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getAllBookmarks' });
        const bookmarks = response || [];
        
        // Collect all notes from all bookmarks
        const allNotes = [];
        bookmarks.forEach(bookmark => {
            const domain = extractDomain(bookmark.url);
            if (bookmark.notes && bookmark.notes.length > 0) {
                bookmark.notes.forEach(note => {
                    allNotes.push({
                        ...note,
                        bookmarkTitle: bookmark.title,
                        bookmarkUrl: bookmark.url,
                        domain: domain
                    });
                });
            }
        });
        
        // Sort notes by date DESC (newest first)
        allNotes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        const notesModal = document.getElementById('notesModal');
        const notesContainer = document.getElementById('notesContainer');
        const notesStats = document.getElementById('notesStats');
        const noNotesMessage = document.getElementById('noNotesMessage');
        
        // Update stats
        if (notesStats) {
            const notesCount = allNotes.length;
            notesStats.querySelector('.notes-count').textContent = 
                `${notesCount} note${notesCount !== 1 ? 's' : ''} found`;
        }
        
        if (notesContainer && noNotesMessage) {
            if (allNotes.length === 0) {
                notesContainer.style.display = 'none';
                noNotesMessage.style.display = 'block';
            } else {
                notesContainer.style.display = 'flex';
                noNotesMessage.style.display = 'none';
                
                // Generate notes HTML
                notesContainer.innerHTML = allNotes.map(note => createNoteItem(note)).join('');
                
                // Add event delegation for note actions
                notesContainer.removeEventListener('click', handleNotesModalClick);
                notesContainer.addEventListener('click', handleNotesModalClick);
            }
        }
        
        if (notesModal) {
            notesModal.style.display = 'flex';
        }
    } catch (error) {
        console.error('Error loading notes:', error);
        showToast('Failed to load notes', 'error');
    }
}

// Event handler for notes modal clicks
function handleNotesModalClick(event) {
    const target = event.target;
    
    if (target.classList.contains('copy-note-btn')) {
        const noteText = target.getAttribute('data-note-text');
        if (noteText) {
            copyNoteText(noteText);
        }
    } else if (target.classList.contains('open-bookmark-btn')) {
        const bookmarkUrl = target.getAttribute('data-bookmark-url');
        if (bookmarkUrl) {
            openBookmarkFromNote(bookmarkUrl);
        }
    } else if (target.classList.contains('delete-note-btn')) {
        const bookmarkUrl = target.getAttribute('data-bookmark-url');
        const noteId = target.getAttribute('data-note-id');
        if (bookmarkUrl && noteId) {
            handleDeleteNoteFromModal(bookmarkUrl, noteId);
        }
    }
}

/**
 * Close the Notes modal
 */
function handleCloseNotesModal() {
    const notesModal = document.getElementById('notesModal');
    if (notesModal) notesModal.style.display = 'none';
}

/**
 * Create HTML for a note item
 */
function createNoteItem(note) {
    const formattedDate = formatDate(note.created_at);
    
    return `
        <div class="note-item-full">
            <div class="note-header">
                <div class="note-bookmark-info">
                    <div class="note-bookmark-title">${escapeHtml(note.bookmarkTitle)}</div>
                    <a href="${note.bookmarkUrl}" class="note-bookmark-url" target="_blank">${note.bookmarkUrl}</a>
                </div>
                <div class="note-domain-badge">${note.domain}</div>
            </div>
            
            <div class="note-text-full">${escapeHtml(note.text)}</div>
            
            <div class="note-meta-full">
                <div class="note-date">📅 ${formattedDate}</div>
                <div class="note-actions">
                    <button class="note-action-btn copy-note-btn" data-note-text="${escapeHtml(note.text)}" title="Copy note">
                        📋
                    </button>
                    <button class="note-action-btn open-bookmark-btn" data-bookmark-url="${note.bookmarkUrl}" title="View bookmark">
                        🔗
                    </button>
                    <button class="note-action-btn delete-note-btn" data-bookmark-url="${note.bookmarkUrl}" data-note-id="${note.created_at}" title="Delete note">
                        🗑️
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Copy note text to clipboard
 */
async function copyNoteText(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Note copied to clipboard!', 'success');
    } catch (error) {
        console.error('Failed to copy note:', error);
        showToast('Failed to copy note', 'error');
    }
}

/**
 * Open bookmark from note view
 */
function openBookmarkFromNote(url) {
    window.open(url, '_blank');
}

/**
 * Delete note from All Notes modal
 */
async function handleDeleteNoteFromModal(bookmarkUrl, noteId) {
    if (!confirm('Delete this note?')) return;
    
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'deleteNoteFromBookmark',
            url: bookmarkUrl,
            noteId: noteId
        });
        
        if (response?.success) {
            // Refresh the All Notes modal
            await openNotesModal();
            await loadBookmarks(); // Also refresh the main bookmarks view
            showToast('Note deleted!', 'success');
            
            // Trigger auto-sync
            triggerAutoSync();
        }
    } catch (error) {
        showToast('Failed to delete note', 'error');
    }
}

// Pocket Import Functionality
let importCancelled = false;
let isImportInProgress = false; // Flag to prevent auto-sync during import

/**
 * Handle Pocket CSV import
 */
async function handlePocketImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.name.toLowerCase().endsWith('.csv')) {
        showToast('Please select a CSV file', 'error');
        event.target.value = '';
        return;
    }
    
    try {
        isImportInProgress = true; // Disable auto-sync during import
        const text = await file.text();
        const bookmarks = parsePocketCSV(text);
        
        if (bookmarks.length === 0) {
            showToast('No valid bookmarks found in CSV file', 'error');
            event.target.value = '';
            isImportInProgress = false;
            return;
        }
        
        showImportProgressModal();
        showDataPreview(bookmarks.slice(0, 3)); // Show first 3 items as preview
        await processPocketBookmarks(bookmarks);
        
    } catch (error) {
        console.error('Error importing Pocket data:', error);
        showToast('Failed to import Pocket data: ' + error.message, 'error');
        closeImportProgressModal();
        isImportInProgress = false;
    }
    
    event.target.value = '';
}

/**
 * Parse Pocket CSV data
 */
function parsePocketCSV(csvText) {
    const lines = csvText.split('\n');
    if (lines.length < 2) return [];
    
    // Parse header to find column indices
    const header = lines[0].split(',').map(col => col.trim().toLowerCase().replace(/"/g, ''));
    const titleIndex = header.indexOf('title');
    const urlIndex = header.indexOf('url');
    const timeIndex = header.indexOf('time_added');
    
    if (titleIndex === -1 || urlIndex === -1 || timeIndex === -1) {
        throw new Error('CSV must contain title, url, and time_added columns');
    }
    
    const bookmarks = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Simple CSV parsing (handles basic cases)
        const columns = parseCSVLine(line);
        
        if (columns.length > Math.max(titleIndex, urlIndex, timeIndex)) {
            const title = cleanCSVValue(columns[titleIndex]);
            const url = cleanCSVValue(columns[urlIndex]);
            const timeAdded = cleanCSVValue(columns[timeIndex]);
            
            if (title && url && isValidUrl(url)) {
                bookmarks.push({
                    title,
                    url,
                    time_added: timeAdded
                });
            }
        }
    }
    
    return bookmarks;
}

/**
 * Simple CSV line parser
 */
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current);
    return result;
}

/**
 * Clean CSV value
 */
function cleanCSVValue(value) {
    return value.replace(/^"(.*)"$/, '$1').trim();
}

/**
 * Validate URL
 */
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Show data preview in the modal
 */
function showDataPreview(sampleBookmarks) {
    const previewContainer = document.getElementById('previewSample');
    const importPreview = document.getElementById('importPreview');
    
    if (!previewContainer || !importPreview) return;
    
    previewContainer.innerHTML = sampleBookmarks.map(bookmark => `
        <div class="preview-item">
            <div class="preview-item-title">${escapeHtml(bookmark.title)}</div>
            <div class="preview-item-url">${bookmark.url}</div>
            <div class="preview-item-date">Date: ${formatPocketDate(bookmark.time_added)}</div>
        </div>
    `).join('');
    
    importPreview.style.display = 'block';
}

/**
 * Format Pocket timestamp for display
 */
function formatPocketDate(timestamp) {
    if (!timestamp) return 'Unknown';
    const date = new Date(parseInt(timestamp) * 1000);
    
    // Format as dd/MM/yyyy HH:mm
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/**
 * Process Pocket bookmarks with fetch-based metadata fetching
 */
async function processPocketBookmarks(bookmarks) {
    importCancelled = false;
    
    updateProgress(0, bookmarks.length, 'Starting import...');
    
    const stats = {
        success: 0,
        error: 0,
        skip: 0
    };

    // Check for existing bookmarks first
    const existingBookmarks = await chrome.runtime.sendMessage({ action: 'getAllBookmarks' });
    const existingUrls = new Set(existingBookmarks.map(b => b.url));

    // Filter out existing bookmarks
    const newBookmarks = bookmarks.filter(bookmark => {
        if (existingUrls.has(bookmark.url)) {
            stats.skip++;
            return false;
        }
        return true;
    });

    updateImportStats(stats);
    updateProgress(0, bookmarks.length, `Processing ${newBookmarks.length} new bookmarks...`);

    // Process bookmarks in parallel batches
    const BATCH_SIZE = 5; // Process 5 URLs concurrently
    const batches = [];
    
    for (let i = 0; i < newBookmarks.length; i += BATCH_SIZE) {
        batches.push(newBookmarks.slice(i, i + BATCH_SIZE));
    }

    let processedCount = 0;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        if (importCancelled) {
            updateProgressStatus('Import cancelled');
            break;
        }

        const batch = batches[batchIndex];
        updateProgress(processedCount + stats.skip, bookmarks.length, 
            `Processing batch ${batchIndex + 1}/${batches.length}...`);

        // Process batch in parallel
        const batchPromises = batch.map(async (bookmark) => {
            try {
                // Fetch metadata using direct fetch
                const metadata = await fetchMetadataWithFetch(bookmark.url);
                
                // Create bookmark object with proper timestamp conversion
                const bookmarkData = {
                    url: bookmark.url,
                    title: bookmark.title,
                    description: metadata.description || '',
                    favicon: metadata.favicon || '',
                    ogImage: metadata.ogImage || '',
                    notes: [],
                    created_at: convertPocketTimestamp(bookmark.time_added) // Using time_added for created_at
                };
                
                // Save bookmark
                const result = await chrome.runtime.sendMessage({
                    action: 'saveBookmark',
                    bookmarkData
                });

                if (result?.success) {
                    return { success: true };
                } else {
                    console.error('Failed to save bookmark:', bookmark.url, result?.error);
                    return { success: false, error: result?.error || 'Save failed' };
                }
                
            } catch (error) {
                console.error('Error processing bookmark:', bookmark.url, error);
                return { success: false, error: error.message };
            }
        });

        // Wait for batch to complete
        const batchResults = await Promise.all(batchPromises);
        
        // Update stats
        batchResults.forEach(result => {
            if (result.success) {
                stats.success++;
            } else {
                stats.error++;
            }
        });

        processedCount += batch.length;
        updateImportStats(stats);
        updateProgress(processedCount + stats.skip, bookmarks.length, 
            `Processed ${processedCount} bookmarks...`);

        // Small delay between batches to prevent overwhelming
        if (batchIndex < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    
    updateProgress(bookmarks.length, bookmarks.length, 
        importCancelled ? 'Import cancelled' : 'Import completed!');
    
    // Show completion
    document.getElementById('cancelImportBtn').style.display = 'none';
    document.getElementById('closeImportBtn').style.display = 'inline-flex';
    
    if (!importCancelled) {
        await loadBookmarks();
        showToast(`Import completed! ${stats.success} bookmarks imported`, 'success');
        
        // Reset import flag and trigger auto-sync once with all imported bookmarks
        isImportInProgress = false;
        if (stats.success > 0) {
            triggerAutoSync();
        }
    } else {
        // Reset import flag even if cancelled
        isImportInProgress = false;
    }
}

/**
 * Fetch metadata from URL using direct fetch (no tabs)
 */
async function fetchMetadataWithFetch(url) {
    try {
        // Set a timeout for the fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; BookmarkPp/1.0)',
            },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const html = await response.text();
        const metadata = parseHTMLMetadata(html, url);
        
        return metadata;
        
    } catch (error) {
        console.error('Error fetching metadata for:', url, error.message);
        return {
            title: '',
            description: '',
            favicon: '',
            ogImage: ''
        };
    }
}

/**
 * Parse HTML content to extract metadata
 */
function parseHTMLMetadata(html, baseUrl) {
    try {
        // Create a temporary DOM to parse HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Extract description
        const descriptionMeta = doc.querySelector('meta[name="description"]') || 
                               doc.querySelector('meta[property="og:description"]');
        const description = descriptionMeta ? descriptionMeta.getAttribute('content') || '' : '';
        
        // Extract favicon
        let favicon = '';
        const faviconLink = doc.querySelector('link[rel="icon"]') || 
                           doc.querySelector('link[rel="shortcut icon"]') || 
                           doc.querySelector('link[rel="apple-touch-icon"]');
        if (faviconLink) {
            favicon = faviconLink.getAttribute('href') || '';
            // Convert relative URLs to absolute
            if (favicon && !favicon.startsWith('http')) {
                try {
                    favicon = new URL(favicon, baseUrl).href;
                } catch (e) {
                    favicon = '';
                }
            }
        }
        
        // Extract Open Graph image
        const ogImageMeta = doc.querySelector('meta[property="og:image"]');
        let ogImage = ogImageMeta ? ogImageMeta.getAttribute('content') || '' : '';
        // Convert relative URLs to absolute
        if (ogImage && !ogImage.startsWith('http')) {
            try {
                ogImage = new URL(ogImage, baseUrl).href;
            } catch (e) {
                ogImage = '';
            }
        }
        
        return {
            description,
            favicon,
            ogImage
        };
    } catch (error) {
        console.error('Error parsing HTML metadata:', error);
        return {
            description: '',
            favicon: '',
            ogImage: ''
        };
    }
}

/**
 * Convert Pocket timestamp to ISO string
 */
function convertPocketTimestamp(timestamp) {
    if (!timestamp) return new Date().toISOString();
    
    // Pocket timestamps are Unix timestamps
    const date = new Date(parseInt(timestamp) * 1000);
    return date.toISOString();
}

/**
 * Update progress bar and status
 */
function updateProgress(current, total, status) {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    
    document.getElementById('progressBarFill').style.width = `${percentage}%`;
    document.getElementById('progressText').textContent = `${percentage}%`;
    document.getElementById('progressStatus').textContent = status;
    document.getElementById('progressDetails').textContent = `${current} of ${total} processed`;
}

/**
 * Update import statistics
 */
function updateImportStats(stats) {
    document.getElementById('successCount').textContent = stats.success;
    document.getElementById('errorCount').textContent = stats.error;
    document.getElementById('skipCount').textContent = stats.skip;
    document.getElementById('importStats').style.display = 'block';
}

/**
 * Update progress status text
 */
function updateProgressStatus(status) {
    document.getElementById('progressStatus').textContent = status;
}

/**
 * Show import progress modal
 */
function showImportProgressModal() {
    // Reset modal state
    document.getElementById('progressBarFill').style.width = '0%';
    document.getElementById('progressText').textContent = '0%';
    document.getElementById('progressStatus').textContent = 'Preparing import...';
    document.getElementById('progressDetails').textContent = '0 of 0 processed';
    document.getElementById('importStats').style.display = 'none';
    document.getElementById('importPreview').style.display = 'none';
    document.getElementById('cancelImportBtn').style.display = 'inline-flex';
    document.getElementById('closeImportBtn').style.display = 'none';
    
    // Reset stats
    document.getElementById('successCount').textContent = '0';
    document.getElementById('errorCount').textContent = '0';
    document.getElementById('skipCount').textContent = '0';
    
    document.getElementById('importProgressModal').style.display = 'flex';
}

/**
 * Close import progress modal
 */
function closeImportProgressModal() {
    document.getElementById('importProgressModal').style.display = 'none';
    importCancelled = false;
}

/**
 * Cancel Pocket import
 */
function cancelPocketImport() {
    importCancelled = true;
    isImportInProgress = false; // Reset import flag
    updateProgressStatus('Cancelling import...');
}

// Infinite scroll
function handleScroll() {
    if (isLoadingMore || !hasMoreItems) return;
    
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollPosition = window.scrollY;
    const scrollThreshold = documentHeight - windowHeight - 100; // 100px before bottom
    
    if (scrollPosition >= scrollThreshold && hasMoreItems) {
        loadMoreBookmarks();
    }
}

function loadMoreBookmarks() {
    if (isLoadingMore || !hasMoreItems) return;
    
    isLoadingMore = true;
    currentPage++;
    
    showLoadingMoreIndicator();
    
    displayBookmarks(true) // true for append mode
        .then(() => {
            isLoadingMore = false;
            hideLoadingMoreIndicator();
        })
        .catch(() => {
            isLoadingMore = false;
            currentPage--; // Reset on error
            hideLoadingMoreIndicator();
        });
}

function showLoadingMoreIndicator() {
    const bookmarksContainer = document.getElementById('bookmarksContainer');
    if (!bookmarksContainer) return;
    
    // Remove existing indicator
    const existing = document.getElementById('loadingMore');
    if (existing) existing.remove();
    
    // Add new indicator
    const indicator = document.createElement('div');
    indicator.id = 'loadingMore';
    indicator.className = 'loading-more';
    indicator.innerHTML = `
        <div class="loading-spinner"></div>
        Loading more bookmarks...
    `;
    
    bookmarksContainer.appendChild(indicator);
}

function hideLoadingMoreIndicator() {
    const indicator = document.getElementById('loadingMore');
    if (indicator) {
        indicator.remove();
    }
}

function resetPagination() {
    currentPage = 0;
    hasMoreItems = true;
    isLoadingMore = false;
}

/**
 * Auto-Sync Functions
 */
async function isAutoSyncEnabled() {
    try {
        const result = await chrome.storage.local.get(['auto_sync_enabled']);
        return result.auto_sync_enabled !== false; // Default to true
    } catch (error) {
        console.error('Error checking auto-sync setting:', error);
        return false;
    }
}

async function triggerAutoSync() {
    // Skip auto-sync if import is in progress
    if (isImportInProgress) {
        console.log('Auto-sync skipped: Import in progress');
        return;
    }
    
    // Check if auto-sync is enabled and user is connected to GitHub
    const autoSyncEnabled = await isAutoSyncEnabled();
    if (!autoSyncEnabled || !githubSync.isAuthenticated()) {
        return;
    }
    
    // Clear any existing timeout
    if (autoSyncTimeout) {
        clearTimeout(autoSyncTimeout);
    }
    
    // Set a new timeout to debounce rapid changes
    autoSyncTimeout = setTimeout(async () => {
        try {
            console.log('Auto-sync triggered by data change');
            
            const bookmarkData = {
                bookmarks: allBookmarks,
                exported_at: new Date().toISOString(),
                version: '1.0'
            };
            
            const result = await githubSync.saveBookmarks(bookmarkData);
            
            if (result.success) {
                // Save last sync time
                await chrome.storage.local.set({ last_sync_time: new Date().toISOString() });
                
                // Show a subtle notification
                showToast(`Auto-synced ${allBookmarks.length} bookmarks to GitHub`, 'success');
                
                // Update sync status if settings modal is open
                const settingsModal = document.getElementById('settingsModal');
                if (settingsModal && settingsModal.style.display === 'flex') {
                    updateSyncStatus();
                }
            }
        } catch (error) {
            console.error('Auto-sync failed:', error);
            // Don't show error toast for auto-sync to avoid spam
        }
    }, AUTO_SYNC_DELAY);
}

/**
 * Settings Modal Functions
 */
async function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    
    // Initialize GitHub sync
    await githubSync.init();
    
    // Update sync status
    updateSyncStatus();
    
    // Load settings
    loadSettings();
    
    // Update statistics
    updateSettingsStats();
    
    modal.style.display = 'flex';
}

function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'none';
}

function updateSyncStatus() {
    const syncNotConnected = document.getElementById('syncNotConnected');
    const syncConnected = document.getElementById('syncConnected');
    const syncInProgress = document.getElementById('syncInProgress');
    
    // Hide all status divs first
    if (syncNotConnected) syncNotConnected.style.display = 'none';
    if (syncConnected) syncConnected.style.display = 'none';
    if (syncInProgress) syncInProgress.style.display = 'none';
    
    if (githubSync.isAuthenticated()) {
        if (syncConnected) {
            syncConnected.style.display = 'flex';
            
            // Update GitHub user info
            githubSync.getUserInfo().then(userInfo => {
                const usernameEl = document.getElementById('githubUsername');
                if (usernameEl) usernameEl.textContent = userInfo.login;
            }).catch(console.error);
            
            // Update gist info
            const gistIdEl = document.getElementById('githubGistId');
            const status = githubSync.getSyncStatus();
            if (gistIdEl) {
                gistIdEl.textContent = status.hasGist ? status.gistId : 'Not created yet';
            }
            
            // Update last sync time
            updateLastSyncTime();
        }
    } else {
        if (syncNotConnected) syncNotConnected.style.display = 'flex';
    }
}

async function updateLastSyncTime() {
    try {
        const result = await chrome.storage.local.get(['last_sync_time']);
        const lastSyncEl = document.getElementById('lastSyncTime');
        if (lastSyncEl) {
            if (result.last_sync_time) {
                lastSyncEl.textContent = `Last sync: ${formatDate(result.last_sync_time)}`;
            } else {
                lastSyncEl.textContent = 'Last sync: Never';
            }
        }
    } catch (error) {
        console.error('Error getting last sync time:', error);
    }
}

function loadSettings() {
    // Load current view preference
    const defaultViewSelect = document.getElementById('defaultView');
    if (defaultViewSelect) {
        defaultViewSelect.value = currentView;
    }
    
    // Load items per page
    const itemsPerPageSelect = document.getElementById('itemsPerPage');
    if (itemsPerPageSelect) {
        itemsPerPageSelect.value = getItemsPerPage().toString();
    }
    
    // Load auto-sync setting (default to enabled)
    chrome.storage.local.get(['auto_sync_enabled']).then(result => {
        const autoSyncCheck = document.getElementById('autoSync');
        if (autoSyncCheck) {
            // Default to enabled if not set
            const isEnabled = result.auto_sync_enabled !== false;
            autoSyncCheck.checked = isEnabled;
            
            // Save the default if not already saved
            if (result.auto_sync_enabled === undefined) {
                chrome.storage.local.set({ auto_sync_enabled: true });
            }
        }
    });
    
    // Load open on click preference
    const openOnClickCheck = document.getElementById('openOnClick');
    if (openOnClickCheck) {
        openOnClickCheck.checked = getOpenOnClickPreference();
    }
    
    // Load keyboard shortcuts
    loadKeyboardShortcuts().then(shortcut => {
        const dashboardInput = document.getElementById('dashboardShortcut');
        
        if (dashboardInput && shortcut) {
            dashboardInput.value = formatKeyCombo(shortcut);
        }
    });
}

function updateSettingsStats() {
    // Update bookmark count
    const statsBookmarks = document.getElementById('statsBookmarks');
    if (statsBookmarks) statsBookmarks.textContent = allBookmarks.length.toString();
    
    // Update domain count
    const domains = new Set(allBookmarks.map(b => extractDomain(b.url)));
    const statsDomains = document.getElementById('statsDomains');
    if (statsDomains) statsDomains.textContent = domains.size.toString();
    
    // Update notes count
    const totalNotes = allBookmarks.reduce((sum, bookmark) => {
        return sum + (Array.isArray(bookmark.notes) ? bookmark.notes.length : 0);
    }, 0);
    const statsNotes = document.getElementById('statsNotes');
    if (statsNotes) statsNotes.textContent = totalNotes.toString();
    
    // Estimate storage used
    const dataSize = JSON.stringify(allBookmarks).length;
    const sizeKB = Math.round(dataSize / 1024);
    const statsStorage = document.getElementById('statsStorage');
    if (statsStorage) statsStorage.textContent = `${sizeKB} KB`;
}

/**
 * GitHub Sync Handlers
 */
async function handleConnectGitHub() {
    try {
        showSyncInProgress('Connecting to GitHub...');
        await githubSync.authenticate();
        updateSyncStatus();
        showToast('Successfully connected to GitHub!', 'success');
    } catch (error) {
        console.error('GitHub connection failed:', error);
        showToast(error.message || 'Failed to connect to GitHub', 'error');
        updateSyncStatus(); // Reset status on error
    }
}

async function handleDisconnectGitHub() {
    if (confirm('Are you sure you want to disconnect from GitHub? This will stop syncing your bookmarks.')) {
        try {
            await githubSync.clearAuth();
            updateSyncStatus();
            showToast('Disconnected from GitHub', 'info');
        } catch (error) {
            console.error('Error disconnecting:', error);
            showToast('Error disconnecting from GitHub', 'error');
        }
    }
}

async function handleSyncUp() {
    if (!githubSync.isAuthenticated()) {
        showToast('Please connect to GitHub first', 'warning');
        return;
    }
    
    try {
        showSyncInProgress('Uploading bookmarks to GitHub...');
        
        const bookmarkData = {
            bookmarks: allBookmarks,
            exported_at: new Date().toISOString(),
            version: '1.0'
        };
        
        const result = await githubSync.saveBookmarks(bookmarkData);
        
        if (result.success) {
            // Save last sync time
            await chrome.storage.local.set({ last_sync_time: new Date().toISOString() });
            
            updateSyncStatus();
            showToast(`Successfully uploaded ${allBookmarks.length} bookmarks to GitHub!`, 'success');
        }
    } catch (error) {
        console.error('Sync up failed:', error);
        showToast(error.message || 'Failed to upload bookmarks', 'error');
        updateSyncStatus();
    }
}

async function handleSyncDown() {
    if (!githubSync.isAuthenticated()) {
        showToast('Please connect to GitHub first', 'warning');
        return;
    }
    
    if (!confirm('This will replace your current bookmarks with data from GitHub. Are you sure?')) {
        return;
    }
    
    try {
        showSyncInProgress('Downloading bookmarks from GitHub...');
        
        const result = await githubSync.loadBookmarks();
        
        if (result.success && result.data && result.data.bookmarks) {
            // Save bookmarks to local storage
            for (const bookmark of result.data.bookmarks) {
                await chrome.runtime.sendMessage({
                    action: 'saveBookmark',
                    bookmark: bookmark
                });
            }
            
            // Save last sync time
            await chrome.storage.local.set({ last_sync_time: new Date().toISOString() });
            
            // Reload bookmarks
            await loadBookmarks();
            
            updateSyncStatus();
            showToast(`Successfully downloaded ${result.data.bookmarks.length} bookmarks from GitHub!`, 'success');
        }
    } catch (error) {
        console.error('Sync down failed:', error);
        showToast(error.message || 'Failed to download bookmarks', 'error');
        updateSyncStatus();
    }
}

function showSyncInProgress(message) {
    const syncNotConnected = document.getElementById('syncNotConnected');
    const syncConnected = document.getElementById('syncConnected');
    const syncInProgress = document.getElementById('syncInProgress');
    const syncProgressText = document.getElementById('syncProgressText');
    
    // Hide other states
    if (syncNotConnected) syncNotConnected.style.display = 'none';
    if (syncConnected) syncConnected.style.display = 'none';
    
    // Show progress state
    if (syncInProgress) {
        syncInProgress.style.display = 'flex';
        if (syncProgressText) syncProgressText.textContent = message;
    }
}

/**
 * Settings Handlers
 */
function handleDefaultViewChange(event) {
    const newView = event.target.value;
    switchView(newView);
}

function handleItemsPerPageChange(event) {
    const newItemsPerPage = parseInt(event.target.value);
    
    // Save the setting to localStorage
    saveItemsPerPage(newItemsPerPage);
    
    // Reset pagination to show the effect
    resetPagination();
    
    // Re-display bookmarks with new pagination
    displayBookmarks();
    
    showToast(`Items per page updated to ${newItemsPerPage}`, 'success');
}

async function handleAutoSyncChange(event) {
    const enabled = event.target.checked;
    try {
        await chrome.storage.local.set({ auto_sync_enabled: enabled });
        showToast(`Auto-sync ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (error) {
        console.error('Error saving auto-sync setting:', error);
        showToast('Error saving setting', 'error');
    }
}

function handleOpenOnClickChange(event) {
    const enabled = event.target.checked;
    saveOpenOnClickPreference(enabled);
    showToast(
        enabled 
            ? 'Cards will now open bookmarks directly' 
            : 'Cards will now show details modal', 
        'success'
    );
}

async function handleClearAllData() {
    const confirmed = confirm(
        'This will permanently delete ALL your bookmarks and notes. This action cannot be undone.\n\n' +
        'Are you absolutely sure you want to continue?'
    );
    
    if (!confirmed) return;
    
    const doubleConfirm = confirm(
        'Last chance: This will delete everything. Type "DELETE" in the next dialog to confirm.'
    );
    
    if (!doubleConfirm) return;
    
    const finalConfirm = prompt('Type "DELETE" to confirm:');
    if (finalConfirm !== 'DELETE') {
        showToast('Data deletion cancelled', 'info');
        return;
    }
    
    try {
        // Clear all bookmarks
        await chrome.runtime.sendMessage({ action: 'clearAllBookmarks' });
        
        // Clear sync data
        await githubSync.clearAuth();
        
        // Clear local settings
        await chrome.storage.local.clear();
        
        // Refresh the UI
        allBookmarks = [];
        filteredBookmarks = [];
        await loadBookmarks();
        updateSyncStatus();
        
        showToast('All data has been cleared', 'success');
        closeSettingsModal();
    } catch (error) {
        console.error('Error clearing data:', error);
        showToast('Error clearing data', 'error');
    }
} 