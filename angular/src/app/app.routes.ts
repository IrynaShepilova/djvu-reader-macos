import { Routes } from '@angular/router';
import {ReaderComponent} from './components/reader/reader.component';
import {ReaderImgComponent} from './components/reader-img/reader-img.component';
import { LibraryComponent } from './components/library/library.component';
import { ReaderWrapperComponent } from './components/reader-wrapper/reader-wrapper.component';

export const routes: Routes = [
  { path: 'library', component: LibraryComponent },
  { path: 'reader-virtual', component: ReaderComponent },
  { path: 'reader/:id', component: ReaderWrapperComponent },
  { path: '', redirectTo: '/library', pathMatch: 'full' },

];
