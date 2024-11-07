import { Component } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { HorizontalMenuComponent } from '@app/shared/shared-main/menu/horizontal-menu.component'
import { ListOverflowItem } from '@app/shared/shared-main/menu/list-overflow.component'

@Component({
  selector: 'my-home-menu',
  templateUrl: './home-menu.component.html',
  standalone: true,
  imports: [
    HorizontalMenuComponent,
    RouterOutlet
  ]
})
export class HomeMenuComponent {
  menuEntries: ListOverflowItem[] = [
    { label: $localize`Home`, routerLink: '/home' },
    { label: $localize`Discover`, routerLink: '/videos/overview' },
    { label: $localize`Subscriptions`, routerLink: '/videos/subscriptions' },
    { label: $localize`Browse videos`, routerLink: '/videos/browse' }
  ]
}
