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
/* eslint-disable react-refresh/only-export-components */
'use client'

import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  useContext,
  useEffect,
  useState,
} from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { ShikiTransformer } from 'shiki/core'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// Languages actually rendered by code samples in the app. Kept intentionally
// small: a fine-grained highlighter only loads these grammars instead of
// shiki's full web bundle (~40 grammars + every theme + the oniguruma WASM).
export type CodeLanguage =
  | 'bash'
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'json'

const SUPPORTED_LANGUAGES: readonly CodeLanguage[] = [
  'bash',
  'javascript',
  'typescript',
  'python',
  'json',
]

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string
  language: CodeLanguage
  showLineNumbers?: boolean
}

type CodeBlockContextType = {
  code: string
}

const CodeBlockContext = createContext<CodeBlockContextType>({
  code: '',
})

const lineNumberTransformer: ShikiTransformer = {
  name: 'line-numbers',
  line(node, line) {
    node.children.unshift({
      type: 'element',
      tagName: 'span',
      properties: {
        className: [
          'inline-block',
          'min-w-10',
          'mr-4',
          'text-right',
          'select-none',
          'text-muted-foreground',
        ],
      },
      children: [{ type: 'text', value: String(line) }],
    })
  },
}

// Fine-grained highlighter built once on first use. Grammars/themes stay out of
// the initial bundle (loaded via dynamic import here) and the JS regex engine
// avoids pulling shiki's ~3.6MB oniguruma WASM.
let highlighterPromise: Promise<HighlighterCore> | null = null

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      engine: createJavaScriptRegexEngine({ forgiving: true }),
      themes: [
        import('shiki/themes/one-light.mjs'),
        import('shiki/themes/one-dark-pro.mjs'),
      ],
      langs: [
        import('shiki/langs/bash.mjs'),
        import('shiki/langs/javascript.mjs'),
        import('shiki/langs/typescript.mjs'),
        import('shiki/langs/python.mjs'),
        import('shiki/langs/json.mjs'),
      ],
    })
  }
  return highlighterPromise
}

export async function highlightCode(
  code: string,
  language: CodeLanguage,
  showLineNumbers = false
) {
  const highlighter = await getHighlighter()
  const transformers: ShikiTransformer[] = showLineNumbers
    ? [lineNumberTransformer]
    : []
  const lang = SUPPORTED_LANGUAGES.includes(language) ? language : 'text'

  return highlighter.codeToHtml(code, {
    lang,
    themes: {
      light: 'one-light',
      dark: 'one-dark-pro',
    },
    transformers,
  })
}

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const [html, setHtml] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    highlightCode(code, language, showLineNumbers).then((next) => {
      if (!cancelled) {
        setHtml(next)
      }
    })
    return () => {
      cancelled = true
    }
  }, [code, language, showLineNumbers])

  return (
    <CodeBlockContext.Provider value={{ code }}>
      <div
        className={cn(
          'group bg-background text-foreground relative w-full overflow-hidden rounded-md border',
          className
        )}
        {...props}
      >
        <div className='relative'>
          <div
            className='[&>pre]:bg-background! [&>pre]:text-foreground! overflow-hidden [&_code]:font-mono [&_code]:text-sm [&>pre]:m-0 [&>pre]:p-4 [&>pre]:text-sm'
            // biome-ignore lint/security/noDangerouslySetInnerHtml: "this is needed."
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {children && (
            <div className='absolute top-2 right-2 flex items-center gap-2'>
              {children}
            </div>
          )}
        </div>
      </div>
    </CodeBlockContext.Provider>
  )
}

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
}

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false)
  const { code } = useContext(CodeBlockContext)

  const copyToClipboard = async () => {
    if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) {
      onError?.(new Error('Clipboard API not available'))
      return
    }

    try {
      await navigator.clipboard.writeText(code)
      setIsCopied(true)
      onCopy?.()
      setTimeout(() => setIsCopied(false), timeout)
    } catch (error) {
      onError?.(error as Error)
    }
  }

  const Icon = isCopied ? CheckIcon : CopyIcon

  return (
    <Button
      className={cn('shrink-0', className)}
      onClick={copyToClipboard}
      size='icon'
      variant='ghost'
      {...props}
    >
      {children ?? <Icon size={14} />}
    </Button>
  )
}
