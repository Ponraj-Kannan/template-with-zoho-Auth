/**
 * /api/zoho-auth
 *
 * Vercel-compatible serverless function (also shimmed for Vite local dev via vite.config.ts).
 *
 * POST { code, redirect_uri }
 *   → exchanges Zoho auth code for access token (client secret stays server-side)
 *   → fetches Zoho user profile (email, name, picture)
 *   → stores/updates session in Firestore `zoho_sessions` collection
 *   → returns { email, name, picture }
 *
 * The frontend (LoginOverlay.vue) takes { email, name, picture }, checks the email
 * against the Firestore whitelist, and manages the local authState — consistent with
 * the existing Google Sign-In flow.
 */

import { initializeApp, getApps } from 'firebase/app'
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore'

// ── Firebase setup (same config as api/emails.js) ──────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDlvW1FFJg0aTYOPUcIrlYxU6L7B6kdwwU",
  authDomain: "slidev-demo-course.firebaseapp.com",
  projectId: "slidev-demo-course",
  storageBucket: "slidev-demo-course.firebasestorage.app",
  messagingSenderId: "339581398931",
  appId: "1:339581398931:web:3b3a1b76a2d9e46e398266"
};

// Guard against duplicate initialization in Vite dev HMR
const firebaseApp =
  getApps().find((a) => a.name === 'slidev-pro') ??
  initializeApp(firebaseConfig, 'slidev-pro')

const db = getFirestore(firebaseApp)

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Exchange the Zoho authorization code for an access token.
 * Returns the full token response JSON from Zoho.
 */
async function exchangeCodeForToken(code, redirectUri, accountsDomain) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    redirect_uri: redirectUri,
    code
  })

  const tokenUrl = `${accountsDomain}/oauth/v2/token`
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  })

  const data = await response.json()

  if (!response.ok || data.error) {
    throw new Error(data.error || `Zoho token exchange failed (HTTP ${response.status})`)
  }

  if (!data.access_token) {
    throw new Error('Zoho did not return an access_token')
  }

  return data
}

/**
 * Fetch the Zoho user profile using the access token.
 *
 * Zoho has two profile endpoints with different scopes:
 *   - Legacy: {accountsServer}/oauth/user/info  (AaaServer.profile.Read scope)
 *             Returns: { Email, Display_Name, First_Name, Last_Name, ZUID, ... }
 *   - OIDC:   {accountsServer}/oauth/v2/userinfo (openid email profile scope)
 *             Returns: { email, name, sub, email_verified, ... }
 *
 * We request both and merge so the email is always found regardless of scope.
 */
async function fetchZohoProfile(accessToken, accountsServer) {
  const headers = { Authorization: `Zoho-oauthtoken ${accessToken}` }
  let merged = {}

  // 1. Try the legacy AaaServer endpoint
  try {
    const legacyUrl = `${accountsServer}/oauth/user/info`
    console.log('[zoho-auth] Trying legacy endpoint:', legacyUrl)
    const r = await fetch(legacyUrl, { headers })
    const text = await r.text()
    console.log('[zoho-auth] Legacy response (status', r.status, '):', text)
    if (r.ok) {
      const data = JSON.parse(text)
      if (!data.error && data.response !== 'error') {
        merged = { ...merged, ...data }
      }
    }
  } catch (e) {
    console.warn('[zoho-auth] Legacy endpoint failed:', e.message)
  }

  // 2. Try the OIDC v2 endpoint (works when openid+email scopes were granted)
  try {
    const oidcUrl = `${accountsServer}/oauth/v2/userinfo`
    console.log('[zoho-auth] Trying OIDC endpoint:', oidcUrl)
    const r = await fetch(oidcUrl, { headers })
    const text = await r.text()
    console.log('[zoho-auth] OIDC response (status', r.status, '):', text)
    if (r.ok) {
      const data = JSON.parse(text)
      if (!data.error && data.response !== 'error') {
        merged = { ...merged, ...data }
      }
    }
  } catch (e) {
    console.warn('[zoho-auth] OIDC endpoint failed:', e.message)
  }

  console.log('[zoho-auth] Merged profile keys:', Object.keys(merged))

  if (Object.keys(merged).length === 0) {
    throw new Error('Both Zoho profile endpoints failed to return valid data.')
  }

  return merged
}

/**
 * Store / update the Zoho session record in Firestore.
 * Collection: zoho_sessions / document: <normalised email>
 * This provides an audit trail and can be extended later for session revocation.
 *
 * Intentionally non-blocking — auth does not fail if Firestore write fails.
 */
async function storeSessionInFirestore(email, name, picture, zohoUserId) {
  try {
    const sessionRef = doc(db, 'zoho_sessions', email.toLowerCase().replace(/[^a-z0-9]/g, '_'))
    await setDoc(
      sessionRef,
      {
        email: email.toLowerCase(),
        name: name || '',
        picture: picture || '',
        zoho_user_id: zohoUserId || '',
        provider: 'zoho',
        last_login: serverTimestamp(),
        updated_at: serverTimestamp()
      },
      { merge: true } // preserve created_at on subsequent logins
    )
  } catch (err) {
    // Log but do not throw — session storage is best-effort
    console.warn('[zoho-auth] Firestore session write failed (non-fatal):', err.message || err)
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS headers — mirror api/emails.js
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' })
  }

  // ── Validate env config ──────────────────────────────────────────────────
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET) {
    console.error('[zoho-auth] Missing ZOHO_CLIENT_ID or ZOHO_CLIENT_SECRET env vars')
    return res.status(500).json({ error: 'Server is not configured for Zoho authentication.' })
  }

  // ── Parse request body ──────────────────────────────────────────────────
  const { code, redirect_uri } = req.body || {}

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid authorization code.' })
  }
  if (!redirect_uri || typeof redirect_uri !== 'string') {
    return res.status(400).json({ error: 'Missing redirect_uri.' })
  }

  // Determine Zoho accounts domain (respects VITE_ prefix used by frontend)
  const accountsDomain =
    process.env.ZOHO_ACCOUNTS_DOMAIN ||
    process.env.VITE_ZOHO_ACCOUNTS_DOMAIN ||
    'https://accounts.zoho.in'

  try {
    // 1. Exchange auth code for access token
    const tokenData = await exchangeCodeForToken(code, redirect_uri, accountsDomain)

    const accessToken = tokenData.access_token

    // Zoho returns the region-aware API base URL in accounts_server.
    // Fall back to the configured domain if not present.
    const accountsServer = tokenData.accounts_server || accountsDomain

    // 2. Fetch user profile
    const profile = await fetchZohoProfile(accessToken, accountsServer)

    // Zoho profile field names vary by DC and scope — try all known variations
    // Also unwrap nested data if Zoho wraps the payload: { data: { Email: ... } }
    const p = profile.data || profile
    console.log('[zoho-auth] Parsed profile keys:', Object.keys(p))

    const email = (
      p.Email || p.email ||
      p.EmailID || p.emailid ||
      p.email_address ||
      p.primary_email ||
      ''
    ).toLowerCase().trim()

    const name =
      p.Display_Name || p.display_name ||
      p.name ||
      `${p.First_Name || p.first_name || ''} ${p.Last_Name || p.last_name || ''}`.trim() ||
      email

    // Zoho does not provide a profile picture via the basic profile scope.
    // We use a deterministic avatar URL as fallback so the frontend avatar
    // rendering (which expects a picture field) always has something to show.
    const picture =
      p.picture || p.Photo_ID || p.photo_url ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=E42527&color=fff&size=96`

    const zohoUserId = p.ZUSERS_ID || p.id || p.sub || p.user_id || ''

    if (!email) {
      console.error('[zoho-auth] Profile had no email. Full profile:', JSON.stringify(profile))
      return res.status(400).json({
        error: 'Zoho account did not return a valid email address. Check OAuth scope includes AaaServer.profile.Read.'
      })
    }

    // 3. Store session in Firestore (best-effort, non-blocking to response time)
    await storeSessionInFirestore(email, name, picture, zohoUserId)

    // 4. Return profile to frontend
    // The frontend (LoginOverlay.vue → handleZohoMessage) will:
    //   - Check email against the Firestore whitelist
    //   - Set authState.isLoggedIn = true
    //   - Persist to localStorage (fp_auth_*)
    return res.status(200).json({ email, name, picture })
  } catch (err) {
    console.error('[zoho-auth] Authentication error:', err.message || err)

    // Map known Zoho error codes to friendly messages
    const msg = err.message || 'Zoho authentication failed. Please try again.'
    const isZohoError = msg.includes('invalid_code') || msg.includes('expired')
    const statusCode = isZohoError ? 401 : 500

    return res.status(statusCode).json({ error: msg })
  }
}
