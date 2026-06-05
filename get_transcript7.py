import json
import sys
from youtube_transcript_api import YouTubeTranscriptApi

try:
    video_id = sys.argv[1]
    api = YouTubeTranscriptApi()
    transcript_list = api.list(video_id)
    
    try:
        transcript = transcript_list.find_transcript(['en', 'hi'])
    except:
        transcript = next(iter(transcript_list))
        
    data = transcript.fetch()
    output = []
    for snippet in data:
        output.append({
            "text": snippet.text,
            "start": snippet.start,
            "duration": snippet.duration
        })
    
    with open(f"transcript_{video_id}.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"Transcript saved to transcript_{video_id}.json")
except Exception as e:
    print(f"Error: {e}")