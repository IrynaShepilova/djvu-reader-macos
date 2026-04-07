import { Routes } from '@angular/router';
import {ReaderComponent} from './components/reader/reader.component';
import { LibraryComponent } from './components/library/library.component';
import { ReaderWrapperComponent } from './components/reader-wrapper/reader-wrapper.component';

export const routes: Routes = [
  { path: 'library', component: LibraryComponent },
  { path: 'reader/:id', component: ReaderWrapperComponent },
  { path: '', redirectTo: '/library', pathMatch: 'full' },

];
