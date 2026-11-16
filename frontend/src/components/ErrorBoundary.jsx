import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'
import { tr } from '../i18n'

/** If a screen crashes, show a calm message with a way out instead of a blank page. Orders saved offline are not affected. */
export default class ErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(error) { console.error('Screen crashed:', error) } // eslint-disable-line no-console

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div role="alert" className="mx-auto mt-16 max-w-sm px-6 text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-amber-50 text-amber-600"><AlertTriangle className="h-8 w-8" /></div>
        <h2 className="text-xl font-extrabold tracking-tight">{tr('Something went wrong')}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{tr('This screen could not be shown. Your data and any orders saved offline are safe.')}</p>
        <div className="mt-6 grid gap-3">
          <button onClick={() => window.location.reload()} className="min-h-12 rounded-2xl bg-brand px-4 text-sm font-extrabold text-white shadow-card active:scale-[.98]">{tr('Reload the app')}</button>
          <a href="/" className="min-h-12 rounded-2xl bg-white px-4 py-3.5 text-sm font-bold text-ink ring-1 ring-line">{tr('Go to the start screen')}</a>
        </div>
      </div>
    )
  }
}
