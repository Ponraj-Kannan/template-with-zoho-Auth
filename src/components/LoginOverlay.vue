<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watchEffect, watch } from 'vue'
import { authState, logout } from '../auth'

const ADMIN_EMAILS = [
  'ponrajacc@gmail.com',
  'gunatamil123@gmail.com',
  'learning@faceprep.in'
]

// ── Zoho OAuth configuration ─────────────────────────────────────────────────
// The Client ID is public (safe to embed). Client Secret stays server-side.
const ZOHO_CLIENT_ID = import.meta.env.VITE_ZOHO_CLIENT_ID || ''
const ZOHO_ACCOUNTS_DOMAIN = import.meta.env.VITE_ZOHO_ACCOUNTS_DOMAIN || 'https://accounts.zoho.com'

const isZohoLoading = ref(false)
// Plain variable (NOT a ref) — storing a cross-origin Window in ref() causes a SecurityError
// because Vue's reactivity tries to read properties from the popup after it navigates to Zoho
let zohoPopupWindow = null

const SUPER_ADMIN = 'ponrajacc@gmail.com'

// Sync auth state with DOM body/html classes to hide/show slides securely.
// Use watch() with flush:'post' so the DOM class update runs AFTER Slidev's
// own watchers (including updateSharedState) have already initialised nav.current.
// This prevents the "Cannot read properties of undefined (reading 'current')" error
// that occurred when watchEffect fired synchronously during Slidev's bootstrap.
watch(
  () => authState.isLoggedIn,
  (isLoggedIn) => {
    if (typeof document !== 'undefined') {
      if (isLoggedIn) {
        document.documentElement.classList.add('auth-success')
      } else {
        document.documentElement.classList.remove('auth-success')
      }
    }
  },
  { flush: 'post', immediate: true }
)

// Fullscreen helpers
function enterFullscreen() {
  const el = document.documentElement
  if (el.requestFullscreen) el.requestFullscreen()
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen()
  else if (el.mozRequestFullScreen) el.mozRequestFullScreen()
  else if (el.msRequestFullscreen) el.msRequestFullscreen()
}

const showFullscreenPrompt = ref(false)

const errorMessage = ref('')
const successMessage = ref('')
const newEmail = ref('')
const isLoading = ref(false)
const isPageLoading = ref(true)
const searchQuery = ref('')

// Real-time email parser for auto-separation
const parsedEmailsPreview = computed(() => {
  if (!newEmail.value) return []
  const emailRegexGlobal = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  const matches = newEmail.value.match(emailRegexGlobal) || []
  return [...new Set(matches.map(e => e.trim().toLowerCase()))]
})

const filteredEmails = computed(() => {
  const sorted = [...authState.allowedEmails].sort((a, b) => {
    const aLower = a.toLowerCase()
    const bLower = b.toLowerCase()
    // Super admin always first
    if (aLower === SUPER_ADMIN && bLower !== SUPER_ADMIN) return -1
    if (bLower === SUPER_ADMIN && aLower !== SUPER_ADMIN) return 1
    // Other admins before regular users
    const aIsAdmin = ADMIN_EMAILS.includes(aLower)
    const bIsAdmin = ADMIN_EMAILS.includes(bLower)
    if (aIsAdmin && !bIsAdmin) return -1
    if (!aIsAdmin && bIsAdmin) return 1
    // Alphabetical within each group
    return a.localeCompare(b)
  })

  if (!searchQuery.value.trim()) return sorted
  const q = searchQuery.value.trim().toLowerCase()
  return sorted.filter(e => e.toLowerCase().includes(q))
})

const isNotAllowed = ref(false)
const notAllowedEmail = ref('')
const isAdminPage = ref(false)

function checkIsAdminPage() {
  if (typeof window !== 'undefined') {
    const isPathAdmin = window.location.pathname === '/admin' || window.location.pathname === '/admin.html'
    const isQueryAdmin = window.location.search.includes('admin')
    const isHashAdmin = window.location.hash === '#admin'
    isAdminPage.value = isPathAdmin || isQueryAdmin || isHashAdmin
  }
}

function resetLogin() {
  isNotAllowed.value = false
  notAllowedEmail.value = ''
  errorMessage.value = ''
  isZohoLoading.value = false
  initGoogleSignIn()
}

// ── Zoho OAuth2 popup flow ────────────────────────────────────────────────────

/**
 * Build the Zoho authorization URL and open a popup window.
 * The popup will redirect to /zoho-callback.html, which posts the auth code
 * back via window.opener.postMessage.
 */
function initiateZohoLogin() {
  errorMessage.value = ''

  if (!ZOHO_CLIENT_ID) {
    errorMessage.value = 'Zoho Sign-In is not configured. Please contact the administrator.'
    return
  }

  // Build redirect URI dynamically so it works in both dev and production
  const redirectUri = `${window.location.origin}/zoho-callback.html`

  // Random state param to prevent CSRF
  const state = Math.random().toString(36).substring(2, 15)
  sessionStorage.setItem('zoho_oauth_state', state)

  // Build URL manually — URLSearchParams percent-encodes scope separators which Zoho rejects.
  // Zoho only supports its own scope names; access_type and prompt are Google-specific and unsupported.
  // AaaServer.profile.Read  → legacy /oauth/user/info endpoint (Email, Display_Name, ZUID…)
  // openid email profile    → OIDC  /oauth/v2/userinfo endpoint (email, name, sub…)
  // Request all so either endpoint path can return an email address.
  const scope = 'AaaServer.profile.Read openid email profile'
  const authUrl = `${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/auth` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(ZOHO_CLIENT_ID)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`

  // Debug log — open browser DevTools Console to see this
  console.log('[Zoho Auth] Client ID:', ZOHO_CLIENT_ID)
  console.log('[Zoho Auth] Domain:', ZOHO_ACCOUNTS_DOMAIN)
  console.log('[Zoho Auth] Redirect URI:', redirectUri)
  console.log('[Zoho Auth] Full URL:', authUrl)

  // Open a centred popup
  const width = 480
  const height = 600
  const left = Math.max(0, (window.screen.width - width) / 2)
  const top = Math.max(0, (window.screen.height - height) / 2)

  const popup = window.open(
    authUrl,
    'ZohoSignIn',
    `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
  )

  if (!popup || popup.closed) {
    errorMessage.value = 'Popup was blocked. Please allow popups for this site and try again.'
    return
  }

  zohoPopupWindow = popup
  isZohoLoading.value = true

  // Poll for unexpected closure (user closes popup manually)
  const pollTimer = setInterval(() => {
    if (zohoPopupWindow && zohoPopupWindow.closed) {
      clearInterval(pollTimer)
      isZohoLoading.value = false
      zohoPopupWindow = null
    }
  }, 800)
}

/**
 * Handles the postMessage from zoho-callback.html.
 * Exchanges the auth code for user profile via the backend, then
 * runs the same whitelist check as the Google flow.
 */
async function handleZohoMessage(event) {
  // Only accept messages from our own origin
  if (event.origin !== window.location.origin) return

  const { type, code, state, error } = event.data || {}

  if (type === 'ZOHO_AUTH_ERROR') {
    isZohoLoading.value = false
    errorMessage.value = `Zoho sign-in failed: ${error || 'Unknown error'}`
    return
  }

  if (type !== 'ZOHO_AUTH_CODE' || !code) return

  // CSRF check
  const savedState = sessionStorage.getItem('zoho_oauth_state')
  sessionStorage.removeItem('zoho_oauth_state')
  if (state && savedState && state !== savedState) {
    isZohoLoading.value = false
    errorMessage.value = 'Zoho sign-in failed: Invalid state parameter (possible CSRF).'
    return
  }

  errorMessage.value = ''
  isZohoLoading.value = true

  try {
    const redirectUri = `${window.location.origin}/zoho-callback.html`

    // Exchange code on backend (client secret stays server-side)
    const response = await fetch('/api/zoho-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: redirectUri })
    })

    const data = await response.json()

    if (!response.ok || data.error) {
      errorMessage.value = data.error || 'Zoho authentication failed. Please try again.'
      isZohoLoading.value = false
      return
    }

    const email = (data.email || '').toLowerCase()
    if (!email) {
      errorMessage.value = 'Zoho account did not return a valid email address.'
      isZohoLoading.value = false
      return
    }

    // Re-fetch whitelist and check
    await fetchWhitelistedEmails()
    const isAllowed = authState.allowedEmails.map(e => e.toLowerCase()).includes(email)

    if (isAllowed) {
      authState.isLoggedIn = true
      authState.userEmail = email
      authState.userName = data.name || email
      authState.userPicture = data.picture || ''
      authState.idToken = `zoho:${code}` // placeholder — backend verified
      authState.isAdmin = ADMIN_EMAILS.includes(email)

      localStorage.setItem('fp_auth_token', `zoho:${code}`)
      localStorage.setItem('fp_auth_email', email)
      localStorage.setItem('fp_auth_name', data.name || email)
      localStorage.setItem('fp_auth_picture', data.picture || '')
      localStorage.setItem('fp_auth_provider', 'zoho')

      showFullscreenPrompt.value = true
    } else {
      isNotAllowed.value = true
      notAllowedEmail.value = email
    }
  } catch (err) {
    console.error('[Zoho auth] Exchange error:', err)
    errorMessage.value = 'Network error during Zoho sign-in. Please try again.'
  } finally {
    isZohoLoading.value = false
  }
}

function closeAdminPanel() {
  if (isAdminPage.value) {
    window.location.href = '/'
  } else {
    authState.showAdminPanel = false
  }
}

// Helper to decode JWT on the client
function decodeJwt(token) {
  try {
    const base64Url = token.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    }).join(''))
    return JSON.parse(jsonPayload)
  } catch (e) {
    console.error('Failed to decode JWT:', e)
    return null
  }
}

// Fetch whitelisted emails from API
async function fetchWhitelistedEmails() {
  try {
    const response = await fetch('/api/emails')
    if (response.ok) {
      const data = await response.json()
      authState.allowedEmails = data.emails || []
      localStorage.setItem('fp_allowed_emails', JSON.stringify(authState.allowedEmails))
    } else {
      throw new Error('API response not ok')
    }
  } catch (error) {
    console.warn('Could not fetch allowed emails from server. Falling back to local cache/default.', error)
    const local = localStorage.getItem('fp_allowed_emails')
    if (local) {
      authState.allowedEmails = JSON.parse(local)
    } else {
      authState.allowedEmails = [...ADMIN_EMAILS]
      localStorage.setItem('fp_allowed_emails', JSON.stringify(authState.allowedEmails))
    }
  }
}

// Check local storage for existing session
async function checkAuthSession() {
  checkIsAdminPage()
  isPageLoading.value = true
  await fetchWhitelistedEmails()

  const savedToken = localStorage.getItem('fp_auth_token')
  const savedEmail = localStorage.getItem('fp_auth_email')
  const savedName = localStorage.getItem('fp_auth_name')
  const savedPicture = localStorage.getItem('fp_auth_picture')

  if (savedToken && savedEmail) {
    const isAllowed = authState.allowedEmails.map(e => e.toLowerCase()).includes(savedEmail.toLowerCase())
    if (isAllowed) {
      authState.isLoggedIn = true
      authState.userEmail = savedEmail
      authState.userName = savedName || ''
      authState.userPicture = savedPicture || ''
      authState.idToken = savedToken
      authState.isAdmin = ADMIN_EMAILS.includes(savedEmail.toLowerCase())
    } else {
      logout()
      errorMessage.value = `Session expired: Email '${savedEmail}' is no longer whitelisted.`
    }
  }
  isPageLoading.value = false
}

// Initialize Google Identity Services
function initGoogleSignIn() {
  if (authState.isLoggedIn) return

  nextTick(() => {
    try {
      if (typeof window.google === 'undefined') {
        console.error('Google Identity Services script not loaded')
        return
      }

      window.google.accounts.id.initialize({
        client_id: '207254417956-cgi3av80ac090nqrurpjkdhj19nievvp.apps.googleusercontent.com',
        callback: handleGoogleSignInCallback,
        auto_select: false
      })

      const btnEl = document.getElementById('google-signin-btn')
      if (btnEl) {
        window.google.accounts.id.renderButton(btnEl, {
          theme: 'filled_black',
          size: 'large',
          width: '220',
          text: 'signin_with',
          shape: 'pill',
          border: 'none',
        })
      }
    } catch (err) {
      console.error('Failed to initialize Google Sign In:', err)
    }
  })
}

// Google Sign-In Callback
async function handleGoogleSignInCallback(response) {
  errorMessage.value = ''
  successMessage.value = ''
  
  if (!response.credential) {
    errorMessage.value = 'Failed to retrieve login credentials from Google.'
    return
  }

  const payload = decodeJwt(response.credential)
  if (!payload) {
    errorMessage.value = 'Failed to decode identity token.'
    return
  }

  const email = payload.email ? payload.email.toLowerCase() : ''
  const isEmailVerified = payload.email_verified === true || payload.email_verified === 'true'

  if (!email) {
    errorMessage.value = 'Google account did not return a valid email address.'
    return
  }

  if (!isEmailVerified) {
    errorMessage.value = 'Your Google email address is not verified.'
    return
  }

  await fetchWhitelistedEmails()

  const isAllowed = authState.allowedEmails.map(e => e.toLowerCase()).includes(email)

  if (isAllowed) {
    authState.isLoggedIn = true
    authState.userEmail = email
    authState.userName = payload.name || ''
    authState.userPicture = payload.picture || ''
    authState.idToken = response.credential
    authState.isAdmin = ADMIN_EMAILS.includes(email)

    localStorage.setItem('fp_auth_token', response.credential)
    localStorage.setItem('fp_auth_email', email)
    localStorage.setItem('fp_auth_name', payload.name || '')
    localStorage.setItem('fp_auth_picture', payload.picture || '')
    showFullscreenPrompt.value = true
  } else {
    isNotAllowed.value = true
    notAllowedEmail.value = email
  }
}

// Add new email(s) (Admin only)
async function addEmail() {
  const emailsToWhitelist = parsedEmailsPreview.value
  if (emailsToWhitelist.length === 0) return

  errorMessage.value = ''
  successMessage.value = ''
  isLoading.value = true

  try {
    const response = await fetch('/api/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authState.idToken}`
      },
      body: JSON.stringify({ emails: emailsToWhitelist })
    })

    const data = await response.json()

    if (response.ok) {
      authState.allowedEmails = data.emails || []
      localStorage.setItem('fp_allowed_emails', JSON.stringify(authState.allowedEmails))
      successMessage.value = `Successfully added`
      newEmail.value = ''

      setTimeout(() => {
        successMessage.value = ''
      },1000)
    } else {
      throw new Error(data.error || 'Failed to add emails')
    }
  } catch (error) {
    console.error('Failed to add emails: ', error)
    errorMessage.value = error.message || 'Failed to add emails'
  } finally {
    isLoading.value = false
  }
}

// Delete email (Admin only)
async function removeEmail(emailToRemove) {
  if (ADMIN_EMAILS.includes(emailToRemove)) {
    errorMessage.value = 'Cannot remove the super administrator email.'
    return
  }

  // if (!confirm(`Are you sure you want to remove '${emailToRemove}' from the whitelist?`)) {
  //   return
  // }

  errorMessage.value = ''
  successMessage.value = ''
  isLoading.value = true

  try {
    const response = await fetch('/api/emails', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authState.idToken}`
      },
      body: JSON.stringify({ email: emailToRemove })
    })

    const data = await response.json()

    if (response.ok) {
      authState.allowedEmails = data.emails || []
      localStorage.setItem('fp_allowed_emails', JSON.stringify(authState.allowedEmails))
      successMessage.value = `Removed successfully`

      setTimeout(() => {
        successMessage.value = ''
      },1000)
    } else {
      throw new Error(data.error || 'Failed to remove email')
    }
  } catch (error) {
    console.error('Failed to remove email:', error)
    errorMessage.value = error.message || 'Failed to remove email'
  } finally {
    isLoading.value = false
  }
}

// Block Slidev keyboard navigation keys when not logged in
function blockKeyboard(e) {
  if (!authState.isLoggedIn) {
    const blockedKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar', 'Enter']
    if (blockedKeys.includes(e.key)) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return
      }
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', blockKeyboard, { capture: true })
  window.addEventListener('keyup', blockKeyboard, { capture: true })
  window.addEventListener('keypress', blockKeyboard, { capture: true })

  // Listen for Zoho popup postMessage
  window.addEventListener('message', handleZohoMessage)

  // Defer auth session check to nextTick so Slidev's navigation context
  // (nav.current used by updateSharedState in root.ts) is fully initialised
  // before any authState mutations trigger Slidev's internal shared-state watchers.
  nextTick(() => {
    checkAuthSession().then(() => {
      if (typeof window.google === 'undefined') {
        const script = document.createElement('script')
        script.src = 'https://accounts.google.com/gsi/client'
        script.async = true
        script.defer = true
        script.onload = () => initGoogleSignIn()
        script.onerror = () => {
          errorMessage.value = 'Could not load Google Sign-In SDK. Check your internet connection.'
        }
        document.head.appendChild(script)
      } else {
        initGoogleSignIn()
      }
    })
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', blockKeyboard, { capture: true })
  window.removeEventListener('keyup', blockKeyboard, { capture: true })
  window.removeEventListener('keypress', blockKeyboard, { capture: true })
  window.removeEventListener('message', handleZohoMessage)

  // Close any open Zoho popup when component unmounts
  if (zohoPopupWindow && !zohoPopupWindow.closed) {
    zohoPopupWindow.close()
    zohoPopupWindow = null
  }
})
</script>

<template>
  <div>
    <!-- FULLSCREEN PROMPT (shown once after login, requires direct click for browser gesture) -->
    <Transition name="fade">
      <div v-if="showFullscreenPrompt" class="fs-prompt-overlay">
        <div class="fs-prompt-card">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="fs-prompt-icon">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
          <p class="fs-prompt-text">Click to enter fullscreen for the best experience</p>
          <button class="fs-prompt-btn" @click="enterFullscreen(); showFullscreenPrompt = false">
            Enter Fullscreen
          </button>
          <button class="fs-prompt-skip" @click="showFullscreenPrompt = false">Skip</button>
        </div>
      </div>
    </Transition>

    <!-- 1. FULL-SCREEN LOGIN OVERLAY (shown if not logged in) -->
    <Transition name="fade">
      <div v-if="!authState.isLoggedIn && !isPageLoading" class="login-overlay">
        <div class="login-card">
          <!-- Brand header -->
          <div class="brand-container">
            <div class="brand-logo">
              <img src="../assets/logo.png" style="width: 150px;"/>
            </div>
            <p class="brand-tagline">{{ isAdminPage ? 'Admin Whitelist Portal' : 'Interactive Slide Deck Portal' }}</p>
          </div>

          <!-- <div class="divider"></div> -->

          <!-- Card Body -->
          <div class="login-body">
            <template v-if="isNotAllowed">
              <div class="not-allowed-icon-container">
                <svg class="not-allowed-large-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="15" y1="9" x2="9" y2="15"/>
                  <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
              </div>
              
              <h2 class="login-heading text-red">Not allowed</h2>
              <p class="login-subtext text-center">
                This email is not whitelisted to access.
              </p>
              <div class="not-allowed-actions">
                <center><button @click="resetLogin" class="action-btn-retry">Go Back</button></center>
              </div>
            </template>

            <template v-else>
              <h2 class="login-heading">{{ isAdminPage ? 'Admin Sign In' : 'Sign In Required' }}</h2>
              <p class="login-subtext">
                {{ isAdminPage 
                  ? 'Sign in to the Whitelist Management portal using an administrator Google account.' 
                  : 'Access to this interactive slide deck is restricted. Please sign in with a whitelisted Google Account.' }}
              </p>
              
              <!-- Sign-in buttons -->
              <div class="signin-buttons-stack">
                <!-- Google Button -->
                <div class="signin-button-wrapper">
                  <div id="google-signin-btn"></div>
                </div>

                <!-- Divider -->
                <div class="auth-divider">
                  <span class="auth-divider-line"></span>
                  <span class="auth-divider-text">or</span>
                  <span class="auth-divider-line"></span>
                </div>

                <!-- Zoho Button -->
                <div class="signin-button-wrapper">
                  <button
                    id="zoho-signin-btn"
                    class="zoho-btn"
                    @click="initiateZohoLogin"
                    :disabled="isZohoLoading"
                    :aria-busy="isZohoLoading"
                  >
                    <span v-if="isZohoLoading" class="zoho-btn-spinner"></span>
                    <template v-else>
                      <!-- Zoho Z icon -->
                      <svg class="zoho-btn-icon" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect width="36" height="36" rx="6" fill="#E42527"/>
                        <path d="M9 10h18v3.5L15.5 26H27v3H9v-3.5L20.5 13H9V10z" fill="white"/>
                      </svg>
                      <span class="zoho-btn-text">Sign in with Zoho</span>
                    </template>
                  </button>
                </div>
              </div>

              <!-- Error Banner -->
              <Transition name="slide-up">
                <div v-if="errorMessage" class="error-banner">
                  <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  <div class="error-text">{{ errorMessage }}</div>
                </div>
              </Transition>
            </template>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Page Loading Indicator -->
    <div v-if="isPageLoading" class="page-loader-overlay">
      <div class="loader-spinner"></div>
      <p class="loader-text">Loading deck authorization...</p>
    </div>

    <!-- 2. ADMIN DASHBOARD MODAL/PAGE -->
    <Transition name="fade">
      <div v-if="authState.isLoggedIn && authState.isAdmin && (authState.showAdminPanel || isAdminPage)" class="admin-modal-overlay" @click.self="closeAdminPanel">
        <div class="admin-card">
          <!-- Header -->
          <div class="admin-header">
            <div class="admin-header-title">
              <svg class="admin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <p>Manage Emails</p>
            </div>
            <button class="close-btn" @click="closeAdminPanel" :title="isAdminPage ? 'Back to Slides' : 'Close'">
              <svg v-if="isAdminPage" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px;">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <!-- Body -->
          <div class="admin-body">
            <!-- Alert Banners -->
            <div v-if="errorMessage" class="error-banner mb-3">
              <span>{{ errorMessage }}</span>
            </div>
            <div v-if="successMessage" class="success-banner mb-3">
              <svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <span>{{ successMessage }}</span>
            </div>

            <!-- Add Email Form -->
            <form @submit.prevent="addEmail" class="add-form">
              <textarea 
                v-model="newEmail" 
                placeholder="Add Email Address" 
                required 
                class="form-input form-textarea"
                rows="3"
                :disabled="isLoading"
              ></textarea>

              <!-- Live Auto-Separated Emails Preview -->
              <!-- <div v-if="parsedEmailsPreview.length > 0" class="parsed-preview-box">
                <span class="preview-title">Detected {{ parsedEmailsPreview.length }} email(s):</span>
                <div class="preview-tags">
                  <span v-for="email in parsedEmailsPreview" :key="email" class="preview-tag">
                    {{ email }}
                  </span>
                </div>
              </div> -->

              <button type="submit" class="submit-btn" :disabled="isLoading || parsedEmailsPreview.length === 0">
                <span v-if="isLoading" class="btn-spinner"></span>
                <span v-else>Add {{ parsedEmailsPreview.length == 0 ? "" : parsedEmailsPreview.length }} Email{{ parsedEmailsPreview.length == 1 ? "" : "(s)" }}</span>
              </button>
            </form>

            <!-- Whitelisted Heading with Search -->
            <div class="whitelisted-heading">
              <span>Registered Emails ({{ authState.allowedEmails.length }})</span>
              <div class="search-wrapper">
                <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"/>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="Search"
                  class="search-input"
                />
                <button v-if="searchQuery" class="search-clear-btn" @click="searchQuery = ''" title="Clear search">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>

            <!-- Whitelist List -->
            <div class="emails-list-container">
              <div v-if="filteredEmails.length === 0" class="no-emails">
                {{ searchQuery ? `No emails match "${searchQuery}"` : 'No emails found.' }}
              </div>
              <ul v-else class="emails-list">
                <li v-for="email in filteredEmails" :key="email" class="email-item">
                  <div class="email-details">
                    <span class="email-text">{{ email }}</span>
                    <span v-if="email === SUPER_ADMIN" class="badge-admin">Admin</span>
                    <span v-else-if="ADMIN_EMAILS.includes(email)" class="badge-admin">Admin</span>
                  </div>
                  <button 
                    v-if="!ADMIN_EMAILS.includes(email)"
                    @click="removeEmail(email)" 
                    class="delete-btn" 
                    title="Remove access"
                    :disabled="isLoading"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="trash-icon">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      <line x1="10" y1="11" x2="10" y2="17"/>
                      <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 3. ADMIN ACCESS DENIED -->
    <Transition name="fade">
      <div v-if="isAdminPage && authState.isLoggedIn && !authState.isAdmin" class="login-overlay">
        <div class="login-card">
          <div class="brand-container">
            <div class="brand-logo">
              <img src="../assets/logo.png" style="width: 150px;"/>
            </div>
            <p class="brand-tagline">Admin Portal</p>
          </div>
          <!-- <div class="divider"></div> -->
          <div class="login-body">
            <div class="not-allowed-icon-container text-red">
              <svg class="not-allowed-large-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <h2 class="login-heading text-red">Access Denied</h2>
            <p class="login-subtext text-center">Administrator privileges are required to access this portal. Currently signed in as <strong>{{ authState.userEmail }}</strong>.</p>
            <div class="not-allowed-actions">
              <button @click="logout" class="action-btn-retry width-full">Sign Out / Switch Account</button>
              <a href="/" class="action-btn-admin width-full text-center">Back to Slides</a>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.text-red { color: #ef4444 !important; }
.text-center { text-align: center; }
.width-full { width: 100% !important; }

.not-allowed-icon-container {
  display: flex;
  justify-content: center;
  margin-bottom: 10px;
  color: #ef4444;
  margin-top: -10px;
}
.not-allowed-large-icon { width: 40px; height: 40px;}

.not-allowed-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1.5rem;
  margin-top: -10px;
}

.action-btn-admin {
  background: #ef5050;
  color: white !important;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.88rem;
  padding: 0.75rem 1.25rem;
  border-radius: 8px;
  text-align: center;
  transition: background 0.2s ease;
  display: block;
  border: none;
  cursor: pointer;
  box-sizing: border-box;
}
.action-btn-admin:hover { background: #db3b3b; }

.action-btn-retry {
  background: #ffffff;
  /* color: #ffffffd3 !important; */
  font-weight: 500;
  font-size: 0.88rem;
  padding: 5px;
  border-radius: 4px;
  text-align: center;
  transition: all 0.2s ease;
  cursor: pointer;
  box-sizing: border-box;
  color: #475569;
  width:100px;
}

/* Fullscreen Prompt */
.fs-prompt-overlay {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100vh;
  background: rgba(241, 245, 249, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
  font-family: 'Inter', system-ui, sans-serif;
  box-sizing: border-box;
}
.fs-prompt-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 2rem 2.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  max-width: 340px;
  text-align: center;
}
.fs-prompt-icon {
  width: 40px;
  height: 40px;
  color: #ef5050;
}
.fs-prompt-text {
  color: #2b2b2b;
  font-size: 0.9rem;
  margin: 0;
  line-height: 1.5;
}
.fs-prompt-btn {
  background: #ef5050;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 10px 28px;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s;
  width: 100%;
}
.fs-prompt-btn:hover { background: #db3b3b; }
.fs-prompt-skip {
  background: none;
  border: none;
  color: #414852;
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
}
.fs-prompt-skip:hover { color: #94a3b8; }

/* Layout & Background */
.login-overlay {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  justify-content: right;
  align-items: center;
  z-index: 10;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  overflow: hidden;
  width: 100%;
  height: 100%;
  background-position: center center;
  background-image: url("../assets/Header_Student_placement.webp");
  background-size: 500px;
  background-repeat: no-repeat;
  background-position-x: 10%;
  padding: 50px;
  background-color: #ffffffe1;
}

.page-loader-overlay {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 10;
  font-family: 'Inter', system-ui, sans-serif;
}

.loader-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid rgba(239, 80, 80, 0.15);
  border-left-color: #ef5050;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}
.loader-text { color: #64748b; font-size: 0.95rem; }

/* Login Card */
.login-card {
  width: 100%;
  max-width: 360px;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  padding: 1.75rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  position: relative;
  z-index: 10;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.4);
}

.brand-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.brand-logo {
  width: 80%;
  height: auto;
  min-height: 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.5rem;
}
.brand-tagline { color: #383838; font-size: 0.85rem; margin: 0.25rem 0 0 0; }

.divider {
  height: 1px;
  background: linear-gradient(90deg, rgba(0,0,0,0), rgba(0,0,0,0.06), rgba(0,0,0,0));
}

.login-heading {
  color: #1e293b;
  font-size: 0.95rem;
  font-weight: 600;
  text-align: center;
  margin: 0 0 0.25rem 0;
}
.login-subtext {
  color: #475569;
  font-size: 0.8rem;
  line-height: 1.5;
  text-align: center;
  margin: 0 0 0.5rem 0;
}
.signin-buttons-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0;
}

.signin-button-wrapper {
  display: flex;
  justify-content: center;
}

/* ── Auth divider ──────────────────────────────────────────────── */
.auth-divider {
  display: flex;
  align-items: center;
  width: 100%;
  max-width: 220px;
  gap: 0.75rem;
}
.auth-divider-line {
  flex: 1;
  height: 1px;
  background: #e2e8f0;
}
.auth-divider-text {
  color: #94a3b8;
  font-size: 0.72rem;
  font-weight: 500;
  white-space: nowrap;
}

/* ── Zoho sign-in button ───────────────────────────────────────── */
.zoho-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 220px;
  height: 36px;
  border-radius: 20px;
  border: 1px solid #dadce0;
  background: #fff;
  color: #3c4043;
  font-family: 'Inter', 'Roboto', system-ui, sans-serif;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
  padding: 0 12px;
  letter-spacing: 0.01em;
  box-shadow: 0 1px 2px rgba(60,64,67,.08);
}
.zoho-btn:hover:not(:disabled) {
  background: #f8f9fa;
  border-color: #c5c7ca;
  box-shadow: 0 2px 6px rgba(60,64,67,.12);
}
.zoho-btn:active:not(:disabled) {
  background: #f1f3f4;
}
.zoho-btn:disabled {
  opacity: 0.75;
  cursor: not-allowed;
}
.zoho-btn-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 3px;
}
.zoho-btn-text {
  flex: 1;
  text-align: center;
  padding-right: 18px; /* visually balance the icon */
}
.zoho-btn-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(60,64,67,0.2);
  border-left-color: #E42527;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Error Banner */
.error-banner {
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.15);
  border-radius: 10px;
  padding: 0.75rem 1rem;
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  margin-top: 1rem;
}
.error-icon { width: 18px; height: 18px; color: #ef4444; flex-shrink: 0; margin-top: 2px; }
.error-text { color: #ef4444; font-size: 0.82rem; line-height: 1.4; text-align: left; }

/* Admin Modal */
.admin-modal-overlay {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  background: rgba(241, 245, 249, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
  font-family: 'Inter', system-ui, sans-serif;
  box-sizing: border-box;
}

.admin-card {
  width: 100%;
  max-width: 500px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 20px 40px -15px rgba(15, 23, 42, 0.1);
  display: flex;
  flex-direction: column;
  min-height: 10vh;
  box-sizing: border-box;
  /* margin-top: -200px; */
}

.admin-header {
  padding: 1rem 1rem;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 44px;
}
.admin-header-title { display: flex; align-items: center; gap: 0.5rem; }
.admin-header-title p { 
  color: #2c3543; 
  font-size: .8rem; 
  font-weight: 400; 
  margin: 0; 
}
.admin-icon { width: 15px; height: 15px; color: #2c3543; }

.close-btn {
  background: none;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}
.close-btn:hover { 
  background: #ef50503a; 
  color: #ef5050; 
}
.close-btn svg { width: 15px; height: 15px; }

.admin-body {
  padding: 10px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.success-banner {
  background: rgba(34, 197, 94, 0.05);
  border: 1px solid rgba(34, 197, 94, 0.15);
  border-radius: 8px;
  padding: 5px 10px;
  display: flex;
  gap: 0.75rem;
  align-items: center;
  color: #166534;
  font-size: 0.65rem;
  z-index: 20;

}
.success-icon { width: 13px; height: 13px; color: #22c55e; flex-shrink: 0; }
.mb-3 { margin-bottom: 0.75rem; }

/* Add Email Form */
.add-form { display: flex; flex-direction: column; gap: .5rem; }
.form-textarea { min-height: 30px; resize: vertical; font-family: inherit; line-height: 1.4; }

.parsed-preview-box {
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  padding: 5px;
  max-height: 50px;
  overflow-y: auto;
}
.preview-title { display: block; font-size: 0.6rem; font-weight: 500; color: #475569; margin-bottom: 0.2rem; text-align: left; }
.preview-tags { display: flex; flex-wrap: wrap; gap: 0.375rem; }
.preview-tag {
  background: #e2e8f0;
  color: #334155;
  font-size: 0.6rem;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  border: 1px solid #cbd5e1;
  word-break: break-all;
}

.form-input {
  flex: 1;
  background: #b6b6b620;
  border: 1px solid #383838a1;
  border-radius: 4px;
  padding: 8px;
  color: #1e293b;
  font-size: 0.7rem;
  outline: none;
  transition: border-color 0.2s ease;

  max-height: 50px;
}
.form-input:focus { border-color: #ef5050; }

.submit-btn {
  background: #ef5050;
  color: white;
  border: none;
  border-radius: 5px;
  padding: 4px 6px;
  font-weight: 600;
  font-size: 0.6rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20%;
  transition: background 0.2s ease;
}
.submit-btn:hover:not(:disabled) { background: #db3b3b; }
.submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-left-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Whitelisted heading with search */
.whitelisted-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.6rem;
  color: #64748b;
  letter-spacing: 0.05em;
  font-weight: 500;
  margin: 5px 0px;
}

.search-wrapper {
  display: flex;
  flex-direction: row;
  align-items: center;
  background: #f8fafc;
  /* background-color: palevioletred; */
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  padding: 3px 8px;
  gap: 4px;
  transition: border-color 0.2s ease;
  width: 200px;
}
.search-wrapper:focus-within { border-color: #ef5050; background: #fff; font-size: .5rem;}

.search-icon { width: 11px; height: 11px; color: #94a3b8; flex-shrink: 0; }

.search-input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 0.6rem;
  color: #2a2a2b;
  width: 150px;
  padding: 1px 0;
  font-family: inherit;
}
.search-input::placeholder { color: #94a3b8; }

.search-clear-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  color: #94a3b8;
  transition: color 0.2s ease;
  flex-shrink: 0;
}
.search-clear-btn:hover { color: #ef4444; }
.search-clear-btn svg { width: 10px; height: 10px; }

/* Email List */
.emails-list-container {
  max-height: 100px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  background: #f8fafc;
}
.no-emails { padding: 2rem; text-align: center; color: #64748b; font-size: 0.7rem; }
.emails-list { list-style: none; padding: 0; margin: 0; }

.email-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px;
  border-bottom: 1px solid #e2e8f0;
  transition: background 0.15s ease;
}
.email-item:last-child { border-bottom: none; }
.email-item:hover { background: #f1f5f9; }

.email-details { display: flex; align-items: center; gap: 0.75rem; }
.email-text { color: #334155; font-size: 0.7rem; }

.badge-admin {
  background: rgba(239, 80, 80, 0.1);
  color: #ef5050;
  font-size: 0.6rem;
  font-weight: 300;
  padding: 2px 8px;
  border: 1px solid rgba(239, 80, 80, 0.2);
  border-radius: 10px;
}

.delete-btn {
  background: none;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 5px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  width: 23px;
}
.delete-btn:hover:not(:disabled) { background: rgba(239, 68, 68, 0.05); color: #ef4444; }
.delete-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.trash-icon { width: 16px; height: 16px; }

/* Animations */
@keyframes spin { to { transform: rotate(360deg); } }

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.slide-up-enter-active { transition: all 0.3s ease-out; }
.slide-up-enter-from { opacity: 0; transform: translateY(10px); }
</style>
