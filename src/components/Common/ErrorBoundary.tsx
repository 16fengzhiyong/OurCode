import React, { Component, ErrorInfo, ReactNode } from 'react'
import { t } from '@/i18n'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="h-full flex items-center justify-center bg-nova-bg">
          <div className="text-center p-8 max-w-md">
            <div className="text-4xl mb-4">⚠️</div>
            <h2 className="text-lg font-semibold text-nova-text-primary mb-2">{t('error.title')}</h2>
            <p className="text-sm text-nova-text-muted mb-4 font-mono">
              {this.state.error?.message || t('error.unexpected')}
            </p>
            <button
              onClick={this.handleReset}
              className="px-4 py-2 bg-nova-accent text-white rounded-lg text-sm hover:opacity-90 transition-opacity"
            >
              {t('error.retry')}
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
