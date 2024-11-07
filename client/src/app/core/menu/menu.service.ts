import { Injectable } from '@angular/core'
import { fromEvent } from 'rxjs'
import { debounceTime } from 'rxjs/operators'
import { LocalStorageService, ScreenService } from '../wrappers'

@Injectable()
export class MenuService {
  private static LS_MENU_COLLAPSED = 'menu-collapsed'

  private menuCollapsed = false
  private menuChangedByUser = false

  constructor (
    private screenService: ScreenService,
    private localStorageService: LocalStorageService
  ) {
    // Do not display menu on small or touch screens
    if (this.screenService.isInSmallView() || this.screenService.isInTouchScreen()) {
      this.setMenuCollapsed(true)
    }

    this.handleWindowResize()

    this.menuCollapsed = this.localStorageService.getItem(MenuService.LS_MENU_COLLAPSED) === 'true'
    this.menuChangedByUser = this.menuCollapsed
  }

  isMenuCollapsed () {
    return this.menuCollapsed
  }

  toggleMenu () {
    this.setMenuCollapsed(!this.menuCollapsed)
    this.menuChangedByUser = true

    this.localStorageService.setItem(MenuService.LS_MENU_COLLAPSED, this.menuCollapsed + '')
  }

  isCollapsed () {
    return this.menuCollapsed
  }

  setMenuCollapsed (collapsed: boolean) {
    this.menuCollapsed = collapsed

    if (!this.screenService.isInTouchScreen()) return

    // On touch screens, lock body scroll and display content overlay when memu is opened
    if (!this.menuCollapsed) {
      document.body.classList.add('menu-open')
      this.screenService.onFingerSwipe('left', () => this.setMenuCollapsed(true))
      return
    }

    document.body.classList.remove('menu-open')
  }

  onResize () {
    if (this.screenService.isInSmallView() && !this.menuChangedByUser) {
      this.menuCollapsed = true
    }
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
