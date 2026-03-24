import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

interface PDFTextItem {
  str: string;
  transform: number[];
  hasEOL?: boolean;
}

export interface ExtractedPDFPage {
  pageNumber: number;
  text: string;
}

export interface PDFExtractionResult {
  fileName: string;
  pageCount: number;
  pages: ExtractedPDFPage[];
  fullText: string;
}

type PDFDocumentProxy = Awaited<
  ReturnType<typeof pdfjsLib.getDocument>['promise']
>;
type PDFPageProxy = Awaited<ReturnType<PDFDocumentProxy['getPage']>>;

export class PDFExtractor {
  static async extract(file: File): Promise<PDFExtractionResult> {
    if (
      file.type !== 'application/pdf' &&
      !file.name.toLowerCase().endsWith('.pdf')
    ) {
      throw new Error('PDFExtractor only accepts PDF files.');
    }

    const arrayBuffer = await this.readFileAsArrayBuffer(file);
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      stopAtErrors: true
    });
    const pdf = await loadingTask.promise;

    try {
      const pages: ExtractedPDFPage[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const text = await this.extractPageText(page);
        pages.push({
          pageNumber,
          text
        });
        page.cleanup();
      }

      return {
        fileName: file.name,
        pageCount: pdf.numPages,
        pages,
        fullText: pages.map((page) => page.text).join('\n\n')
      };
    } finally {
      await pdf.destroy();
    }
  }

  private static async extractPageText(page: PDFPageProxy): Promise<string> {
    const textContent = await page.getTextContent();
    const lines: string[] = [];
    let currentLine = '';
    let currentY: number | null = null;

    for (const item of textContent.items) {
      if (!this.isTextItem(item)) {
        continue;
      }

      const token = this.normalizeWhitespace(item.str);
      if (!token) {
        continue;
      }

      const itemY = item.transform[5] ?? 0;
      const isNewLine =
        currentY !== null && Math.abs(itemY - currentY) > 4;

      if (isNewLine && currentLine) {
        lines.push(this.finalizeLine(currentLine));
        currentLine = '';
      }

      if (currentLine && this.shouldInsertSpace(currentLine, token)) {
        currentLine += ' ';
      }

      currentLine += token;
      currentY = itemY;

      if (item.hasEOL && currentLine) {
        lines.push(this.finalizeLine(currentLine));
        currentLine = '';
        currentY = null;
      }
    }

    if (currentLine) {
      lines.push(this.finalizeLine(currentLine));
    }

    return lines.join('\n').trim();
  }

  private static isTextItem(item: unknown): item is PDFTextItem {
    return (
      typeof item === 'object' &&
      item !== null &&
      'str' in item &&
      typeof item.str === 'string' &&
      'transform' in item &&
      Array.isArray(item.transform)
    );
  }

  private static shouldInsertSpace(currentLine: string, token: string): boolean {
    if (!currentLine) {
      return false;
    }

    if (/[([/{-]$/.test(currentLine)) {
      return false;
    }

    if (/^[,.;:!?%)\]}]/.test(token)) {
      return false;
    }

    return true;
  }

  private static finalizeLine(line: string): string {
    return line.replace(/[ \t]+/g, ' ').trim();
  }

  private static normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private static readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => {
        reject(reader.error ?? new Error(`Failed to read ${file.name}.`));
      };

      reader.onabort = () => {
        reject(new Error(`Reading ${file.name} was aborted.`));
      };

      reader.onload = () => {
        if (!(reader.result instanceof ArrayBuffer)) {
          reject(new Error(`Unexpected FileReader result for ${file.name}.`));
          return;
        }

        resolve(reader.result);
      };

      reader.readAsArrayBuffer(file);
    });
  }
}
