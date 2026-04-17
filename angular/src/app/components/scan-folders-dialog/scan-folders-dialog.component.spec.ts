import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ScanFoldersDialogComponent } from './scan-folders-dialog.component';

describe('ScanFoldersDialogComponent', () => {
  let component: ScanFoldersDialogComponent;
  let fixture: ComponentFixture<ScanFoldersDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScanFoldersDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ScanFoldersDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
