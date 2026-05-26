# Entity: YouTube Search

## Description
A tool for visual knowledge acquisition, allowing the agent to find relevant videos and read their transcripts.

## Capabilities
- **Video Discovery**: Search for tutorials or case studies.
- **Transcript Reading**: Fetch the spoken text of a video for analysis.
- **Channel Search**: Find content from specific trusted creators.

## Magic Phrases
- 「在 **YouTube** 上找...」
- 「總結這個影片」

## Usage Patterns
- **Discovery Phase**: Used when the project requires visual or instructional knowledge not easily found in text docs (e.g., UI animations, setup tutorials).

## Guardrails
- **Transcript Dependency**: Only works for videos with available transcripts.
- **No Video Rendering**: The agent cannot "see" the video; it only "reads" it.
