import { Injectable } from '@angular/core'
import { logger } from '@root-helpers/logger'
import { capitalizeFirstLetter } from '@root-helpers/string'
import { UserLocalStorageKeys } from '@root-helpers/users'
import { HTMLServerConfig, ServerConfigTheme } from '@peertube/peertube-models'
import { environment } from '../../../environments/environment'
import { AuthService } from '../auth'
import { PluginService } from '../plugins/plugin.service'
import { ServerService } from '../server'
import { UserService } from '../users/user.service'
import { LocalStorageService } from '../wrappers/storage.service'
import { darken, lighten, format, parse, blend } from 'color-bits'

@Injectable()
export class ThemeService {
  private oldInjectedProperties: string[] = []
  private oldThemeName: string

  private themes: ServerConfigTheme[] = []

  private themeFromLocalStorage: ServerConfigTheme
  private themeDOMLinksFromLocalStorage: HTMLLinkElement[] = []

  private serverConfig: HTMLServerConfig

  constructor (
    private auth: AuthService,
    private userService: UserService,
    private pluginService: PluginService,
    private server: ServerService,
    private localStorageService: LocalStorageService
  ) {}

  initialize () {
    // Try to load from local storage first, so we don't have to wait network requests
    this.loadAndSetFromLocalStorage()

    this.serverConfig = this.server.getHTMLConfig()
    const themes = this.serverConfig.theme.registered

    this.removeThemeFromLocalStorageIfNeeded(themes)
    this.injectThemes(themes)

    this.listenUserTheme()
  }

  getDefaultThemeLabel () {
    if (this.hasDarkTheme()) {
      return $localize`Light/Orange or Dark`
    }

    return $localize`Light/Orange`
  }

  buildAvailableThemes () {
    return this.serverConfig.theme.registered
               .map(t => ({ id: t.name, label: capitalizeFirstLetter(t.name) }))
  }

  private injectThemes (themes: ServerConfigTheme[], fromLocalStorage = false) {
    this.themes = themes

    logger.info(`Injecting ${this.themes.length} themes.`)

    const head = this.getHeadElement()

    for (const theme of this.themes) {
      // Already added this theme?
      if (fromLocalStorage === false && this.themeFromLocalStorage && this.themeFromLocalStorage.name === theme.name) continue

      for (const css of theme.css) {
        const link = document.createElement('link')

        const href = environment.apiUrl + `/themes/${theme.name}/${theme.version}/css/${css}`
        link.setAttribute('href', href)
        link.setAttribute('rel', 'alternate stylesheet')
        link.setAttribute('type', 'text/css')
        link.setAttribute('title', theme.name)
        link.setAttribute('disabled', '')

        if (fromLocalStorage === true) this.themeDOMLinksFromLocalStorage.push(link)

        head.appendChild(link)
      }
    }
  }

  private getCurrentTheme () {
    if (this.themeFromLocalStorage) return this.themeFromLocalStorage.name

    const theme = this.auth.isLoggedIn()
      ? this.auth.getUser().theme
      : this.userService.getAnonymousUser().theme

    if (theme !== 'instance-default') return theme

    const instanceTheme = this.serverConfig.theme.default
    if (instanceTheme !== 'default') return instanceTheme

    // Default to dark theme if available and wanted by the user
    if (this.hasDarkTheme() && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }

    return instanceTheme
  }

  private loadThemeStyle (name: string) {
    const links = document.getElementsByTagName('link')
    for (let i = 0; i < links.length; i++) {
      const link = links[i]
      if (link.getAttribute('rel').includes('style') && link.getAttribute('title')) {
        link.disabled = link.getAttribute('title') !== name
      }
    }
  }

  private updateCurrentTheme () {
    if (this.oldThemeName) this.removeThemePlugins(this.oldThemeName)

    const currentTheme = this.getCurrentTheme()

    logger.info(`Enabling ${currentTheme} theme.`)

    this.loadThemeStyle(currentTheme)

    const theme = this.getTheme(currentTheme)
    if (theme) {
      logger.info(`Adding scripts of theme ${currentTheme}`)

      this.pluginService.addPlugin(theme, true)

      this.pluginService.reloadLoadedScopes()

      this.localStorageService.setItem(UserLocalStorageKeys.LAST_ACTIVE_THEME, JSON.stringify(theme), false)
    } else {
      this.localStorageService.removeItem(UserLocalStorageKeys.LAST_ACTIVE_THEME, false)
    }

    this.injectColorPalette()

    this.oldThemeName = currentTheme
  }

  private injectColorPalette () {
    const style = document.body.style
    const computedStyle = getComputedStyle(document.body)

    // FIXME: Remove previously injected properties
    for (const property of this.oldInjectedProperties) {
      style.removeProperty(property)
    }

    this.oldInjectedProperties = []

    const lightenRatios = [
      { suffix: 100, value: 0.8 },
      { suffix: 200, value: 0.6 },
      { suffix: 300, value: 0.4 },
      { suffix: 400, value: 0.2 },
      { suffix: 500, value: 0 }
    ]

    const darkenRatios = [
      { suffix: 600, value: 0.2 },
      { suffix: 700, value: 0.4 },
      { suffix: 800, value: 0.6 },
      { suffix: 900, value: 0.8 }
    ]

    for (const prefix of [ 'primary', 'secondary' ]) {
      const mainColor = computedStyle.getPropertyValue('--' + prefix)

      if (!mainColor) {
        console.error(`Cannot create palette of unexisting "--${prefix}" CSS body variable`)
        continue
      }

      const mainColorParsed = parse(mainColor)
      for (const { ratios, color } of [ { ratios: lightenRatios, color: parse('#fff') }, { ratios: darkenRatios, color: parse('#000') } ]) {
        for (const ratio of ratios) {
          const key = `--${prefix}-${ratio.suffix}`

          if (!computedStyle.getPropertyValue(key)) {
            style.setProperty(key, format(blend(mainColorParsed, color, ratio.value)))
            this.oldInjectedProperties.push(key)
          }
        }
      }
    }
  }

  private listenUserTheme () {
    // We don't need them anymore
    this.themeFromLocalStorage = undefined
    this.themeDOMLinksFromLocalStorage = []

    if (!this.auth.isLoggedIn()) {
      this.updateCurrentTheme()

      this.localStorageService.watch([ UserLocalStorageKeys.THEME ]).subscribe(
        () => this.updateCurrentTheme()
      )
    }

    this.auth.userInformationLoaded
      .subscribe(() => this.updateCurrentTheme())
  }

  private loadAndSetFromLocalStorage () {
    const lastActiveThemeString = this.localStorageService.getItem(UserLocalStorageKeys.LAST_ACTIVE_THEME)
    if (!lastActiveThemeString) return

    try {
      const lastActiveTheme = JSON.parse(lastActiveThemeString)
      this.themeFromLocalStorage = lastActiveTheme

      this.injectThemes([ lastActiveTheme ], true)
      this.updateCurrentTheme()
    } catch (err) {
      logger.error('Cannot parse last active theme.', err)
      return
    }
  }

  private removeThemePlugins (themeName: string) {
    const oldTheme = this.getTheme(themeName)
    if (oldTheme) {
      logger.info(`Removing scripts of old theme ${themeName}.`)
      this.pluginService.removePlugin(oldTheme)
    }
  }

  private removeThemeFromLocalStorageIfNeeded (themes: ServerConfigTheme[]) {
    if (!this.themeFromLocalStorage) return

    const loadedTheme = themes.find(t => t.name === this.themeFromLocalStorage.name)
    if (!loadedTheme || loadedTheme.version !== this.themeFromLocalStorage.version) {
      // Need to remove this theme: we loaded an old version or a theme that does not exist anymore
      this.removeThemePlugins(this.themeFromLocalStorage.name)
      this.oldThemeName = undefined

      const head = this.getHeadElement()
      for (const htmlLinkElement of this.themeDOMLinksFromLocalStorage) {
        head.removeChild(htmlLinkElement)
      }

      this.themeFromLocalStorage = undefined
      this.themeDOMLinksFromLocalStorage = []
    }
  }

  private getHeadElement () {
    return document.getElementsByTagName('head')[0]
  }

  private getTheme (name: string) {
    return this.themes.find(t => t.name === name)
  }

  private hasDarkTheme () {
    return this.serverConfig.theme.registered.some(t => t.name === 'dark')
  }
}
