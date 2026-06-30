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
import { useEffect, useMemo } from 'react'
import { Mail, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SiGithub, SiWechat, SiLinux } from 'react-icons/si'
import { handleGitHubOAuth, handleLinuxDOOAuth } from '@/lib/oauth'
import { useDialogs } from '@/hooks/use-dialog'
import { useStatus } from '@/hooks/use-status'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { OAUTH_BIND_STORAGE_KEY } from '@/features/auth/constants'
import type { UserProfile, BindingItem } from '../../types'
import { EmailBindDialog } from '../dialogs/email-bind-dialog'
import { TelegramBindDialog } from '../dialogs/telegram-bind-dialog'
import { WeChatBindDialog } from '../dialogs/wechat-bind-dialog'

// ============================================================================
// Account Bindings Tab Component
// ============================================================================

interface AccountBindingsTabProps {
  profile: UserProfile | null
  onUpdate: () => void
}

type DialogKey = 'email' | 'wechat' | 'telegram'

export function AccountBindingsTab({
  profile,
  onUpdate,
}: AccountBindingsTabProps) {
  const { t } = useTranslation()
  const dialogs = useDialogs<DialogKey>()
  const { status, loading } = useStatus()

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== OAUTH_BIND_STORAGE_KEY || !event.newValue) return
      try {
        const payload = JSON.parse(event.newValue) as {
          status?: string
          provider?: string
          timestamp?: number
        }
        if (payload?.status === 'success') {
          onUpdate()
        }
      } catch {
        // ignore malformed payloads
      }
      try {
        window.localStorage.removeItem(OAUTH_BIND_STORAGE_KEY)
      } catch {
        // ignore cleanup failure
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [onUpdate])

  // Memoize bindings to prevent unnecessary recalculations
  const bindings: BindingItem[] = useMemo(() => {
    if (!profile || !status) return []

    return [
      {
        id: 'email',
        label: t('Email'),
        icon: Mail,
        value: profile.email,
        isBound: Boolean(profile.email),
        isEnabled: true,
        onBind: () => dialogs.open('email'),
      },
      {
        id: 'wechat',
        label: t('WeChat'),
        icon: SiWechat as React.ComponentType<{ className?: string }>,
        value: undefined,
        isBound: Boolean(
          (profile as unknown as Record<string, unknown>).wechat_id
        ),
        isEnabled: status?.wechat_login || false,
        onBind: () => dialogs.open('wechat'),
      },
      {
        id: 'github',
        label: t('GitHub'),
        icon: SiGithub,
        value: (profile as unknown as Record<string, unknown>).github_id as
          | string
          | undefined,
        isBound: Boolean(
          (profile as unknown as Record<string, unknown>).github_id
        ),
        isEnabled: status?.github_oauth || false,
        onBind: () => {
          if (status?.github_client_id) {
            handleGitHubOAuth(status.github_client_id)
          }
        },
      },
      {
        id: 'telegram',
        label: t('Telegram'),
        icon: Send,
        value: (profile as unknown as Record<string, unknown>).telegram_id as
          | string
          | undefined,
        isBound: Boolean(
          (profile as unknown as Record<string, unknown>).telegram_id
        ),
        isEnabled: status?.telegram_oauth || false,
        onBind: () => dialogs.open('telegram'),
      },
      {
        id: 'linuxdo',
        label: t('LinuxDO'),
        icon: SiLinux as React.ComponentType<{ className?: string }>,
        value: (profile as unknown as Record<string, unknown>).linux_do_id as
          | string
          | undefined,
        isBound: Boolean(
          (profile as unknown as Record<string, unknown>).linux_do_id
        ),
        isEnabled: status?.linuxdo_oauth || false,
        onBind: () => {
          if (status?.linuxdo_client_id) {
            handleLinuxDOOAuth(status.linuxdo_client_id)
          }
        },
      },
    ].filter((binding) => binding.isEnabled)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, status, t])

  if (!profile || loading) return null

  return (
    <>
      <div className='grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3'>
        {bindings.map((binding) => (
          <div
            key={binding.id}
            className='flex items-center justify-between gap-2.5 rounded-lg border p-2.5 sm:gap-3 sm:p-3'
          >
            <div className='flex min-w-0 items-center gap-2.5 sm:gap-3'>
              <div className='bg-muted shrink-0 rounded-md p-1.5 sm:p-2'>
                <binding.icon className='h-4 w-4' />
              </div>
              <div className='min-w-0'>
                <div className='flex items-center gap-1.5'>
                  <p className='text-sm font-medium'>{binding.label}</p>
                  {binding.isBound && (
                    <StatusBadge
                      label={t('Bound')}
                      variant='success'
                      copyable={false}
                    />
                  )}
                </div>
                <p className='text-muted-foreground truncate text-xs'>
                  {binding.value || t('Not bound')}
                </p>
              </div>
            </div>
            <Button
              variant='outline'
              size='sm'
              className='h-7 shrink-0 px-2.5 text-xs'
              onClick={binding.onBind}
              disabled={binding.isBound && binding.id !== 'email'}
            >
              {binding.isBound
                ? binding.id === 'email'
                  ? t('Change')
                  : t('Bound')
                : t('Bind')}
            </Button>
          </div>
        ))}
      </div>

      {/* Email Bind Dialog */}
      <EmailBindDialog
        open={dialogs.isOpen('email')}
        onOpenChange={(open) =>
          open ? dialogs.open('email') : dialogs.close('email')
        }
        currentEmail={profile.email}
        onSuccess={onUpdate}
      />

      {/* WeChat Bind Dialog */}
      <WeChatBindDialog
        open={dialogs.isOpen('wechat')}
        onOpenChange={(open) =>
          open ? dialogs.open('wechat') : dialogs.close('wechat')
        }
        onSuccess={onUpdate}
      />

      {/* Telegram Bind Dialog */}
      {status?.telegram_bot_name && (
        <TelegramBindDialog
          open={dialogs.isOpen('telegram')}
          onOpenChange={(open) =>
            open ? dialogs.open('telegram') : dialogs.close('telegram')
          }
          botName={status.telegram_bot_name as string}
          onSuccess={onUpdate}
        />
      )}
    </>
  )
}
