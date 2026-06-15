import {Injectable, signal} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {ScanFolder} from '../interfaces/scan-folder';
import {ScanFoldersService} from './scan-folders.service';
import {firstValueFrom} from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ScanFoldersFacade {
  private readonly _scanFolders = signal<ScanFolder[]>([]);
  readonly scanFolders = this._scanFolders.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  constructor(private scanFoldersService: ScanFoldersService) {}

  async loadFolders() {
    this._loading.set(true);

    try {
      const folders = await firstValueFrom(
        this.scanFoldersService.getScanFolders()
      );

      this._scanFolders.set(folders ?? []);
    } finally {
      this._loading.set(false);
    }
  }

  async addFolder(path: string) {
    const res = await firstValueFrom(
      this.scanFoldersService.addScanFolder(path)
    );

    this._scanFolders.update(folders => [...folders, res.folder]);

    return res.folder;
  }

  async toggleFolder(folder: ScanFolder, enabled?: boolean) {
    const nextEnabled = enabled ?? !folder.enabled;

    const res = await firstValueFrom(
      this.scanFoldersService.updateScanFolderEnabled(folder.id, nextEnabled)
    );

    this._scanFolders.update(folders =>
      folders.map(f => f.id === folder.id ? res.folder : f)
    );

    return res.folder;
  }

  async checkFolder(folder: ScanFolder) {
    const res = await firstValueFrom(
      this.scanFoldersService.checkScanFolder(folder.id)
    );

    this._scanFolders.update(folders =>
      folders.map(f => f.id === folder.id ? res.folder : f)
    );

    return res.folder;
  }

  async removeFolder(folder: ScanFolder) {
    if (folder.type !== 'custom') return null;

    await firstValueFrom(
      this.scanFoldersService.removeScanFolder(folder.id)
    );

    this._scanFolders.update(folders =>
      folders.filter(f => f.id !== folder.id)
    );

    return folder;
  }

}
