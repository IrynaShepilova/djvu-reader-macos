import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LibraryToolbarComponent } from './library-toolbar.component';

describe('LibraryToolbarComponent', () => {
  let component: LibraryToolbarComponent;
  let fixture: ComponentFixture<LibraryToolbarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LibraryToolbarComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LibraryToolbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
