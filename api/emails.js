import fs from 'node:fs'
import path from 'node:path'
import { initializeApp, getApps, getApp } from 'firebase/app'
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore'

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDlvW1FFJg0aTYOPUcIrlYxU6L7B6kdwwU",
  authDomain: "slidev-demo-course.firebaseapp.com",
  projectId: "slidev-demo-course",
  storageBucket: "slidev-demo-course.firebasestorage.app",
  messagingSenderId: "339581398931",
  appId: "1:339581398931:web:3b3a1b76a2d9e46e398266"
};

// Initialize Firebase — guard against duplicate initialization in Vite dev HMR
const firebaseApp = getApps().find(a => a.name === 'slidev-pro') ?? initializeApp(firebaseConfig, 'slidev-pro')
const db = getFirestore(firebaseApp)

// Admin emails — must be kept in sync with ADMIN_EMAILS in LoginOverlay.vue
const ADMIN_EMAILS = [
  'ponrajacc@gmail.com',
  'gunatamil123@gmail.com',
  'learning@faceprep.in'
]

// Global cache in case filesystem is read-only (e.g. on Vercel)
let inMemoryList = null

function getFilePath() {
  return path.join(process.cwd(), 'allowed-emails.json')
}

async function loadEmails() {
  console.log('--- loadEmails called ---')
  // 1. Try to load from Firestore
  try {
    const docRef = doc(db, 'whitelist', 'emails')
    const docSnap = await getDoc(docRef)
    if (docSnap.exists()) {
      const data = docSnap.data()
      if (data && Array.isArray(data.list)) {
        inMemoryList = data.list
        return inMemoryList
      }
    }
  } catch (error) {
    console.warn('Firestore read failed (using local/in-memory fallback):', error.message || error)
  }

  // 2. Fallback to in-memory cache if Firestore read failed
  if (inMemoryList) {
    return inMemoryList
  }

  // 3. Fallback to local file allowed-emails.json
  const filePath = getFilePath()
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8')
      inMemoryList = JSON.parse(data)
      // Seed Firestore with local whitelist
      try {
        const docRef = doc(db, 'whitelist', 'emails')
        await setDoc(docRef, { list: inMemoryList })
      } catch (dbErr) {
        console.warn('Failed to seed local emails to Firestore:', dbErr.message || dbErr)
      }
      return inMemoryList
    }
  } catch (error) {
    console.error('Failed to read allowed-emails.json:', error)
  }

  // Fallback to default admin emails
  inMemoryList = [...ADMIN_EMAILS]

  try {
    const docRef = doc(db, 'whitelist', 'emails')
    await setDoc(docRef, { list: inMemoryList })
  } catch (dbErr) {
    console.warn('Failed to seed default email to Firestore:', dbErr.message || dbErr)
  }
  return inMemoryList
}

async function saveEmails(emails) {
  inMemoryList = emails

  // 1. Save to Firestore
  let dbSuccess = false
  try {
    const docRef = doc(db, 'whitelist', 'emails')
    await setDoc(docRef, { list: emails })
    dbSuccess = true
  } catch (error) {
    console.warn('Failed to write to Firestore (saving locally instead):', error.message || error)
  }

  // 2. Save to local file allowed-emails.json (backup / local dev)
  const filePath = getFilePath()
  try {
    fs.writeFileSync(filePath, JSON.stringify(emails, null, 2), 'utf8')
    return { success: dbSuccess, readOnly: false }
  } catch (error) {
    console.warn('Failed to write allowed-emails.json (likely read-only serverless environment):', error.message || error)
    return { success: dbSuccess, readOnly: true }
  }
}

// Verifies Google ID Token via Google's tokeninfo API
async function verifyGoogleToken(idToken) {
  if (!idToken) return null

  try {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`)
    if (!response.ok) {
      return null
    }
    const payload = await response.json()
    // Verify client ID matches
    const expectedClientId = '207254417956-cgi3av80ac090nqrurpjkdhj19nievvp.apps.googleusercontent.com'
    if (payload.aud !== expectedClientId) {
      console.warn('Token aud does not match client ID')
      return null
    }
    return payload
  } catch (error) {
    console.error('Error verifying Google token:', error)
    return null
  }
}

export default async function handler(req, res) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // Load emails
  const emails = await loadEmails()

  if (req.method === 'GET') {
    return res.status(200).json({ emails })
  }

  if (req.method === 'POST' || req.method === 'DELETE') {
    // 1. Verify Google Authorization header
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' })
    }

    const token = authHeader.split(' ')[1]
    const tokenPayload = await verifyGoogleToken(token)

    if (!tokenPayload) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token signature or expired' })
    }

    const requesterEmail = tokenPayload.email
    const isRequesterVerified = tokenPayload.email_verified === 'true' || tokenPayload.email_verified === true

    if (!isRequesterVerified) {
      return res.status(403).json({ error: 'Forbidden: Google email is not verified' })
    }

    // 2. ONLY ponraij@gmail.com can manage the email whitelist
    if (!ADMIN_EMAILS.includes(requesterEmail)) {
      return res.status(403).json({ error: 'Forbidden: Only administrators can manage allowed emails' })
    }

    // 3. Process actions
    if (req.method === 'POST') {
      const { email, emails: emailsToAdd } = req.body

      // Determine list of emails to add
      let listToAdd = []
      if (email && typeof email === 'string') {
        listToAdd.push(email)
      } else if (Array.isArray(emailsToAdd)) {
        listToAdd = emailsToAdd
      } else {
        return res.status(400).json({ error: 'Bad Request: Missing email or emails field' })
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      const validEmailsToAdd = []

      for (let item of listToAdd) {
        if (typeof item !== 'string') continue
        const cleanEmail = item.trim().toLowerCase()
        if (emailRegex.test(cleanEmail)) {
          validEmailsToAdd.push(cleanEmail)
        }
      }

      if (validEmailsToAdd.length === 0) {
        return res.status(400).json({ error: 'Bad Request: No valid email addresses provided' })
      }

      // Add to existing list, avoiding duplicates
      let updatedList = [...emails]
      let addedCount = 0
      for (const cleanEmail of validEmailsToAdd) {
        if (!updatedList.includes(cleanEmail)) {
          updatedList.push(cleanEmail)
          addedCount++
        }
      }

      const saveResult = await saveEmails(updatedList)

      const isSaved = saveResult.success || !saveResult.readOnly
      if (!isSaved) {
        return res.status(500).json({ error: 'Database Write Error: Failed to save changes to Firestore database and local storage is read-only.' })
      }


      return res.status(200).json({
        emails: updatedList,
        persisted: !saveResult.readOnly,
        message: saveResult.readOnly
          ? `Successfully whitelisted ${addedCount} email(s) in database (local filesystem read-only)`
          : (!saveResult.success
            ? `Successfully whitelisted ${addedCount} email(s) locally (Firestore write failed)`
            : `Successfully whitelisted ${addedCount} email(s)`)
      })
    }

    if (req.method === 'DELETE') {
      const { email } = req.body
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Bad Request: Missing email field' })
      }

      const targetEmail = email.trim().toLowerCase()
      if (ADMIN_EMAILS.includes(targetEmail)) {
        return res.status(400).json({ error: 'Bad Request: Cannot delete the primary administrator email' })
      }

      if (!emails.includes(targetEmail)) {
        return res.status(404).json({ error: 'Not Found: Email not found in whitelist' })
      }

      const updatedList = emails.filter(e => e !== targetEmail)
      const saveResult = await saveEmails(updatedList)

      const isSaved = saveResult.success || !saveResult.readOnly
      if (!isSaved) {
        return res.status(500).json({ error: 'Database Write Error: Failed to save changes to Firestore database and local storage is read-only.' })
      }

      return res.status(200).json({
        emails: updatedList,
        persisted: !saveResult.readOnly,
        message: saveResult.readOnly
          ? 'Email removed from database (local filesystem read-only)'
          : (!saveResult.success
            ? 'Email removed successfully locally (Firestore write failed)'
            : 'Email removed successfully')
      })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
