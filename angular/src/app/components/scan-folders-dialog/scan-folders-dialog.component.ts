import {Component, OnInit, Signal, signal} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { ScanFolder } from '../../interfaces/scan-folder';
import { ScanFoldersService } from '../../services/scan-folders.service';
import { firstValueFrom } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ScanFoldersFacade } from '../../services/scan-folders-facade';

@Component({
  selector: 'app-scan-folders-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatCheckboxModule],
  templateUrl: './scan-folders-dialog.component.html',
  styleUrl: './scan-folders-dialog.component.scss',
})
export class ScanFoldersDialogComponent implements OnInit {
  scanFolders!: Signal<ScanFolder[]>;
  loading!: Signal<boolean>;
  private refreshLibraryOnClose = false;

  constructor(
    private scanFoldersService: ScanFoldersService,
    private scanFoldersFacade: ScanFoldersFacade,
    private dialogRef: MatDialogRef<ScanFoldersDialogComponent>,
  ) {
     this.scanFolders = this.scanFoldersFacade.scanFolders;
     this.loading = this.scanFoldersFacade.loading;
  }

  ngOnInit(): void {
    void this.scanFoldersFacade.loadFolders();
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

    await this.scanFoldersFacade.addFolder(path);
    this.selectedFolderPath = '';
  }

  async toggleFolder(folder: ScanFolder, enabled?: boolean) {
    console.log('toggleFolder', );
    await this.scanFoldersFacade.toggleFolder(folder, enabled);
    this.refreshLibraryOnClose = true;
  }

  async checkFolder(folder: ScanFolder) {
    console.log('checkFolder', );
    await this.scanFoldersFacade.checkFolder(folder);
    this.refreshLibraryOnClose = true;
  }

  async removeFolder(folder: ScanFolder) {
    console.log('removeFolder', );
    if (folder.type !== 'custom') return;

    const confirmed = window.confirm(`Remove folder?\n\n${folder.path}`);
    if (!confirmed) return;

    await this.scanFoldersFacade.removeFolder(folder);
    this.refreshLibraryOnClose = true;
  }

  close() {
    this.dialogRef.close({ refreshLibrary: this.refreshLibraryOnClose });
  }

}
