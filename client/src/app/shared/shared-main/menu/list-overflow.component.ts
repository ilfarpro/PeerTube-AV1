import { NgClass, NgFor, NgIf, NgTemplateOutlet, SlicePipe } from '@angular/common'
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  QueryList,
  TemplateRef,
  ViewChild,
  ViewChildren
} from '@angular/core'
import { RouterLink, RouterLinkActive } from '@angular/router'
import { ScreenService } from '@app/core'
import { NgbDropdown, NgbDropdownMenu, NgbDropdownToggle, NgbModal } from '@ng-bootstrap/ng-bootstrap'
import debug from 'debug'
import { lowerFirst, uniqueId } from 'lodash-es'

const debugLogger = debug('peertube:main:ListOverflowItem')

export interface ListOverflowItem {
  label: string
  routerLink: string | any[]
}

@Component({
  selector: 'my-list-overflow',
  templateUrl: './list-overflow.component.html',
  styleUrls: [ './list-overflow.component.scss' ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    NgFor,
    NgTemplateOutlet,
    NgIf,
    NgbDropdown,
    NgbDropdownToggle,
    NgClass,
    NgbDropdownMenu,
    RouterLinkActive,
    RouterLink,
    SlicePipe
  ]
})
export class ListOverflowComponent<T extends ListOverflowItem> implements AfterViewInit {
  @Input() items: T[]
  @Input() itemTemplate: TemplateRef<{ item: T }>

  @ViewChild('modal', { static: true }) modal: ElementRef
  @ViewChild('itemsParent', { static: true }) parent: ElementRef<HTMLDivElement>
  @ViewChildren('itemsRendered') itemsRendered: QueryList<ElementRef>

  showItemsUntilIndexExcluded: number
  isInMobileView = false
  initialized = false

  constructor (
    private cdr: ChangeDetectorRef,
    private modalService: NgbModal,
    private screenService: ScreenService
  ) {}

  ngAfterViewInit () {
    setTimeout(() => {
      this.onWindowResize()
      this.initialized = true
    }, 0)
  }

  isMenuDisplayed () {
    return !!this.showItemsUntilIndexExcluded
  }

  @HostListener('window:resize')
  onWindowResize () {
    this.isInMobileView = !!this.screenService.isInMobileView()

    const parentWidth = this.parent.nativeElement.getBoundingClientRect().width
    let showItemsUntilIndexExcluded: number
    let accWidth = 0

    debugLogger('Parent width is %d', parentWidth)

    for (const [ index, el ] of this.itemsRendered.toArray().entries()) {
      accWidth += el.nativeElement.getBoundingClientRect().width
      if (showItemsUntilIndexExcluded === undefined) {
        showItemsUntilIndexExcluded = (parentWidth < accWidth) ? index : undefined
      }

      const e = document.getElementById(this.getId(index))
      const shouldBeVisible = showItemsUntilIndexExcluded ? index < showItemsUntilIndexExcluded : true
      e.style.visibility = shouldBeVisible ? 'inherit' : 'hidden'
    }

    debugLogger('Accumulated children width is %d so exclude index is %d', accWidth, showItemsUntilIndexExcluded)

    this.showItemsUntilIndexExcluded = showItemsUntilIndexExcluded
    this.cdr.markForCheck()
  }

  toggleModal () {
    this.modalService.open(this.modal, { centered: true })
  }

  dismissOtherModals () {
    this.modalService.dismissAll()
  }

  getId (id: number | string = uniqueId()): string {
    return lowerFirst(this.constructor.name) + '_' + id
  }
}
