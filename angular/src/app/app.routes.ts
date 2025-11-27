import { Routes } from '@angular/router';
import {ReaderComponent} from './components/reader/reader.component';
import {ReaderImgComponent} from './components/reader-img/reader-img.component';
import { LibraryComponent } from './components/library/library.component';

export const routes: Routes = [
  { path: 'library', component: LibraryComponent },
  { path: 'reader', component: ReaderComponent },
  { path: 'reader-img/:file', component: ReaderImgComponent },
  { path: '', redirectTo: '/reader', pathMatch: 'full' },

];
