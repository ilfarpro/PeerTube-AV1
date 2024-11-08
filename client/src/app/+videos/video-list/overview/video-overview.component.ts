import { CommonModule } from '@angular/common'
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core'
import { RouterLink } from '@angular/router'
import { DisableForReuseHook, Notifier, User, UserService } from '@app/core'
import { ButtonComponent } from '@app/shared/shared-main/buttons/button.component'
import { Video } from '@app/shared/shared-main/video/video.model'
import { Subject, Subscription, switchMap } from 'rxjs'
import { InfiniteScrollerDirective } from '../../../shared/shared-main/common/infinite-scroller.directive'
import { VideoMiniatureComponent } from '../../../shared/shared-video-miniature/video-miniature.component'
import { OverviewService } from './overview.service'

@Component({
  selector: 'my-video-overview',
  templateUrl: './video-overview.component.html',
  styleUrls: [ './video-overview.component.scss' ],
  standalone: true,
  imports: [
    InfiniteScrollerDirective,
    RouterLink,
    VideoMiniatureComponent,
    ButtonComponent,
    CommonModule
  ]
})
export class VideoOverviewComponent implements OnInit, OnDestroy, DisableForReuseHook {
  @ViewChild('quickAccessContent') quickAccessContent: ElementRef

  onDataSubject = new Subject<any>()

  notResults = false

  userMiniature: User

  objects: {
    label: string

    type: string
    buttonLabel: string
    videos: Video[]

    queryParams: Record<string, any>
    routerLink: string[]
  }[] = []

  quickAccessLinks: typeof this.objects = []
  seeAllQuickLinks = false
  quickAccessOverflow = false

  disabled = false

  private loaded = false
  private currentPage = 1
  private maxPage = 20
  private lastWasEmpty = false
  private isLoading = false

  private userSub: Subscription

  constructor (
    private notifier: Notifier,
    private userService: UserService,
    private overviewService: OverviewService
  ) { }

  ngOnInit () {
    this.loadMoreResults()

    this.userService.getAnonymousOrLoggedUser()
      .subscribe(user => this.userMiniature = user)

    this.userSub = this.userService.listenAnonymousUpdate()
      .pipe(switchMap(() => this.userService.getAnonymousOrLoggedUser()))
      .subscribe(user => {
        this.userMiniature = user

        this.objects = []
        this.loadMoreResults()
      })
  }

  ngOnDestroy () {
    if (this.userSub) this.userSub.unsubscribe()
  }

  disableForReuse () {
    this.disabled = true
  }

  enabledForReuse () {
    this.disabled = false
  }

  onNearOfBottom () {
    if (this.currentPage >= this.maxPage) return
    if (this.lastWasEmpty) return
    if (this.isLoading) return
    if (this.disabled) return

    this.currentPage++
    this.loadMoreResults()
  }

  private loadMoreResults () {
    this.isLoading = true

    this.overviewService.getVideosOverview(this.currentPage)
        .subscribe({
          next: overview => {
            this.isLoading = false

            if (overview.tags.length === 0 && overview.channels.length === 0 && overview.categories.length === 0) {
              this.lastWasEmpty = true
              if (this.loaded === false) this.notResults = true

              return
            }

            this.loaded = true
            this.onDataSubject.next(overview)

            for (const value of overview.categories) {
              this.objects.push({
                buttonLabel: $localize`Browse "${value.category.label}" videos`,
                label: value.category.label,
                routerLink: [ '/search' ],
                queryParams: { categoryOneOf: [ value.category.id ] },
                videos: value.videos,
                type: $localize`category`
              })
            }

            for (const value of overview.tags) {
              this.objects.push({
                buttonLabel: $localize`Browse "#${value.tag}" videos`,
                label: `#${value.tag}`,
                routerLink: [ '/search' ],
                queryParams: { tagsOneOf: [ value.tag ] },
                videos: value.videos,
                type: $localize`tag`
              })
            }

            for (const value of overview.channels) {
              this.objects.push({
                buttonLabel: $localize`View the channel`,
                label: value.videos[0].byVideoChannel,
                routerLink: [ '/c', value.videos[0].byVideoChannel ],
                queryParams: {},
                videos: value.videos,
                type: $localize`channel`
              })
            }

            this.quickAccessLinks = this.objects.map(o => o)

            setTimeout(() => {
              if (this.quickAccessOverflow) return

              const el = this.quickAccessContent.nativeElement as HTMLElement
              this.quickAccessOverflow = el.scrollWidth > el.clientWidth
            })
          },

          error: err => {
            this.notifier.error(err.message)
            this.isLoading = false
          }
        })
  }
}
