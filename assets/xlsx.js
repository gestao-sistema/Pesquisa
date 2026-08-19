/* =========================================================
   xlsx.js — escreve um .xlsx de verdade, sem dependência externa.

   Um .xlsx é um ZIP com XMLs dentro. Aqui o ZIP é montado com
   entradas "stored" (método 0, sem compressão) — o Excel, o
   LibreOffice e o Google Sheets aceitam sem ressalvas — e o CRC-32
   é calculado na mão.

   Uso:
     const blob = Xlsx.build([
       { nome:'Respostas', colunas:[{titulo:'Nome', largura:22}], linhas:[['Ana']] }
     ]);
     Xlsx.baixar(blob, 'arquivo.xlsx');

   Tipos de célula, inferidos do valor:
     number → numérico   ·   Date → data formatada   ·   resto → texto
   ========================================================= */

window.Xlsx = (function () {
  /* ---------------- CRC-32 ---------------- */

  const TABELA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------------- ZIP (stored) ---------------- */

  const enc = new TextEncoder();

  function dosDataHora(d) {
    const ano = Math.max(1980, d.getFullYear());
    const data = ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    return { data, hora };
  }

  function zip(arquivos) {
    const agora = dosDataHora(new Date());
    const locais = [];
    const central = [];
    let deslocamento = 0;

    arquivos.forEach((f) => {
      const nome = enc.encode(f.nome);
      const dados = f.dados;
      const crc = crc32(dados);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);   // assinatura local
      lh.setUint16(4, 20, true);           // versão necessária
      lh.setUint16(6, 0x0800, true);       // flag: nomes em UTF-8
      lh.setUint16(8, 0, true);            // método 0 = stored
      lh.setUint16(10, agora.hora, true);
      lh.setUint16(12, agora.data, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, dados.length, true);
      lh.setUint32(22, dados.length, true);
      lh.setUint16(26, nome.length, true);
      lh.setUint16(28, 0, true);

      locais.push(new Uint8Array(lh.buffer), nome, dados);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);   // assinatura central
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, agora.hora, true);
      ch.setUint16(14, agora.data, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, dados.length, true);
      ch.setUint32(24, dados.length, true);
      ch.setUint16(28, nome.length, true);
      ch.setUint16(30, 0, true);
      ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true);
      ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true);
      ch.setUint32(42, deslocamento, true);

      central.push(new Uint8Array(ch.buffer), nome);
      deslocamento += 30 + nome.length + dados.length;
    });

    const tamCentral = central.reduce((a, b) => a + b.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, arquivos.length, true);
    eocd.setUint16(10, arquivos.length, true);
    eocd.setUint32(12, tamCentral, true);
    eocd.setUint32(16, deslocamento, true);

    return new Blob([...locais, ...central, new Uint8Array(eocd.buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  /* ---------------- XML ---------------- */

  function xesc(s) {
    return String(s)
      // O Excel rejeita a maioria dos caracteres de controle.
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  /** 1 → A, 27 → AA */
  function colLetra(n) {
    let s = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /** Data → número de série do Excel (base 1900, com o bug de 1900 embutido). */
  function serial(d) {
    const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
    return utc / 86400000 + 25569;
  }

  const ESTILO = { normal: 0, cabecalho: 1, quebra: 2, data: 3 };

  function celula(ref, valor, estiloQuebra) {
    if (valor === null || valor === undefined || valor === '') return '';
    if (valor instanceof Date && !isNaN(valor)) {
      return `<c r="${ref}" s="${ESTILO.data}"><v>${serial(valor).toFixed(6)}</v></c>`;
    }
    if (typeof valor === 'number' && Number.isFinite(valor)) {
      return `<c r="${ref}"><v>${valor}</v></c>`;
    }
    const txt = String(valor);
    const s = estiloQuebra || txt.length > 60 ? ` s="${ESTILO.quebra}"` : '';
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xesc(txt)}</t></is></c>`;
  }

  function folhaXml(aba) {
    const colunas = aba.colunas || [];
    const linhas = aba.linhas || [];
    const nCols = Math.max(colunas.length, ...linhas.map((l) => l.length), 1);
    const ultima = colLetra(nCols);
    const totalLinhas = linhas.length + 1;

    const cols = colunas.length
      ? `<cols>${colunas.map((c, i) =>
          `<col min="${i + 1}" max="${i + 1}" width="${c.largura || 16}" customWidth="1"/>`).join('')}</cols>`
      : '';

    const cab = `<row r="1" ht="22" customHeight="1">`
      + colunas.map((c, i) =>
          `<c r="${colLetra(i + 1)}1" s="${ESTILO.cabecalho}" t="inlineStr">`
          + `<is><t xml:space="preserve">${xesc(c.titulo)}</t></is></c>`).join('')
      + `</row>`;

    const corpo = linhas.map((linha, li) => {
      const r = li + 2;
      const cs = linha.map((v, ci) => celula(colLetra(ci + 1) + r, v, colunas[ci] && colunas[ci].quebra)).join('');
      return `<row r="${r}">${cs}</row>`;
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<sheetViews><sheetView workbookViewId="0">`
      + `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>`
      + `</sheetView></sheetViews>`
      + `<sheetFormatPr defaultRowHeight="15"/>`
      + cols
      + `<sheetData>${cab}${corpo}</sheetData>`
      + (totalLinhas > 1 ? `<autoFilter ref="A1:${ultima}${totalLinhas}"/>` : '')
      + `</worksheet>`;
  }

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts>`
    + `<fonts count="2">`
    + `<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>`
    + `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>`
    + `</fonts>`
    + `<fills count="3">`
    + `<fill><patternFill patternType="none"/></fill>`
    + `<fill><patternFill patternType="gray125"/></fill>`
    + `<fill><patternFill patternType="solid"><fgColor rgb="FF3B6E62"/><bgColor indexed="64"/></patternFill></fill>`
    + `</fills>`
    + `<borders count="1"><border/></borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="4">`
    + `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
    + `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">`
    + `<alignment vertical="center"/></xf>`
    + `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">`
    + `<alignment vertical="top" wrapText="1"/></xf>`
    + `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
    + `</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
    + `</styleSheet>`;

  /** Nome de aba válido no Excel: ≤31 chars, sem : \ / ? * [ ] */
  function nomeAba(s, i) {
    const limpo = String(s || ('Planilha' + (i + 1))).replace(/[:\\\/\?\*\[\]]/g, ' ').trim().slice(0, 31);
    return limpo || ('Planilha' + (i + 1));
  }

  /* ---------------- build ---------------- */

  function build(abas) {
    const lista = (abas || []).filter(Boolean);
    if (!lista.length) throw new Error('Nenhuma aba para exportar.');

    const nomes = [];
    lista.forEach((a, i) => {
      let n = nomeAba(a.nome, i);
      let k = 2;
      while (nomes.includes(n)) n = nomeAba(n.slice(0, 28) + ' ' + k++, i);
      nomes.push(n);
    });

    const arquivos = [];
    const add = (nome, texto) => arquivos.push({ nome, dados: enc.encode(texto) });

    add('[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
      + lista.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" `
          + `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + `</Types>`);

    add('_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
      + `</Relationships>`);

    add('xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
      + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
      + `<sheets>`
      + nomes.map((n, i) => `<sheet name="${xesc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + `</sheets></workbook>`);

    add('xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + lista.map((_, i) => `<Relationship Id="rId${i + 1}" `
          + `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" `
          + `Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${lista.length + 1}" `
      + `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + `</Relationships>`);

    add('xl/styles.xml', STYLES);
    lista.forEach((aba, i) => add(`xl/worksheets/sheet${i + 1}.xml`, folhaXml(aba)));

    return zip(arquivos);
  }

  /* ---------------- CSV (alternativa leve) ---------------- */

  function csv(colunas, linhas) {
    const cel = (v) => {
      if (v === null || v === undefined) return '';
      const s = v instanceof Date && !isNaN(v) ? v.toLocaleString('pt-BR') : String(v);
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const corpo = [colunas.map((c) => cel(c.titulo)).join(';')]
      .concat(linhas.map((l) => l.map(cel).join(';')))
      .join('\r\n');
    // BOM para o Excel pt-BR abrir em UTF-8 sem estragar acentos.
    return new Blob(['﻿' + corpo], { type: 'text/csv;charset=utf-8' });
  }

  /* ---------------- download ---------------- */

  function baixar(blob, nomeArquivo) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  return { build, csv, baixar };
})();
