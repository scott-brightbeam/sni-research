import { Component } from 'react'
import './ErrorBoundary.css'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error)
    console.error('[ErrorBoundary] Component stack:', errorInfo?.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-icon">{'\u26A0'}</div>
          <div className="error-boundary-title">Something went wrong</div>
          <div className="error-boundary-detail">
            {this.state.error?.message || 'An unexpected error occurred while rendering this page.'}
          </div>
          <div className="error-boundary-actions">
            <button className="btn btn-ghost btn-md" onClick={this.handleReset}>
              Try again
            </button>
            <button className="btn btn-primary btn-md" onClick={this.handleReload}>
              Reload page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
