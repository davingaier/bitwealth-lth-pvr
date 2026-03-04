import pdfplumber
import os

pdf_dir = os.path.dirname(os.path.abspath(__file__))

for fname in sorted(os.listdir(pdf_dir)):
    if not fname.endswith('.pdf'):
        continue
    path = os.path.join(pdf_dir, fname)
    out_path = path.replace('.pdf', '.txt')
    try:
        with pdfplumber.open(path) as pdf:
            pages = []
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    pages.append(t)
            text = '\n\n'.join(pages)
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(text)
        print(f'OK  {fname}  ({len(text):,} chars  ->  {os.path.basename(out_path)})')
    except Exception as e:
        print(f'ERR {fname}: {e}')
