import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MissingBooksDialogComponent } from './missing-books-dialog.component';

describe('MissingBooksDialogComponent', () => {
  let component: MissingBooksDialogComponent;
  let fixture: ComponentFixture<MissingBooksDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissingBooksDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MissingBooksDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
