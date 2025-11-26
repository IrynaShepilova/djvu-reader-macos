import { Routes } from '@angular/router';
import {ReaderComponent} from './components/reader/reader.component';
import {ReaderImgComponent} from './components/reader-img/reader-img.component';

export const routes: Routes = [
  { path: 'reader', component: ReaderComponent },
  { path: 'reader-img', component: ReaderImgComponent },
  { path: '', redirectTo: '/reader', pathMatch: 'full' },

];
