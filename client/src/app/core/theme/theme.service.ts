import { Injectable } from '@angular/core'
import { HTMLServerConfig, ServerConfigTheme } from '@peertube/peertube-models'
import { logger } from '@root-helpers/logger'
import { capitalizeFirstLetter } from '@root-helpers/string'
import { UserLocalStorageKeys } from '@root-helpers/users'
import { format, parse, toHSLA } from 'color-bits'
import debug from 'debug'
import { environment } from '../../../environments/environment'
import { AuthService } from '../auth'
import { PluginService } from '../plugins/plugin.service'
import { ServerService } from '../server'
import { UserService } from '../users/user.service'
import { LocalStorageService } from '../wrappers/storage.service'

const debugLogger = debug('peertube:theme')

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
    const rootStyle = document.body.style
    const computedStyle = getComputedStyle(document.body)

    // FIXME: Remove previously injected properties
    for (const property of this.oldInjectedProperties) {
      rootStyle.removeProperty(property)
    }

    this.oldInjectedProperties = []

    for (const prefix of [ 'primary', 'secondary', 'main-fg' ]) {
      const mainColor = computedStyle.getPropertyValue('--' + prefix)

      if (!mainColor) {
        console.error(`Cannot create palette of unexisting "--${prefix}" CSS body variable`)
        continue
      }

      const mainColorParsed = parse(mainColor)
      const mainColorHSL = toHSLA(mainColorParsed)

      for (let i = -8; i <= 8; i++) {
        const suffix = 500 + (50 * i)
        const key = `--${prefix}-${suffix}`

        if (!computedStyle.getPropertyValue(key)) {
          const newLuminance = Math.max(Math.min(100, Math.round(mainColorHSL.l + (i * 5 * -1))), 0)
          const newColor = `hsl(${Math.round(mainColorHSL.h)} ${Math.round(mainColorHSL.s)}% ${newLuminance}% / ${mainColorHSL.a})`

          rootStyle.setProperty(key, newColor)
          this.oldInjectedProperties.push(key)

          debugLogger(`Injected theme palette ${key} -> ${newColor}`)
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
