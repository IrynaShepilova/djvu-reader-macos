import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'findPreview',
  standalone: true
})
export class FindPreviewPipe implements PipeTransform {
  transform(list: { file: string; url: string }[], file: string) {
    return list.find(x => x.file === file)?.url ?? '';
  }
}
