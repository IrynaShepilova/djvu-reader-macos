import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TabsService } from '../../services/tabs.service';
import { Observable } from 'rxjs';
import { Tab } from '../../interfaces/tab';

@Component({
  selector: 'app-tabs-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tabs-bar.component.html',
  styleUrl: './tabs-bar.component.scss'
})
export class TabsBarComponent implements OnInit {

  tabs$!: Observable<Tab[]>;
  activeId$!: Observable<string | null>;

  constructor(
    private tabsService: TabsService,
    private router: Router
  ) {}

  ngOnInit() {
    this.tabs$ = this.tabsService.tabs$;
    this.activeId$ = this.tabsService.activeTabId$;
  }

  onActivate(tabId: string) {
    this.tabsService.setActive(tabId);
    this.router.navigate(['/reader', tabId]);
  }

  onClose(tabId: string, event: MouseEvent) {
    event.stopPropagation();

    const wasActive = this.tabsService.activeTabId === tabId;

    this.tabsService.closeTab(tabId);

    if (wasActive) {
      const next = this.tabsService.activeTabId;
      if (next) {
        this.router.navigate(['/reader', next]);
      } else {
        this.router.navigate(['/library']);
      }
    }
  }

  goHome() {
    this.router.navigate(['/library']);
  }

}
