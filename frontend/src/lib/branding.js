// Applies a company's identity to the browser: tab title, favicon, home-screen icon and its own PWA
// manifest (so each company installs as a separate app with its own name and icon).
// Colours are NOT tenant-specific: the whole product uses one global theme (Ivory / Teal / Coral),
// tenants only customise their name and logo/icon.
const API = import.meta.env.VITE_API_URL || '/api'
export const THEME_COLOR = '#17645F'
const DEFAULT = { manifest: '/manifest.webmanifest', favicon: '/favicon.svg', apple: '/icon-192.png', title: 'Hotel SaaS' }

function link(rel, href, type) {
  let el = document.querySelector(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
  if (type) el.type = type
  else el.removeAttribute('type')
}

export function applyBrand(company, suffix = '') {
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_COLOR)
  document.title = company?.name ? `${company.name}${suffix}` : DEFAULT.title

  if (company?.slug) {
    link('manifest', `${API}/public/manifest/${company.slug}.webmanifest`)
    link('icon', company.icon_url || company.logo_url || DEFAULT.favicon, company.icon_url ? 'image/png' : undefined)
    link('apple-touch-icon', company.icon_url || DEFAULT.apple)
    document.querySelector('meta[name=apple-mobile-web-app-title]')?.setAttribute('content', company.name)
  } else {
    link('manifest', DEFAULT.manifest)
    link('icon', DEFAULT.favicon, 'image/svg+xml')
    link('apple-touch-icon', DEFAULT.apple)
  }
}
