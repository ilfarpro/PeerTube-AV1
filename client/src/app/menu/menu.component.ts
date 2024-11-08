import { CommonModule } from '@angular/common'
import { Component, OnDestroy, OnInit } from '@angular/core'
import { RouterLink, RouterLinkActive } from '@angular/router'
import {
  AuthService,
  AuthStatus,
  AuthUser,
  HooksService,
  MenuLink,
  MenuSection,
  MenuService,
  ServerService,
  UserService
} from '@app/core'
import { ActorAvatarComponent } from '@app/shared/shared-actor-image/actor-avatar.component'
import { InputSwitchComponent } from '@app/shared/shared-forms/input-switch.component'
import { GlobalIconComponent, GlobalIconName } from '@app/shared/shared-icons/global-icon.component'
import { ButtonComponent } from '@app/shared/shared-main/buttons/button.component'
import { LoginLinkComponent } from '@app/shared/shared-main/users/login-link.component'
import { SignupLabelComponent } from '@app/shared/shared-main/users/signup-label.component'
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap'
import { ServerConfig, UserRight } from '@peertube/peertube-models'
import debug from 'debug'
import { of, Subscription } from 'rxjs'
import { first, map, switchMap } from 'rxjs/operators'
import { LanguageChooserComponent } from './language-chooser.component'
import { NotificationDropdownComponent } from './notification-dropdown.component'
import { QuickSettingsModalComponent } from './quick-settings-modal.component'

const debugLogger = debug('peertube:menu:MenuComponent')

@Component({
  selector: 'my-menu',
  templateUrl: './menu.component.html',
  styleUrls: [ './menu.component.scss' ],
  standalone: true,
  imports: [
    CommonModule,
    NotificationDropdownComponent,
    ActorAvatarComponent,
    InputSwitchComponent,
    SignupLabelComponent,
    LoginLinkComponent,
    LanguageChooserComponent,
    QuickSettingsModalComponent,
    GlobalIconComponent,
    RouterLink,
    RouterLinkActive,
    NgbDropdownModule,
    ButtonComponent
  ]
})
export class MenuComponent implements OnInit, OnDestroy {
  menuSections: MenuSection[] = []

  private isLoggedIn: boolean
  private user: AuthUser
  private canSeeVideoMakerBlock: boolean

  private serverConfig: ServerConfig

  private authSub: Subscription

  constructor (
    private authService: AuthService,
    private userService: UserService,
    private serverService: ServerService,
    private hooks: HooksService,
    private menu: MenuService
  ) { }

  get shortDescription () {
    return this.serverConfig.instance.shortDescription
  }

  get collapsed () {
    return this.menu.isCollapsed()
  }

  ngOnInit () {
    this.isLoggedIn = this.authService.isLoggedIn()
    this.onUserStateChange()

    this.authSub = this.authService.loginChangedSource.subscribe(status => {
      if (status === AuthStatus.LoggedIn) this.isLoggedIn = true
      else if (status === AuthStatus.LoggedOut) this.isLoggedIn = false

      this.onUserStateChange()
    })

    this.serverService.getConfig()
      .subscribe(config => this.serverConfig = config)
  }

  ngOnDestroy () {
    if (this.authSub) this.authSub.unsubscribe()
  }

  // ---------------------------------------------------------------------------

  toggleMenu () {
    this.menu.toggleMenu()
  }

  // ---------------------------------------------------------------------------

  private async buildMenuSections () {
    this.menuSections = []

    for (const section of [ this.buildLibraryLinks(), this.buildVideoMakerLinks(), this.buildAdminLinks() ]) {
      if (section.links.length !== 0) {
        this.menuSections.push(section)
      }
    }

    this.menuSections = await this.hooks.wrapObject(this.menuSections, 'common', 'filter:left-menu.links.create.result')
  }

  private buildLibraryLinks (): MenuSection {
    let links: MenuLink[] = []

    if (this.isLoggedIn) {
      links = links.concat([
        {
          path: '/my-library/video-playlists',
          icon: 'playlists' as GlobalIconName,
          shortLabel: $localize`Playlists`,
          label: $localize`My Playlists`
        },
        {
          path: '/videos/subscriptions',
          icon: 'subscriptions' as GlobalIconName,
          shortLabel: $localize`Subscriptions`,
          label: $localize`My Subscriptions`
        },
        {
          path: '/my-library/history/videos',
          icon: 'history' as GlobalIconName,
          shortLabel: $localize`History`,
          label: $localize`My History`
        }
      ])
    }

    return {
      key: 'my-library',
      title: $localize`My library`,
      links
    }
  }

  private buildVideoMakerLinks (): MenuSection {
    let links: MenuLink[] = []

    if (this.isLoggedIn && this.canSeeVideoMakerBlock) {
      links = links.concat([
        {
          path: '/my-library/video-channels',
          icon: 'channel' as GlobalIconName,
          iconClass: 'channel-icon',
          shortLabel: $localize`Channels`,
          label: $localize`My channels`
        },

        {
          path: '/my-library/videos',
          icon: 'videos' as GlobalIconName,
          shortLabel: $localize`Videos`,
          label: $localize`My videos`
        },

        {
          path: '/videos/upload',
          icon: 'upload' as GlobalIconName,
          shortLabel: $localize`Publish`,
          label: $localize`Publish`,
          isPrimaryButton: true
        }
      ])
    }

    return {
      key: 'my-video-space',
      title: $localize`My video space`,
      links
    }
  }

  private buildAdminLinks (): MenuSection {
    const links: MenuLink[] = []

    if (this.isLoggedIn) {
      if (this.user.hasRight(UserRight.SEE_ALL_VIDEOS)) {
        links.push({
          path: '/admin/videos/list',
          icon: 'overview' as GlobalIconName,
          shortLabel: $localize`Overview`,
          label: $localize`Overview`
        })
      }

      if (this.user.hasRight(UserRight.MANAGE_ABUSES)) {
        links.push({
          path: '/admin/moderation/abuses/list',
          icon: 'moderation' as GlobalIconName,
          shortLabel: $localize`Moderation`,
          label: $localize`Moderation`
        })
      }

      if (this.user.hasRight(UserRight.MANAGE_CONFIGURATION)) {
        links.push({
          path: '/admin/config/edit-custom',
          icon: 'config' as GlobalIconName,
          shortLabel: $localize`Advanced parameters`,
          label: $localize`Advanced parameters`
        })
      }
    }

    return {
      key: 'admin',
      title: $localize`Administration`,
      links
    }
  }

  // ---------------------------------------------------------------------------

  private computeCanSeeVideoMakerBlock () {
    if (!this.isLoggedIn) return of(false)
    if (!this.user.hasUploadDisabled()) return of(true)

    return this.authService.userInformationLoaded
      .pipe(
        first(),
        switchMap(() => this.userService.getMyVideoQuotaUsed()),
        map(({ videoQuotaUsed }) => {
          // User already uploaded videos, so it can see the link
          if (videoQuotaUsed !== 0) return true

          // No videos, no upload so the user don't need to see the videos link
          return false
        })
      )
  }

  private onUserStateChange () {
    this.user = this.isLoggedIn
      ? this.authService.getUser()
      : undefined

    this.computeCanSeeVideoMakerBlock()
      .subscribe(res => {
        this.canSeeVideoMakerBlock = res

        if (this.canSeeVideoMakerBlock) debugLogger('User can see videos link.')
        else debugLogger('User cannot see videos link.')

        this.buildMenuSections()
      })
  }
}
