/**
 * BookmarkPp Content Script
 * Extracts page metadata and handles communication with background script
 */

// Store keyboard shortcut
let dashboardShortcut = null;

// Load keyboard shortcut on initialization
async function initKeyboardShortcut() {
    try {
        const result = await chrome.storage.local.get(['dashboard_shortcut']);
        if (result.dashboard_shortcut) {
            dashboardShortcut = result.dashboard_shortcut;
        }
    } catch (error) {
        console.error('Error loading keyboard shortcut:', error);
    }
}

// Initialize shortcut when content script loads
initKeyboardShortcut();

/**
 * Check if a key event matches a stored shortcut
 */
function matchesShortcut(event, shortcut) {
    if (!shortcut) return false;
    
    return event.metaKey === shortcut.Meta &&
           event.ctrlKey === shortcut.Control &&
           event.altKey === shortcut.Alt &&
           event.shiftKey === shortcut.Shift &&
           event.key.toLowerCase() === shortcut.key.toLowerCase();
}

/**
 * Handle keyboard shortcuts
 */
document.addEventListener('keydown', async (event) => {
    // Check dashboard shortcut
    if (matchesShortcut(event, dashboardShortcut)) {
        event.preventDefault();
        event.stopPropagation();
        
        // Open dashboard in new tab
        try {
            await chrome.runtime.sendMessage({ action: 'openDashboard' });
        } catch (error) {
            console.error('Error opening dashboard:', error);
        }
        return;
    }
});

/**
 * Listen for shortcut updates from dashboard
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateKeyboardShortcuts') {
        dashboardShortcut = message.shortcut || null;
        sendResponse({ success: true });
    }
    
    // Existing message handlers...
    if (message.action === 'getPageMetadata') {
        const metadata = extractPageMetadata();
        sendResponse(metadata);
    }
    
    if (message.action === 'showNotification') {
        showNotification(message.message, message.type);
        sendResponse({ success: true });
    }
});

/**
 * Show notification on page
 */
function showNotification(message, type = 'info') {
    // Remove existing notification
    const existing = document.getElementById('bookmarkpp-notification');
    if (existing) {
        existing.remove();
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.id = 'bookmarkpp-notification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? '#dc3545' : type === 'warning' ? '#ffc107' : '#28a745'};
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        z-index: 999999;
        max-width: 300px;
        word-wrap: break-word;
        opacity: 0;
        transform: translateX(100%);
        transition: all 0.3s ease;
    `;
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Animate in
    requestAnimationFrame(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateX(0)';
    });
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }
    }, 3000);
}

/**
 * Extract page metadata for bookmarking
 */
function extractPageMetadata() {
    const title = document.title || '';
    
    // Extract description
    const descriptionMeta = document.querySelector('meta[name="description"]') || 
                           document.querySelector('meta[property="og:description"]');
    const description = descriptionMeta ? descriptionMeta.getAttribute('content') || '' : '';
    
    // Extract favicon
    let favicon = '';
    const faviconLink = document.querySelector('link[rel="icon"]') || 
                       document.querySelector('link[rel="shortcut icon"]') || 
                       document.querySelector('link[rel="apple-touch-icon"]');
    if (faviconLink) {
        favicon = faviconLink.getAttribute('href') || '';
        // Convert relative URLs to absolute
        if (favicon && !favicon.startsWith('http')) {
            favicon = new URL(favicon, window.location.origin).href;
        }
    }
    
    // Extract Open Graph image
    const ogImageMeta = document.querySelector('meta[property="og:image"]');
    let ogImage = ogImageMeta ? ogImageMeta.getAttribute('content') || '' : '';
    // Convert relative URLs to absolute
    if (ogImage && !ogImage.startsWith('http')) {
        ogImage = new URL(ogImage, window.location.origin).href;
    }
    
    return {
        title,
        description,
        favicon,
        ogImage
    };
}

/**
 * Extract page metadata including title, description, and favicon
 */
function getPageMetadata() {
    const metadata = {
        title: '',
        description: '',
        favicon: '',
        ogImage: ''
    };

    // Ensure document is ready
    if (document.readyState === 'loading') {
        return metadata; // Return empty metadata if document not ready
    }

    // Get page title
    metadata.title = document.title || '';

    // Get page description from meta tags
    const descriptionMeta = document.querySelector('meta[name="description"]') ||
                          document.querySelector('meta[property="og:description"]') ||
                          document.querySelector('meta[name="twitter:description"]');
    
    if (descriptionMeta) {
        metadata.description = descriptionMeta.getAttribute('content') || '';
    }

    // Get Open Graph image
    const ogImageMeta = document.querySelector('meta[property="og:image"]');
    if (ogImageMeta) {
        const ogImageUrl = ogImageMeta.getAttribute('content');
        if (ogImageUrl) {
            // Convert relative URLs to absolute URLs
            try {
                metadata.ogImage = new URL(ogImageUrl, window.location.href).href;
            } catch (error) {
                console.error('BookmarkPp: Error resolving og:image URL:', error);
                metadata.ogImage = ogImageUrl; // Use as-is if URL parsing fails
            }
        }
    }

    // Get favicon URL
    metadata.favicon = getFaviconUrl();

    return metadata;
}

/**
 * Get the favicon URL for the current page
 */
function getFaviconUrl() {
    // Try different favicon selectors in order of preference
    const faviconSelectors = [
        'link[rel="icon"]',
        'link[rel="shortcut icon"]', 
        'link[rel="apple-touch-icon"]',
        'link[rel="apple-touch-icon-precomposed"]'
    ];

    for (const selector of faviconSelectors) {
        const favicon = document.querySelector(selector);
        if (favicon) {
            const href = favicon.getAttribute('href');
            if (href) {
                // Convert relative URLs to absolute URLs
                return new URL(href, window.location.href).href;
            }
        }
    }

    // Fallback to default favicon location
    return new URL('/favicon.ico', window.location.origin).href;
}

/**
 * Get the currently selected text on the page
 */
function getSelectedText() {
    return window.getSelection().toString().trim();
}

/**
 * Highlight text temporarily (for visual feedback)
 */
function highlightText(text) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const span = document.createElement('span');
        span.style.backgroundColor = '#007bff';
        span.style.color = 'white';
        span.style.padding = '2px 4px';
        span.style.borderRadius = '3px';
        span.style.transition = 'all 0.3s ease';
        
        try {
            range.surroundContents(span);
            
            // Remove highlight after 2 seconds
            setTimeout(() => {
                if (span.parentNode) {
                    const parent = span.parentNode;
                    parent.insertBefore(document.createTextNode(span.textContent), span);
                    parent.removeChild(span);
                }
            }, 2000);
        } catch (error) {
            // If surroundContents fails (e.g., selection spans multiple elements)
            console.log('Could not highlight selection');
        }
    }
}

/**
 * Initialize content script
 */
(() => {
    console.log('BookmarkPp content script loaded');
    
    // Pre-load page metadata for faster access
    const metadata = getPageMetadata();
    // console.log('Page metadata extracted:', metadata);
})(); 