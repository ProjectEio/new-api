/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { api } from './api'

// ============================================================================
// OAuth URL Builders
// ============================================================================

/**
 * Build GitHub OAuth URL
 */
export function buildGitHubOAuthUrl(clientId: string, state: string): string {
  return `https://github.com/login/oauth/authorize?client_id=${clientId}&state=${state}&scope=user:email`
}

/**
 * Build LinuxDO OAuth URL
 */
export function buildLinuxDOOAuthUrl(clientId: string, state: string): string {
  return `https://connect.linux.do/oauth2/authorize?response_type=code&client_id=${clientId}&state=${state}`
}

// ============================================================================
// OAuth Helper Functions
// ============================================================================

/**
 * Get OAuth state token
 * Includes affiliate code from localStorage if available
 */
export async function getOAuthState(): Promise<string | null> {
  try {
    let path = '/api/oauth/state'
    const affCode = localStorage.getItem('aff')
    if (affCode && affCode.length > 0) {
      path += `?aff=${affCode}`
    }
    const res = await api.get(path)
    if (res.data.success) {
      return res.data.data
    }
    return null
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to get OAuth state:', error)
    return null
  }
}

/**
 * Handle GitHub OAuth binding/login
 */
export async function handleGitHubOAuth(clientId: string): Promise<void> {
  const state = await getOAuthState()
  if (!state) return

  const url = buildGitHubOAuthUrl(clientId, state)
  window.open(url, '_blank')
}

/**
 * Handle LinuxDO OAuth binding/login
 */
export async function handleLinuxDOOAuth(clientId: string): Promise<void> {
  const state = await getOAuthState()
  if (!state) return

  const url = buildLinuxDOOAuthUrl(clientId, state)
  window.open(url, '_blank')
}
