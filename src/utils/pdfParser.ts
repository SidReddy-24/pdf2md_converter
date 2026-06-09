interface PDFTextItem {
  str: string;
  x: number;
  y: number;
  fontSize: number;
  fontName: string;
  width: number;
  height: number;
}

interface GroupedLine {
  y: number;
  items: PDFTextItem[];
  fontSize: number;
  isBold: boolean;
  isItalic: boolean;
}

/**
 * Parses a PDF file (as ArrayBuffer) and converts it to Markdown.
 * Runs entirely client-side — pdfjs-dist is dynamically imported to avoid SSR issues.
 */
export async function convertPdfToMarkdown(
  arrayBuffer: ArrayBuffer,
  onProgress?: (current: number, total: number) => void
): Promise<string> {
  // Dynamic import ensures pdfjs-dist is never evaluated during SSR
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  // Load the PDF document
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const allPagesTextItems: PDFTextItem[][] = [];
  const fontSizeFrequency: Record<number, number> = {};

  // Step 1: Extract raw text items and analyze font sizes across all pages
  for (let p = 1; p <= totalPages; p++) {
    const page = await pdf.getPage(p);
    const textContent = await page.getTextContent();
    const items: PDFTextItem[] = [];

    const rawItems = textContent.items as unknown as Array<{
      str: string;
      transform: number[];
      fontName: string;
      width: number;
      height: number;
    }>;
    for (const item of rawItems) {
      if (!item.str || item.str.trim() === '') continue;

      const transform = item.transform; // [scaleX, skewY, skewX, scaleY, translateX, translateY]
      const fontSize = Math.round(Math.abs(transform[3]));
      const x = transform[4];
      const y = transform[5];

      items.push({
        str: item.str,
        x,
        y,
        fontSize,
        fontName: item.fontName || '',
        width: item.width || 0,
        height: item.height || 0,
      });

      if (fontSize > 0) {
        fontSizeFrequency[fontSize] = (fontSizeFrequency[fontSize] || 0) + 1;
      }
    }

    allPagesTextItems.push(items);
    if (onProgress) {
      onProgress(p, totalPages * 2);
    }
  }

  // Determine the body font size (the statistical mode)
  let bodyFontSize = 10;
  let maxFreq = 0;
  Object.entries(fontSizeFrequency).forEach(([size, freq]) => {
    if (freq > maxFreq) {
      maxFreq = freq;
      bodyFontSize = parseInt(size, 10);
    }
  });

  if (bodyFontSize < 6 || bodyFontSize > 20) {
    bodyFontSize = 10;
  }

  let markdownOutput = '';

  // Step 2: Process text items page by page to reconstruct layout and formatting
  for (let p = 0; p < totalPages; p++) {
    const pageItems = allPagesTextItems[p];
    if (pageItems.length === 0) {
      markdownOutput += `\n\n<!-- Page ${p + 1} (Empty) -->\n\n`;
      continue;
    }

    // Group items into lines based on Y-coordinate proximity
    const lines: GroupedLine[] = [];
    const sortedItems = [...pageItems].sort((a, b) => b.y - a.y);

    for (const item of sortedItems) {
      let placed = false;

      for (const line of lines) {
        const tolerance = Math.max(item.fontSize * 0.5, 4);
        if (Math.abs(line.y - item.y) < tolerance) {
          line.items.push(item);
          line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
          line.fontSize = Math.max(line.fontSize, item.fontSize);
          placed = true;
          break;
        }
      }

      if (!placed) {
        lines.push({
          y: item.y,
          items: [item],
          fontSize: item.fontSize,
          isBold: false,
          isItalic: false,
        });
      }
    }

    lines.sort((a, b) => b.y - a.y);

    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);

      let boldCount = 0;
      let italicCount = 0;
      line.items.forEach(item => {
        const name = item.fontName.toLowerCase();
        if (name.includes('bold') || name.includes('black') || name.includes('heavy') || name.includes('semibold')) {
          boldCount++;
        }
        if (name.includes('italic') || name.includes('oblique')) {
          italicCount++;
        }
      });
      line.isBold = boldCount > line.items.length / 2;
      line.isItalic = italicCount > line.items.length / 2;
    }

    let pageMarkdown = '';
    let lastLineY: number | null = null;
    let lastLineFontSize = bodyFontSize;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      let lineText = '';
      for (let j = 0; j < line.items.length; j++) {
        const item = line.items[j];
        let str = item.str;

        const isItemBold = !line.isBold && (
          item.fontName.toLowerCase().includes('bold') ||
          item.fontName.toLowerCase().includes('black') ||
          item.fontName.toLowerCase().includes('heavy') ||
          item.fontName.toLowerCase().includes('semibold')
        );
        const isItemItalic = !line.isItalic && (
          item.fontName.toLowerCase().includes('italic') ||
          item.fontName.toLowerCase().includes('oblique')
        );

        if (isItemBold && str.trim()) {
          str = ` **${str.trim()}** `;
        } else if (isItemItalic && str.trim()) {
          str = ` *${str.trim()}* `;
        }

        if (j === 0) {
          lineText += str;
        } else {
          const prevItem = line.items[j - 1];
          const gap = item.x - (prevItem.x + prevItem.width);
          lineText += gap > item.fontSize * 0.15 ? ' ' + str : str;
        }
      }

      lineText = lineText.replace(/\s+/g, ' ').trim();
      if (!lineText) continue;

      const isHeader =
        line.fontSize > bodyFontSize * 1.25 ||
        (line.fontSize > bodyFontSize * 1.1 && line.isBold);

      let headingPrefix = '';
      if (isHeader) {
        if (line.fontSize >= bodyFontSize * 2.0) headingPrefix = '# ';
        else if (line.fontSize >= bodyFontSize * 1.5) headingPrefix = '## ';
        else headingPrefix = '### ';
      }

      const isBulletList = /^[•\-\*]\s/.test(lineText);
      const isNumberedList = /^\d+[\.\)]\s/.test(lineText);

      if (lastLineY !== null) {
        const verticalGap = lastLineY - line.y;
        const expectedGap = Math.max(lastLineFontSize, line.fontSize) * 1.4;

        if (verticalGap > expectedGap * 1.6 && !isBulletList && !isNumberedList) {
          pageMarkdown += '\n\n';
        } else {
          pageMarkdown += '\n';
        }
      }

      let formattedLine = lineText;

      if (isHeader) {
        formattedLine = headingPrefix + formattedLine.replace(/^[•\-\*\d\.\)\s]+/, '');
      } else {
        if (line.isBold) {
          formattedLine = `**${formattedLine}**`;
        } else if (line.isItalic) {
          formattedLine = `*${formattedLine}*`;
        }
        if (isBulletList && !formattedLine.startsWith('- ')) {
          formattedLine = '- ' + formattedLine.replace(/^[•\-\*\s]+/, '');
        }
      }

      pageMarkdown += formattedLine;
      lastLineY = line.y;
      lastLineFontSize = line.fontSize;
    }

    if (totalPages > 1) {
      markdownOutput += `\n\n<!-- Page ${p + 1} -->\n\n` + pageMarkdown;
    } else {
      markdownOutput += pageMarkdown;
    }

    if (onProgress) {
      onProgress(totalPages + p + 1, totalPages * 2);
    }
  }

  return markdownOutput.trim();
}
