import json
import sys
from youtube_transcript_api import YouTubeTranscriptApi

try:
    video_id = sys.argv[1]
    api = YouTubeTranscriptApi()
    transcript_obj = api.fetch(video_id)
    # The return type is FetchedTranscript. Let's see what it has
    data = transcript_obj.fetch() if hasattr(transcript_obj, 'fetch') else transcript_obj
    
    # Try to convert to list of dicts if possible
    if hasattr(data, '__iter__') and not isinstance(data, dict):
        output = []
        for item in data:
            if isinstance(item, dict):
                output.append(item)
            else:
                # If it's an object, try to get text and start
                text = getattr(item, 'text', str(item))
                output.append({"text": text})
        with open(f"transcript_{video_id}.json", "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(f"Transcript saved to transcript_{video_id}.json")
    else:
        print(f"Unknown data type: {type(data)}")
        print(data)
except Exception as e:
    print(f"Error: {e}")