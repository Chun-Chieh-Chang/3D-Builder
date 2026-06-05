import json
import sys
from youtube_transcript_api import YouTubeTranscriptApi

try:
    video_id = sys.argv[1]
    # Try English first, then Hindi
    try:
        transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=['en', 'hi'])
    except:
        transcript = YouTubeTranscriptApi.get_transcript(video_id) # Fallback to whatever is available
        
    with open(f"transcript_{video_id}.json", "w", encoding="utf-8") as f:
        json.dump(transcript, f, ensure_ascii=False, indent=2)
    print(f"Transcript saved to transcript_{video_id}.json")
except Exception as e:
    print(f"Error: {e}")