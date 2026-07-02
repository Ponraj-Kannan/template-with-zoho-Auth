import { reactive } from 'vue'

export const authState = reactive({
  isLoggedIn: false,
  userEmail: '',
  userName: '',
  userPicture: '',
  idToken: '',
  allowedEmails: [] as string[],
  isAdmin: false,
  showAdminPanel: false
})

export function logout() {
  authState.isLoggedIn = false
  authState.userEmail = ''
  authState.userName = ''
  authState.userPicture = ''
  authState.idToken = ''
  authState.isAdmin = false
  authState.showAdminPanel = false
  
  localStorage.removeItem('fp_auth_token')
  localStorage.removeItem('fp_auth_email')
  localStorage.removeItem('fp_auth_name')
  localStorage.removeItem('fp_auth_picture')
  
  // Reload page to reset slidev slides to initial state
  window.location.reload()
}
