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
import { useMemo } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'

const requestLoggingSchema = z.object({
  request_log_setting: z.object({
    enabled: z.boolean(),
    ip_source: z.enum(['auto', 'real']),
    cdn_real_ip_header: z.string(),
    record_user_agent: z.boolean(),
  }),
})

type RequestLoggingFormValues = z.infer<typeof requestLoggingSchema>

type FlatRequestLoggingDefaults = {
  'request_log_setting.enabled': boolean
  'request_log_setting.ip_source': string
  'request_log_setting.cdn_real_ip_header': string
  'request_log_setting.record_user_agent': boolean
}

type RequestLoggingSectionProps = {
  defaultValues: FlatRequestLoggingDefaults
}

const buildFormDefaults = (
  d: FlatRequestLoggingDefaults
): RequestLoggingFormValues => ({
  request_log_setting: {
    enabled: d['request_log_setting.enabled'],
    ip_source: d['request_log_setting.ip_source'] === 'real' ? 'real' : 'auto',
    cdn_real_ip_header: d['request_log_setting.cdn_real_ip_header'] ?? '',
    record_user_agent: d['request_log_setting.record_user_agent'],
  },
})

const normalizeDefaults = (
  d: FlatRequestLoggingDefaults
): FlatRequestLoggingDefaults => ({
  'request_log_setting.enabled': d['request_log_setting.enabled'],
  'request_log_setting.ip_source':
    d['request_log_setting.ip_source'] === 'real' ? 'real' : 'auto',
  'request_log_setting.cdn_real_ip_header': (
    d['request_log_setting.cdn_real_ip_header'] ?? ''
  ).trim(),
  'request_log_setting.record_user_agent':
    d['request_log_setting.record_user_agent'],
})

const normalizeFormValues = (
  v: RequestLoggingFormValues
): FlatRequestLoggingDefaults => ({
  'request_log_setting.enabled': v.request_log_setting.enabled,
  'request_log_setting.ip_source': v.request_log_setting.ip_source,
  'request_log_setting.cdn_real_ip_header':
    v.request_log_setting.cdn_real_ip_header.trim(),
  'request_log_setting.record_user_agent':
    v.request_log_setting.record_user_agent,
})

export function RequestLoggingSection({
  defaultValues,
}: RequestLoggingSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )

  const form = useForm<RequestLoggingFormValues>({
    resolver: zodResolver(requestLoggingSchema),
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)

  const onSubmit = async (values: RequestLoggingFormValues) => {
    const normalized = normalizeFormValues(values)
    const baseline = normalizeDefaults(defaultValues)
    const updates = (
      Object.keys(normalized) as Array<keyof FlatRequestLoggingDefaults>
    ).filter((key) => normalized[key] !== baseline[key])

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of updates) {
      await updateOption.mutateAsync({ key, value: normalized[key] })
    }
  }

  return (
    <SettingsSection title={t('Request IP Logging')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />

          <FormField
            control={form.control}
            name='request_log_setting.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Record request IP and User-Agent')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Store the client IP and User-Agent on consumption and error logs. Applies to all users in addition to any per-user setting.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='request_log_setting.record_user_agent'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Record User-Agent')}</FormLabel>
                  <FormDescription>
                    {t('Also capture the User-Agent header when logging IP.')}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='request_log_setting.ip_source'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('IP source')}</FormLabel>
                <Select
                  items={[
                    { value: 'auto', label: t('Trust proxy headers') },
                    { value: 'real', label: t('Real network (direct)') },
                  ]}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger className='w-full md:w-[280px]'>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value='auto'>
                        {t('Trust proxy headers')}
                      </SelectItem>
                      <SelectItem value='real'>
                        {t('Real network (direct)')}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormDescription>
                  {t(
                    'Auto resolves the client via X-Forwarded-For / X-Real-IP (behind a reverse proxy). Real uses the direct TCP connection and ignores forwarded headers.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='request_log_setting.cdn_real_ip_header'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('CDN real-IP header')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder='CF-Connecting-IP'
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                    className='w-full md:w-[280px]'
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Optional. If your site sits behind a CDN, set the header carrying the real client IP (e.g. CF-Connecting-IP). The real client is logged as the source and the CDN edge is marked separately. Leave empty if you do not use a CDN.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
