import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { ScanFolder } from '../../interfaces/scan-folder';
import { ScanFoldersService } from '../../services/scan-folders.service';
import { firstValueFrom } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';

@Component({
  selector: 'app-scan-folders-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatCheckboxModule],
  templateUrl: './scan-folders-dialog.component.html',
  styleUrl: './scan-folders-dialog.component.scss',
})
export class ScanFoldersDialogComponent implements OnInit {
  scanFolders = signal<ScanFolder[]>([]);
  loading = signal(false);
  private refreshLibraryOnClose = false;

  constructor(
    private scanFoldersService: ScanFoldersService,
    private dialogRef: MatDialogRef<ScanFoldersDialogComponent>,
  ) {}

  ngOnInit(): void {
    void this.loadFolders();
  }

  async loadFolders() {
    this.loading.set(true);
    try {
      const folders = await this.scanFoldersService.getScanFolders().toPromise();
      this.scanFolders.set(folders ?? []);
    } finally {
      this.loading.set(false);
    }
  }

  selectedFolderPath = '';

  readonly isElectron = !!window.electronAPI;

  devFolderPresets = [
    '/Users/iryna/Books',
    '/Users/iryna/Downloads',
    '/Volumes/files',
    '/Volumes/pool2/files',
    '/Volumes/NAS/Library',
    '/Volumes/Missing/Books',
  ];

  async browseFolder() {
    if (!window.electronAPI) return;

    const path = await window.electronAPI.selectFolder();
    if (path) {
      this.selectedFolderPath = path;
    }
  }

  async addFolder() {
    console.log('addFolder', );
    const path = this.selectedFolderPath.trim();
    if (!path) return;

    const res = await firstValueFrom(this.scanFoldersService.addScanFolder(path));
    this.scanFolders.update(folders => [...folders, res.folder]);
    this.selectedFolderPath = '';
  }

  async toggleFolder(folder: ScanFolder, enabled?: boolean) {
    console.log('toggleFolder', );
    const nextEnabled = enabled ?? !folder.enabled;

    const res = await firstValueFrom(
      this.scanFoldersService.updateScanFolderEnabled(folder.id, nextEnabled)
    );

    this.scanFolders.update(folders =>
      folders.map(f => f.id === folder.id ? res.folder : f)
    );

    this.refreshLibraryOnClose = true;
  }

  async checkFolder(folder: ScanFolder) {
    console.log('checkFolder', );
    const res = await firstValueFrom(
      this.scanFoldersService.checkScanFolder(folder.id)
    );

    this.scanFolders.update(folders =>
      folders.map(f => f.id === folder.id ? res.folder : f)
    );

    this.refreshLibraryOnClose = true;
  }

  async removeFolder(folder: ScanFolder) {
    console.log('removeFolder', );
    if (folder.type !== 'custom') return;

    const confirmed = window.confirm(`Remove folder?\n\n${folder.path}`);
    if (!confirmed) return;

    await firstValueFrom(this.scanFoldersService.removeScanFolder(folder.id));

    this.scanFolders.update(folders =>
      folders.filter(f => f.id !== folder.id)
    );

    this.refreshLibraryOnClose = true;
  }

  close() {
    this.dialogRef.close({ refreshLibrary: this.refreshLibraryOnClose });
  }

}
