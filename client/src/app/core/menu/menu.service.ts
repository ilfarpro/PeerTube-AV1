import { fromEvent } from 'rxjs'
import { debounceTime } from 'rxjs/operators'
import { Injectable } from '@angular/core'
import { GlobalIconName } from '@app/shared/shared-icons/global-icon.component'
import { HTMLServerConfig } from '@peertube/peertube-models'
import { LocalStorageService, ScreenService } from '../wrappers'

export type MenuLink = {
  icon: GlobalIconName
  iconClass?: string

  label: string
  // Used by the left menu for example
  shortLabel: string

  path: string

  isPrimaryButton?: boolean // default false
}

export type MenuSection = {
  key: string
  title: string
  links: MenuLink[]
}

@Injectable()
export class MenuService {
  private static LS_MENU_COLLAPSED = 'menu-collapsed'

  isMenuCollapsed = false
  isMenuChangedByUser = false

  constructor (
    private screenService: ScreenService,
    private localStorageService: LocalStorageService
  ) {
    // Do not display menu on small or touch screens
    if (this.screenService.isInSmallView() || this.screenService.isInTouchScreen()) {
      this.setMenuCollapsed(true)
    }

    this.handleWindowResize()

    this.isMenuCollapsed = this.localStorageService.getItem(MenuService.LS_MENU_COLLAPSED) === 'true'
  }

  toggleMenu () {
    this.setMenuCollapsed(!this.isMenuCollapsed)
    this.isMenuChangedByUser = true

    this.localStorageService.setItem(MenuService.LS_MENU_COLLAPSED, this.isMenuCollapsed + '')
  }

  isCollapsed () {
    return this.isMenuCollapsed
  }

  setMenuCollapsed (collapsed: boolean) {
    this.isMenuCollapsed = collapsed

    if (!this.screenService.isInTouchScreen()) return

    // On touch screens, lock body scroll and display content overlay when memu is opened
    if (!this.isMenuCollapsed) {
      document.body.classList.add('menu-open')
      this.screenService.onFingerSwipe('left', () => this.setMenuCollapsed(true))
      return
    }

    document.body.classList.remove('menu-open')
  }

  onResize () {
    this.isMenuCollapsed = window.innerWidth < 800 && !this.isMenuChangedByUser
  }

  // ---------------------------------------------------------------------------

  private handleWindowResize () {
    // On touch screens, do not handle window resize event since opened menu is handled with a content overlay
    if (this.screenService.isInTouchScreen()) return

    fromEvent(window, 'resize')
      .pipe(debounceTime(200))
      .subscribe(() => this.onResize())
  }
}
