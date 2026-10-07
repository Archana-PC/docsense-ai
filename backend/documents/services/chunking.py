"""
Text chunking utilities for RAG pipeline.
Splits extracted document text into semantic chunks while preserving page numbers.
"""
import re
from typing import List, Dict, Any

def chunk_text_by_pages(
    pages_text: List[Dict[str, Any]], 
    chunk_size: int = 600, 
    chunk_overlap: int = 100
) -> List[Dict[str, Any]]:
    """
    Chunks text page-by-page to keep page references accurate for citations.
    pages_text format: [{'page_number': 1, 'text': '...'}, ...]
    Returns: [{'chunk_index': 0, 'page_number': 1, 'content': '...'}, ...]
    """
    chunks = []
    chunk_index = 0

    for page_item in pages_text:
        page_num = page_item['page_number']
        raw_text = page_item['text'].strip()
        if not raw_text:
            continue

        # Normalize whitespace while preserving basic paragraph structure
        clean_text = re.sub(r'[ \t]+', ' ', raw_text)
        clean_text = re.sub(r'\n{3,}', '\n\n', clean_text)

        # If the page text is shorter than chunk size, use it as a single chunk
        if len(clean_text) <= chunk_size:
            chunks.append({
                'chunk_index': chunk_index,
                'page_number': page_num,
                'content': clean_text
            })
            chunk_index += 1
            continue

        # Sliding window chunking
        start = 0
        text_len = len(clean_text)

        while start < text_len:
            end = start + chunk_size

            # If not at the end of text, try to find a sentence or newline break
            if end < text_len:
                break_point = -1
                # Try finding period, newline, or question mark near the end
                for punct in ['\n\n', '\n', '. ', '? ', '! ']:
                    pos = clean_text.rfind(punct, start + chunk_size // 2, end)
                    if pos != -1:
                        break_point = pos + len(punct)
                        break

                if break_point != -1:
                    end = break_point

            chunk_content = clean_text[start:end].strip()
            if chunk_content:
                chunks.append({
                    'chunk_index': chunk_index,
                    'page_number': page_num,
                    'content': chunk_content
                })
                chunk_index += 1

            if end >= text_len:
                break

            start = end - chunk_overlap

    return chunks
