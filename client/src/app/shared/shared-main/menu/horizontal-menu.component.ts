import { CommonModule } from '@angular/common'
import { Component, Input } from '@angular/core'
import { RouterModule } from '@angular/router'
import { GlobalIconComponent } from '../../shared-icons/global-icon.component'
import { ListOverflowComponent, ListOverflowItem } from './list-overflow.component'

@Component({
  selector: 'my-horizontal-menu',
  templateUrl: './horizontal-menu.component.html',
  styleUrls: [ './horizontal-menu.component.scss' ],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    GlobalIconComponent,
    ListOverflowComponent
  ]
})
export class HorizontalMenuComponent {
  @Input() menuEntries: ListOverflowItem[] = []
}
