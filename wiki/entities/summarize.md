# Entity: Summarize

## Description
A specialized tool for extracting key insights from long-form content, including files, URLs, and transcripts.

## Capabilities
- **File Summarization**: Analyze local source files or logs.
- **Web Summarization**: Convert long articles or documentation into actionable takeaways.
- **Transcript Extraction**: Summarize YouTube or podcast transcripts.

## Magic Phrases
- 「幫我 **Summarize**...」
- 「這是在講什麼？」

## Usage Patterns
- **Ingest Phase**: Used to quickly distill information from `raw/` materials before filing into the wiki.
- **Review Phase**: Used to create high-level overviews of complex architectural changes.

## Guardrails
- **No Hallucination**: Do not add information not present in the source.
- **Structured Output**: Prioritize bullet points and tables for clarity.
