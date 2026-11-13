import { crc32, deflateRawSync } from 'node:zlib';

const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const periods = ['08.00-17.00', '17.00-19.00', '19.00-22.00', '22.00-06.00', 'ОБЪЕКТ'];
const absence = { vacation: 'ОТП', sick: 'БОЛ', dayoff: 'В' };
const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
const weekdayFill = '1E6A39';
const holidayFill = '3465A4';
const shortenedFill = 'F9D976';

function xml(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function column(number) {
  let label = '';
  for (let i = number; i > 0; i = Math.floor((i - 1) / 26)) label = String.fromCharCode(65 + (i - 1) % 26) + label;
  return label;
}

function cell(ref, value, style = 0, formula = '') {
  const start = '<c r="' + ref + '" s="' + style + '"';
  if (formula) return start + '><f>' + xml(formula) + '</f><v>' + value + '</v></c>';
  if (value === null || value === undefined || value === '') return start + '/>';
  if (typeof value === 'number') return start + '><v>' + value + '</v></c>';
  return start + ' t="inlineStr"><is><t xml:space="preserve">' + xml(value) + '</t></is></c>';
}

function row(index, cells, height = 18) {
  return '<row r="' + index + '" ht="' + height + '" customHeight="1">' + cells.join('') + '</row>';
}

function styles() {
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const formats = [];
  const indices = new Map();
  function format(font, border = 0, fill = '', wrap = false, number = 0) {
    const key = [font, border, fill, wrap, number].join(':');
    if (!indices.has(key)) {
      let fillId = 0;
      if (fill) {
        const entry = '<fill><patternFill patternType="solid"><fgColor rgb="FF' + fill + '"/><bgColor indexed="64"/></patternFill></fill>';
        if (!fills.includes(entry)) fills.push(entry);
        fillId = fills.indexOf(entry);
      }
      indices.set(key, formats.length);
      formats.push('<xf numFmtId="' + number + '" fontId="' + font + '" fillId="' + fillId + '" borderId="' + border +
        '" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1">' +
        '<alignment horizontal="center" vertical="center"' + (wrap ? ' wrapText="1"' : '') + '/></xf>');
    }
    return indices.get(key);
  }
  const font = (size, bold = false, color = '000000') => '<font>' + (bold ? '<b/>' : '') +
    '<sz val="' + size + '"/><color rgb="FF' + color + '"/><name val="Times New Roman"/><family val="1"/></font>';
  const fonts = [font(10), font(14, true), font(14, false, 'FFFFFF'), font(10, true), font(18, true), font(14)];
  const side = (name, style) => '<' + name + (style ? ' style="' + style + '"><color auto="1"/></' + name + '>' : '/>');
  const border = (l, r, t, b) => '<border>' + side('left', l) + side('right', r) + side('top', t) + side('bottom', b) + '<diagonal/></border>';
  const borders = [border(), border('thin','thin','thin','thin'), border('thin','thin','medium','thin'),
    border('thin','thin','thin','medium'), border('thin','thin','medium','medium')];
  format(0);
  return {
    format,
    render: () => '<styleSheet xmlns="' + spreadsheet + '"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.##"/></numFmts>' +
      '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts><fills count="' + fills.length + '">' + fills.join('') +
      '</fills><borders count="' + borders.length + '">' + borders.join('') + '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + formats.length + '">' + formats.join('') + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
  };
}

function dayInfo(date, calendar) {
  const entry = calendar.get(date);
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  if (entry?.kind === 'shortened') return { fill: shortenedFill, label: entry.name };
  if (entry?.kind === 'holiday' || weekday === 0 || weekday === 6) return { fill: holidayFill, label: entry?.name ?? '' };
  return { fill: '', label: '' };
}

function objectColor(project) {
  return /^#[\da-f]{6}$/i.test(project?.color ?? '') ? project.color.slice(1).toUpperCase() : '';
}

function notesParts(notes) {
  const comments = '<comments xmlns="' + spreadsheet + '"><authors><author>Табель</author></authors><commentList>' +
    notes.map(({ ref, text }) => '<comment ref="' + ref + '" authorId="0"><text><t xml:space="preserve">' +
      xml(text) + '</t></text></comment>').join('') + '</commentList></comments>';
  const vml = '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>' +
    '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe">' +
    '<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' +
    notes.map(({ row: r, col: c }, index) => '<v:shape id="_x0000_s' + (1025 + index) +
      '" type="#_x0000_t202" style="position:absolute;width:240pt;height:108pt;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">' +
      '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox/>' +
      '<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill><x:Row>' + (r - 1) +
      '</x:Row><x:Column>' + (c - 1) + '</x:Column></x:ClientData></v:shape>').join('') + '</xml>';
  return { comments, vml };
}

function relationships(entries) {
  return '<Relationships xmlns="' + pkg + '">' + entries.map(([id, type, target]) =>
    '<Relationship Id="' + id + '" Type="' + office + '/' + type + '" Target="' + target + '"/>').join('') + '</Relationships>';
}

function cols(widths) {
  return '<cols>' + widths.map(([min, max, width]) =>
    '<col min="' + min + '" max="' + max + '" width="' + width + '" customWidth="1"/>').join('') + '</cols>';
}

function zip(entries) {
  const local = [];
  const directory = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name);
    const bytes = Buffer.from(xmlHeader + content);
    const compressed = deflateRawSync(bytes);
    const checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    header.copy(central, 6, 4, 30);
    central.writeUInt32LE(offset, 42);
    local.push(header, filename, compressed);
    directory.push(central, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.reduce((size, part) => size + part.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...directory, end]);
}

export function buildTimesheet({ month, shifts, workers, projects, calendar }) {
  const [year, monthIndex] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const special = new Map(calendar.map(day => [day.date, day]));
  const dates = Array.from({ length: count }, (_, index) => month + '-' + String(index + 1).padStart(2, '0'));
  const days = dates.map(date => dayInfo(date, special));
  const byWorkerDay = new Map(shifts.map(shift => [shift.worker_id + ':' + shift.date, shift]));
  const objects = new Map(projects.map(project => [project.id, project]));
  const total = column(count + 4);
  const rate = column(count + 5);
  const workdays = column(count + 6);
  const lastDay = column(count + 3);
  const { format, render } = styles();
  const header = format(1, 1, '00CC00', true);
  const headerSmall = format(0, 1, '00CC00', true);
  const head = ['№ п/п', 'Ф.И.О.', 'Время работы', ...dates.map((_, index) => index + 1), 'Часы работы', 'Размер оплаты', 'Кол-во дней'];
  const rows = [
    row(1, [cell('B1', monthNames[monthIndex - 1], format(4))], 23),
    row(2, [cell('B2', year, format(5))], 19)
  ];
  const merges = head.map((_, index) => column(index + 1) + '5:' + column(index + 1) + '7');
  for (let r = 5; r <= 7; r++) {
    rows.push(row(r, head.map((value, index) => {
      const day = days[index - 3];
      const style = day ? format(day.fill === shortenedFill ? 5 : 2, 1, day.fill || weekdayFill)
        : index < 3 ? header : headerSmall;
      return cell(column(index + 1) + r, r === 5 ? value : '', style);
    }), 18.75));
  }
  const notes = days.flatMap((day, index) => day.label
    ? [{ ref: column(index + 4) + '5', row: 5, col: index + 4, text: day.label }] : []);
  const commentRows = [];
  const legend = new Map();

  workers.forEach((worker, index) => {
    const first = 8 + index * 5;
    merges.push('A' + first + ':A' + (first + 4), 'B' + first + ':B' + (first + 4), total + (first + 4) + ':' + rate + (first + 4));
    const shiftsByDay = dates.map(date => byWorkerDay.get(worker.id + ':' + date));
    periods.forEach((period, line) => {
      const r = first + line;
      const border = line === 0 ? 2 : line === 4 ? 3 : 1;
      const style = format(0, border);
      const cells = [cell('A' + r, line === 0 ? index + 1 : '', format(5, 4)),
        cell('B' + r, line === 0 ? worker.name : '', format(1, 4, '', true)), cell('C' + r, period, style)];
      let hours = 0;
      let dayCount = 0;
      dates.forEach((date, index) => {
        const shift = shiftsByDay[index];
        const project = objects.get(shift?.project_id);
        const col = index + 4;
        const ref = column(col) + r;
        let value = '';
        let fill = days[index].fill;
        if (line === 4) {
          if (project) {
            value = project.name;
            fill = objectColor(project) || fill;
            legend.set(project.id, project);
          }
          if (shift?.note) {
            notes.push({ ref, row: r, col, text: shift.note });
            commentRows.push([date, worker.name, project?.name ?? absence[shift.kind] ?? '', shift.note]);
          }
        } else if (shift?.kind === 'work') {
          const minutes = [shift.regular_minutes, shift.overtime_15_minutes, shift.overtime_20_minutes, 0][line];
          if (minutes > 0) {
            value = minutes / 60;
            hours += minutes;
            dayCount++;
          }
        } else if (line === 0 && shift) value = absence[shift.kind] ?? '';
        cells.push(cell(ref, value, format(0, border, fill, line === 4, line < 4 ? 164 : 0)));
      });
      if (line < 4) {
        const range = 'D' + r + ':' + lastDay + r;
        cells.push(cell(total + r, hours / 60, format(0, border, '', false, 164), 'SUM(' + range + ')'));
        cells.push(cell(rate + r, [1, 1.5, 2, '2+40%'][line], style));
        cells.push(cell(workdays + r, dayCount, style, 'COUNTIF(' + range + ',">0")'));
      } else cells.push(cell(total + r, '', style), cell(rate + r, '', style), cell(workdays + r, '', style));
      rows.push(row(r, cells, line === 4 ? 26 : 18));
    });
  });

  let footer = 9 + workers.length * 5;
  for (const project of legend.values()) {
    rows.push(row(footer, [cell('G' + footer, '', format(0, 1, objectColor(project))), cell('I' + footer, project.name)]));
    footer++;
  }
  for (const label of ['Руководитель ____________________', 'Мастер ____________________']) {
    rows.push(row(++footer, [cell('J' + footer, label)]));
  }
  const sheet = '<worksheet xmlns="' + spreadsheet + '" xmlns:r="' + office + '">' +
    '<sheetViews><sheetView workbookViewId="0" zoomScale="95"><pane xSplit="2" ySplit="7" topLeftCell="C8" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="18.75"/>' + cols([[1, 1, 8.29], [2, 2, 23.71], [3, 3, 13.57], [4, 5, 5], [6, count + 3, 4.57],
      [count + 4, count + 4, 9.48], [count + 5, count + 6, 7.71]]) +
    '<sheetData>' + rows.join('') + '</sheetData><mergeCells count="' + merges.length + '">' + merges.map(ref => '<mergeCell ref="' + ref + '"/>').join('') +
    '</mergeCells><pageMargins left="0.25" right="0.25" top="0.45" bottom="0.45" header="0.2" footer="0.2"/>' +
    '<pageSetup orientation="landscape"/>' + (notes.length ? '<legacyDrawing r:id="rId2"/>' : '') + '</worksheet>';

  const second = commentRows.length > 0;
  const rels = [['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'styles', 'styles.xml']];
  const sheets = '<sheet name="Табель" sheetId="1" r:id="rId1"/>' + (second ? '<sheet name="Комментарии" sheetId="2" r:id="rId3"/>' : '');
  const extra = [];
  if (second) {
    rels.push(['rId3', 'worksheet', 'worksheets/sheet2.xml']);
    const labels = ['Дата', 'Сотрудник', 'Объект / статус', 'Комментарий'];
    const lines = [row(1, labels.map((label, i) => cell(column(i + 1) + '1', label, header)), 23)];
    commentRows.forEach((entry, index) => {
      const r = index + 2;
      lines.push(row(r, entry.map((value, i) => cell(column(i + 1) + r, value, format(0, 1, '', true))),
        Math.min(145, Math.max(23, (Math.ceil(entry[3].length / 70) + entry[3].split('\n').length - 1) * 16))));
    });
    extra.push(['xl/worksheets/sheet2.xml', '<worksheet xmlns="' + spreadsheet + '">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      cols([[1, 1, 14], [2, 2, 31], [3, 3, 24], [4, 4, 78]]) + '<sheetData>' + lines.join('') + '</sheetData></worksheet>']);
  }
  if (notes.length) {
    const { comments, vml } = notesParts(notes);
    extra.push(['xl/comments1.xml', comments], ['xl/drawings/vmlDrawing1.vml', vml],
      ['xl/worksheets/_rels/sheet1.xml.rels', relationships([['rId1', 'comments', '../comments1.xml'], ['rId2', 'vmlDrawing', '../drawings/vmlDrawing1.vml']])]);
  }
  const override = (name, type) => '<Override PartName="/xl/' + name + '" ContentType="' + xlsxMime + type + '+xml"/>';
  const contentTypes = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    (notes.length ? '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>' + override('comments1.xml', 'comments') : '') +
    override('workbook.xml', 'sheet.main') + override('styles.xml', 'styles') + override('worksheets/sheet1.xml', 'worksheet') +
    (second ? override('worksheets/sheet2.xml', 'worksheet') : '') + '</Types>';
  return zip([
    ['[Content_Types].xml', contentTypes], ['_rels/.rels', relationships([['rId1', 'officeDocument', 'xl/workbook.xml']])],
    ['xl/workbook.xml', '<workbook xmlns="' + spreadsheet + '" xmlns:r="' + office +
      '"><bookViews><workbookView/></bookViews><sheets>' + sheets + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'],
    ['xl/_rels/workbook.xml.rels', relationships(rels)], ['xl/styles.xml', render()], ['xl/worksheets/sheet1.xml', sheet], ...extra
  ]);
}
